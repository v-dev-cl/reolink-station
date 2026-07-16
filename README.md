# reolink-station-api

Invite-only, multi-tenant backend for managing Reolink camera profiles, recordings access, and live/PTZ viewing across a family/household ("station") deployment. NestJS + TypeORM/Postgres, encrypted-at-rest camera credentials, and centrally enforced tenant isolation.

## Prerequisites

- Node.js 22.x (`engines.node` in `package.json`)
- pnpm 10.11.0 (`packageManager` in `package.json`; `corepack enable` will pick it up)
- Docker (for the test Postgres instance)

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in real values for local dev
```

## Running tests

Unit and e2e tests both require a running Postgres instance. Start the test database with Docker Compose first:

```bash
docker compose -f docker-compose.test.yml up -d
pnpm test
pnpm test:e2e
```

`test:e2e` and the unit specs that touch the database read connection settings from `.env.test` (already checked in with non-secret local-only values — points at `localhost:5433`, the port published by `docker-compose.test.yml`).

## Running locally

```bash
pnpm start:dev
```

## Database migrations

The app uses `synchronize: true` in non-production environments (see `src/config/database.config.ts`) so local/dev schemas stay in sync automatically. In production (`NODE_ENV=production`) `synchronize` is disabled and the schema is managed via TypeORM migrations instead, using the CLI data source at `src/data-source.ts`:

```bash
pnpm migration:generate src/migrations/<Name>   # after building/adjusting entities
pnpm migration:run                              # apply pending migrations
```

Run `migration:run` as part of the deploy step, before rolling out the new image, against `DATABASE_URL`.

## Docker

Multi-stage, non-root image (`Dockerfile`): builds with pnpm in a `deps`/`build` stage, then ships only `node_modules` (production-pruned) + `dist` in the `runtime` stage, running as the built-in `node` user.

```bash
docker build -t reolink-station-api .
docker run --rm -p 3000:3000 --env-file .env reolink-station-api
```

## Deploy (kustomize + ESO)

Kubernetes manifests live under `k8s/`:

- `k8s/base` — `Deployment` (non-root, `runAsUser: 1000`), `Service`, and an `ExternalSecret` (`k8s/base/external-secret.yaml`) that pulls secrets from the cluster's `ClusterSecretStore` into a `reolink-station-api-secrets` Kubernetes Secret, consumed by the Deployment via `envFrom`.
- `k8s/overlays/{dev,prod}` — thin overlays pinning the `default` namespace over the base.

```bash
kubectl apply -k k8s/overlays/dev
# or
kubectl apply -k k8s/overlays/prod
```

### Required ESO secret-store keys

The `ExternalSecret` expects a `reolink-station/api` entry in the backing secret store with these properties (never committed to git — this repo only ships the *reference*, not the values):

| Property | Purpose |
|---|---|
| `APP_ENCRYPTION_KEY` | AES-256-GCM key used to encrypt/decrypt camera profile credentials at rest (see Task 2's crypto service) |
| `JWT_SECRET` | Signs/verifies session JWTs |
| `DATABASE_URL` | Postgres connection string for the prod database |

## CI

`.github/workflows/build-and-publish.yml` runs on every push to any branch: install (frozen lockfile) → build → (unit/e2e tests run against a service Postgres in a fuller pipeline) → derive an image tag from the branch name (`/` replaced with `-`) → build/publish step (currently a stub — wire up the actual registry push when one is chosen).

## Camera onboarding prerequisites (spec §12)

Before a Reolink RLC-823S1 (or similar) camera can be onboarded to a station, two out-of-band, per-camera/per-account steps are required — these are physical/vendor-console steps, not something the app can automate:

1. **Force H.264 on the camera.** The camera defaults to H.265/HEVC, which browsers don't reliably play natively and which makes WebRTC flaky. Set the camera's encode settings (both the recording/FTP stream and the live stream) to **H.264** before onboarding. Trade-off is roughly 1.5-2x bitrate, which is acceptable given unlimited traffic on the hosting fleet.
2. **Enable "Allow SSH" on the Storage Box sub-account.** Camera recordings land on a Hetzner Storage Box over plain FTP from the camera side; the app reads them back over SFTP, which requires the sub-account's "Allow SSH" toggle to be turned on in the Storage Box console. Without it, the app cannot list/download recordings for that account.

Both must be applied per physical camera / per sub-account (including cameras belonging to parents' accounts, not just the primary owner) as part of onboarding — they are operational checklist items, not code paths.

## Live view (backend) (spec §7)

The API exposes a live-view + PTZ control layer on top of go2rtc/neolink, gated by the same access model (`CameraAccessGuard`) as recordings:

- `GET /camera-profiles/:id/live/stream.mp4` — proxies go2rtc's stream for the camera profile (`GO2RTC_URL/api/stream.mp4?src=<id>`), piping the upstream response straight through. Available to any grantee with **view** access or higher — the same level that can browse recordings, so a viewer can watch the live feed.
- `POST /camera-profiles/:id/ptz` — body `{ command: 'up'|'down'|'left'|'right'|'in'|'out'|'stop', amount?: 1-100 }`. **Requires `manage` permission** — a view-only grantee gets `403`. On success the backend publishes to neolink over MQTT on topic `neolink/<id>/control/ptz` with payload `"<direction> <amount>"` (or `"stop"`), where `<id>` is the camera profile id (the same id used as the `name`/stream `src` in the neolink and go2rtc configs generated by `LiveConfigService`).

Both routes 404 for non-owners/non-grantees, consistent with the rest of the sharing model (existence isn't leaked).

**Config:** `GO2RTC_URL` (e.g. `http://go2rtc:1984`) points at go2rtc's HTTP API; `MQTT_URL` (e.g. `mqtt://mqtt:1883`) points at the broker neolink subscribes to for PTZ. Both are already present in `.env.example`/`.env.test`.

**H.264 required.** go2rtc's `stream.mp4` output is fMP4 and only plays back natively in the browser when the source is H.264 — this is the reason cameras must be forced to H.264 during onboarding (see "Camera onboarding prerequisites" above). An H.265 source will not play correctly through this endpoint.

**Not yet done — Plan 3b (manual).** This plan (3a) is the backend control layer only: config generation, the authz-gated stream proxy, and the manage-gated PTZ endpoint, all tested against mocked go2rtc/MQTT. It does **not** stand up neolink, go2rtc, or an MQTT broker, and no smoke test has run against a real RLC-823S1 or a live neolink/go2rtc deployment. Bringing those three services up (kustomize/compose, wired to `LiveConfigService`'s generated configs) and running an end-to-end smoke test against a physical camera is Plan 3b — until that happens, the live media and PTZ path is implemented but functionally unverified. (The frontend Live tab/player/PTZ controls are separately out of scope for this plan too.)

**Plan 3b prerequisite (tracked): neolink `[mqtt]` block.** The generated neolink config (from `LiveConfigService.neolinkConfig()`) currently emits only `bind` and `[[cameras]]` blocks. It is **missing an `[mqtt]` section** pointing at the broker. Without it, neolink will not subscribe to the PTZ control topic (`neolink/<id>/control/ptz`), so **PTZ commands published by the backend will be silently dropped at the camera.** The exact neolink `[mqtt]` TOML field names and schema must be verified against the installed neolink binary version during Plan 3b setup, then the `[mqtt]` block must be added to `LiveConfigService.neolinkConfig()` in `src/modules/live/services/live-config.service.ts`. Until that's done, the PTZ endpoint is wired end-to-end on the app side but is a no-op at the camera. This is a tracked blocker for the 3b smoke test.
