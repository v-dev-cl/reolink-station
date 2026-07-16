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
