# Reolink Station — Design Spec

- **Date:** 2026-07-15
- **Status:** Approved (design); pending implementation plan
- **Repo:** `reolink-station` (new, public, under `v-dev-cl`)

## 1. Overview

A self-hosted, multi-tenant web app to **view and manage Reolink camera recordings** stored on Hetzner Storage Boxes, plus **live view with PTZ**, reachable from anywhere without opening ports or a public IP.

Primary users: the owner (technical) and family members (e.g. parents) who each own the same camera model (Reolink **RLC-823S1**, 4K PoE PTZ) at their own homes, each with their own Hetzner Storage Box. Each user logs in and sees only their own cameras, and may **share** a camera with another user (so a parent can grant the owner access).

### Goals
- One place to browse, play, download, and prune recordings across multiple cameras/tenants.
- Live view + PTZ from anywhere, no port-forwarding, no public IP.
- Real multi-tenant isolation with encrypted credential storage.
- Self-hosted on the existing k3s fleet, matching house conventions.

### Non-goals (v1 — see §11)
Auto-prune cron, MFA, open self-signup, per-tenant envelope encryption keys, motion/AI alerts, timeline scrubbing, two-way audio, native mobile app.

## 2. Context & established facts

These were verified during design and drive the architecture:

- **Hetzner Storage Box (new BX line) runs SFTPGo and offers plain FTP only.** Explicit FTPS (`AUTH TLS`) returns `504 not implemented` (verified against a live box). SFTP (encrypted) *is* available. → The camera writes over **plain FTP**; the app reads over **SFTP** (encrypted) server-side.
- **Storage Box limits:** max **10 concurrent connections per (sub)account**; **unlimited traffic** (no egress cost). Each sub-account has its own 10. → Server-side connection **pooling** is required; per-box isolation means tenants never contend.
- **Reolink remote access** = proprietary "Baichuan" protocol (TCP 9000) + P2P/relay via Reolink's AWS servers, keyed by camera **UID**. No clean public HTTP/HLS endpoint.
- **The RE is already done:** [`neolink`](https://github.com/QuantumEntangledAndy/neolink) bridges Baichuan→RTSP and supports **UID/relay** connections (camera and neolink each dial out to Reolink; neither needs to reach the other directly). → No APK reverse-engineering required; decompile is a fallback only if the 823S1 has a quirk.
- **Codec:** the 823S1 defaults to H.265/HEVC, which browsers don't reliably play in `<video>` and which makes Reolink-over-WebRTC flaky. → **Set the camera to H.264** for both the FTP recording stream and the live stream: native browser playback + reliable WebRTC + zero server transcoding. Trade-off ~1.5–2× bitrate, negligible given unlimited Hetzner traffic.
- **Reuse — `feed-service`:** NestJS 11 + TypeORM + Postgres + pnpm, non-root Dockerfile, kustomize base+overlays, skaffold, GH Actions. Its `src/crypto/crypto.service.ts` (AES-256-GCM, `iv:authTag:ciphertext` base64url, `isEncrypted()` guard) and the mask-on-read pattern (`provider-config.masking.ts`) and encrypt-on-save/merge lifecycle lift directly. It has **no** users/auth/tenancy/UI — those are greenfield.
  - **Do not copy** feed-service's practice of committing `APP_ENCRYPTION_KEY` in `kustomization.yaml`. Source the key via **ESO/sealed-secrets** from day one.

## 3. Architecture

**Topology:** NestJS API backend + separate Next.js frontend (two deployables), self-hosted on k3s.

```
┌── Next.js frontend (web) ──────────────────────────────────────────────┐
│  login · camera list · recordings browser/player · manager · live+PTZ   │
└───────────────▲─────────────────────────────────────────────────────────┘
                │ httpOnly cookie (JWT), HTTPS
┌───────────────┴──── NestJS API (api) ───────────────────────────────────┐
│  Auth/session · Users/Profiles/Shares · central AuthZ guard             │
│  Recordings: pooled SFTP proxy → Storage Box (per profile)              │
│  Manager: delete/download/manual-retention                             │
│  Live: authz gate + token/proxy to go2rtc; PTZ proxy → neolink         │
│  Crypto (AES-256-GCM, lifted from feed-service) · TypeORM/Postgres      │
└──────▲────────────────────────────────────────────▲─────────────────────┘
       │ SFTP (encrypted, pooled ≤4/box)             │ internal cluster net only
       │                                             │
  Hetzner Storage Box (SFTPGo)              neolink ──RTSP──▶ go2rtc ──WebRTC──▶ web
  (per tenant)                             (UID/relay → Reolink cloud, all cameras)
```

- **One `neolink` on the fleet reaches every tenant's camera by UID/relay** — no per-home device, independent of which network each camera sits on. It serves N cameras; **go2rtc** exposes one WebRTC stream per profile. Both are **internal-only**; the API gates access.
- Modules are isolated: recordings/manager never touch live code; live is consumed as "just another authorized stream."

## 4. Data model (Postgres / TypeORM)

- **User** — `id (uuid), email (unique), password_hash (argon2), role (user|admin), created_at`
- **CameraProfile** — `id, owner_id → User, name, storage_config (jsonb), camera_config (jsonb), created_at, updated_at`
  - `storage_config`: `{ host, port, user, pass(enc), base_path }`
  - `camera_config`: `{ uid, password(enc), codec: 'h264' }`
- **CameraShare** — `id, camera_profile_id → CameraProfile, grantee_id → User, permission (view|manage), created_at`
  - Unique on `(camera_profile_id, grantee_id)`.

Encrypted fields (`(enc)`) go through the lifted crypto service. Reads return `hasPass: true` / `hasPassword: true` (mask-on-read) — ciphertext is **never** returned to the client.

**Tenant isolation (security-critical):** all profile-scoped access passes through **one** authorization check — *caller is `owner_id` OR has a `CameraShare` row* — implemented as a single Nest guard/service, not duplicated per controller. Every DB query for profile data is scoped by this rule.

## 5. Auth & sharing

- **Invite-only accounts.** No open signup (publicly-exposed camera app). Admin provisions users or issues invite tokens; new user sets password (argon2).
- **Login → httpOnly, Secure, SameSite cookie carrying a JWT.** Login is rate-limited.
- **Authorization:** access to a `CameraProfile` requires ownership or a share grant; `manage` permitted for owner or `permission=manage` grant, else `view`.
- **Sharing:** an owner grants another user **view** (default) or **manage** on a profile. This is the mechanism for a parent to share their camera with the owner. Two levels only — no full RBAC in v1.

## 6. Recordings & manager

- **Read path:** API opens SFTP to the profile's Storage Box using its decrypted creds (server-side only), via a **pool of ≤4 connections per box** (cap is 10). Lists `/YYYY/MM/DD`, streams clips with HTTP **Range** support (seeking), serves the camera's `.jpg` snapshots as thumbnails. A short-TTL cache holds listings/thumbnails, populated lazily as the user browses. Interface designed so a background indexer can be dropped in later.
- **Manager:** delete (single + bulk), download, and a manual **"delete older than N days"** action (uses the caller's authorized profile). **Auto-prune cron is deferred** (now technically feasible since creds are stored encrypted, but out of v1 scope).
- **Playback:** clips are H.264 MP4 → native `<video>` playback, no transcoding.

## 7. Live view & PTZ

- `neolink` config is generated from all camera profiles (`uid` + decrypted `password`), connecting via **UID/relay**. go2rtc exposes `webrtc`/fallback `MSE/HLS` per profile stream.
- **Access control:** go2rtc/neolink are never public. The API authz-checks the caller against the profile, then either issues a **short-lived token** or reverse-proxies the stream, so a user only reaches streams they own or were granted.
- **PTZ** (pan/tilt/zoom + presets) is proxied API→neolink and authz-checked. Basic controls in v1.
- **Config lifecycle:** adding/removing/editing a profile regenerates neolink + go2rtc config and triggers a reload. (v1: simple regenerate + reload; a more incremental scheme can come later.)
- All live media is H.264 for reliable WebRTC.

## 8. Encryption & secrets

- **At rest:** AES-256-GCM per secret field (lifted `crypto.service.ts`), single global `APP_ENCRYPTION_KEY` (32 bytes). Adequate for family scale; **per-tenant envelope keys (KMS-wrapped DEKs) are a documented future upgrade**, not v1.
- **Key delivery:** via **ESO/sealed-secrets** — never committed to git.
- **In transit:** SFTP to storage; HTTPS to clients; internal cluster network for neolink/go2rtc.
- Camera/storage secrets are decrypted only transiently in server memory when a connection is opened; never sent to the browser.

## 9. Security model

- **Tenant isolation** enforced by one central guard + query scoping (§4). Unit tests must prove "user A cannot read user B's profile/creds/stream."
- Secrets encrypted at rest; mask-on-read; key via ESO.
- Live streams never publicly exposed; only via authenticated API.
- HTTPS, httpOnly/Secure/SameSite cookies, CSRF protection on state-changing calls, login rate-limiting, argon2 hashing.
- **Trust concentration (stated, accepted):** the fleet's neolink + DB hold *all* tenants' camera creds and can technically access any stream — the operator is the de-facto admin. Acceptable for a family app; documented so it's a conscious choice.

## 10. Deployment & testing

- **k3s pods:** `api` (Nest), `web` (Next), `neolink`, `go2rtc`. **Reuse the shared local Postgres** (per the dev-workstation k3s decision — no new PGO stack); dedicated database for this app.
- **Packaging:** kustomize base + overlays, non-root Dockerfiles, pnpm frozen installs, GH Actions with branch-name image tags (house standard). ESO for `APP_ENCRYPTION_KEY`, DB creds, JWT secret.
- **Tests:**
  - Unit: crypto round-trip; **authz/tenant-isolation** (must-pass); mask-on-read.
  - Integration: SFTP proxy against a test box/sub-account; auth flows (invite → set password → login → refresh).
  - E2E: login → list recordings → play → live view → PTZ.

## 11. v1 scope

**In:** invite-only multi-tenant accounts; encrypted camera profiles; recordings browse/play/download/delete/manual-retention; live WebRTC + basic PTZ; view/manage sharing; self-hosted k3s deploy.

**Deferred:** auto-prune cron; MFA; open signup; per-tenant envelope keys; notifications/motion alerts; timeline scrubbing (Frigate territory); two-way audio; background recordings indexer; mobile app.

## 12. Risks & open items (to resolve during implementation)

- **neolink ↔ RLC-823S1 over UID/relay + PTZ** — verify early on real hardware; decompile the APK only if a specific gap appears.
- **Remote WebRTC with Reolink** can be finicky (known go2rtc issues) — MSE/HLS fallback mitigates; confirm during the live spike.
- **go2rtc access gating** — decide between short-lived signed URL vs authenticated reverse proxy for WebRTC (SDP/ICE) during implementation.
- **Camera H.264 switch** must be applied on each physical camera (owner + parents) — an onboarding step, not code.
- **Storage Box "Allow SSH"** must be enabled on each sub-account so the app can read over SFTP.

## 13. Key decisions log

| Decision | Choice | Why |
|---|---|---|
| Static vs server | Server-side required | Browsers can't speak FTP/SFTP; WebDAV blocked by CORS |
| Camera→storage transfer | Plain FTP (camera) / SFTP (app read) | New Hetzner box = SFTPGo, no FTPS (`504`) |
| Live protocol | neolink (UID/relay) → go2rtc → WebRTC | RE already done; no ports/public IP; runs on fleet |
| RE the APK? | No (fallback only) | neolink implements Baichuan + P2P/PTZ |
| Codec | Force H.264 | Browser playback + WebRTC; no transcoding |
| Tenancy | L3 multi-tenant, invite-only | Parents use it too; public exposure |
| Topology | NestJS API + Next.js web | Backend-heavy; max feed-service reuse; fleet convention |
| Crypto | Lift feed-service AES-256-GCM, single key | Proven; family scale; envelope keys later |
| Secrets delivery | ESO/sealed-secrets | Never git (aligns with ESO plan) |
| DB | Shared local Postgres | Per dev-workstation k3s decision |
