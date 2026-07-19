# CLAUDE.md

Working notes for AI agents in this repo. For human setup / run / migration steps see `README.md` — this file is the stuff that isn't obvious from the code and trips agents up.

## What this is

Invite-only, multi-tenant web app to browse and manage a Reolink camera's recordings (stored on a Hetzner Storage Box over SFTP) and to view live video + drive PTZ, reachable from anywhere without port-forwarding.

## Repo layout — TWO separate pnpm packages (NOT a workspace)

- **Root** = NestJS 11 backend (`src/`, `test/`). `pnpm build` runs `nest build`.
- **`web/`** = Next.js 15 + React 19 + Tailwind frontend, with its **own** `package.json` and lockfile.

They are independent installs and builds. **When verifying a change, build and test BOTH:**

```bash
pnpm install && pnpm build              # backend (root)
cd web && pnpm install && pnpm build    # frontend
```

The backend `tsconfig.json` / `tsconfig.build.json` **exclude `web/`** so `nest build` doesn't try to compile the frontend's JSX. Consequence: a root-only build passes even when the frontend is broken. CI builds and tests both packages — so must you. Never conclude "it builds" from the root build alone.

## Tests

- **Backend** = jest. Unit and e2e need the Docker services in `docker-compose.test.yml` (Postgres on `:5433`, `atmoz/sftp` on `:2222`) — `docker compose -f docker-compose.test.yml up -d` first. `pnpm test`, `pnpm test:e2e` (e2e is serialized, `maxWorkers: 1`). `.env.test` (checked in, non-secret) points at those ports.
- **Frontend** = vitest, fetch-stubbed, no services needed: `cd web && pnpm test`.

## Architecture essentials

- **Auth:** invite-only (no open signup), argon2id, JWT in an httpOnly cookie. There is no bootstrap-admin UI — the first admin is seeded manually (invite row + role update).
- **Tenant isolation** is enforced by ONE central `CameraAccessService` + `CameraAccessGuard` (levels `owner | manage | view`; 404 on no-access so existence doesn't leak; `@RequireManage()` gates mutations). Don't hand-roll tenant checks in controllers — route access through the guard.
- **Secrets at rest:** AES-256-GCM via `src/crypto/` (`APP_ENCRYPTION_KEY`, exactly 32 bytes). Mask-on-read — API responses return `hasPassword`-style booleans, never decrypted secrets. The key comes from the environment (ESO in deployment). **Never commit `.env` or keys.**
- **Frontend ↔ backend:** the frontend calls `/api/*`, which Next.js rewrites to `BACKEND_URL` (a server-only env var, same-origin cookie). `BACKEND_URL` must never reach the client. `web/src/middleware.ts` protects routes; `web/src/lib/api.ts` redirects to `/login` on 401.

## Recordings & live specifics (hard-won — keep these)

- **Storage Box:** new Hetzner boxes run SFTPGo and offer **plain FTP only** (no FTPS — `AUTH TLS` returns 504). The camera writes over plain FTP; the app reads over **SFTP (port 22)**. Box limit is 10 concurrent connections per account.
- **SFTP reads:** pooled `ssh2-sftp-client`; every path confined by `resolveSafe()` (`src/recordings/path-safety.ts`); streaming uses a windowed/pipelined reader (`src/recordings/sftp-windowed-read.ts`) because sequential single-chunk reads collapse to tens of KB/s on high-RTT links. The pool key includes a credential hash — do **not** drop that; it prevents one tenant poisoning another's pooled connection.
- **Live view:** the camera's stream is bridged by **neolink** (reaches the camera by UID via Reolink's relay — no port-forwarding) → **go2rtc** serves `GET /api/stream.mp4?src=<profileId>` (browser-native fMP4), proxied through the authed backend. **PTZ** publishes to MQTT topic `neolink/<profileId>/control/ptz`. The neolink camera name and the go2rtc stream key must equal the camera-profile UUID. Bring the media stack up per `docs/plan-3b-live-runbook.md`.
- **Camera codec MUST be H.264.** Browsers and go2rtc's `stream.mp4` can't play H.265, so live view and in-browser recording playback both require H.264. (On the RLC-823S1, 4K is H.265-only, so use 1440p/H.264 for the main stream.)

## Conventions

- Do not commit `.env`, `web/.env.local`, or `live/` (the generated neolink/go2rtc/mosquitto config — it contains the decrypted camera password; gitignored).
- Design specs and per-plan task breakdowns live in `docs/superpowers/`; the live-stack deployment runbook is `docs/plan-3b-live-runbook.md`.
- Match the surrounding code's patterns and test style rather than introducing new ones.
