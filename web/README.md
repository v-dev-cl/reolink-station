# reolink-station-web

Next.js (App Router) frontend for reolink-station: login, camera-profile list, create/edit profile (with masked secrets), and sharing management. Talks to the `reolink-station-api` backend exclusively through a same-origin API proxy — the browser never sees the backend's origin or credentials.

## Prerequisites

- Node.js 22.x (`engines.node` in `package.json`)
- pnpm 10.11.0 (`packageManager` in `package.json`; `corepack enable` will pick it up)
- A running `reolink-station-api` backend (see the repo root `README.md`) for `pnpm dev`/`pnpm start` and for the opt-in Playwright smoke test

## Setup

```bash
pnpm install
cp .env.example .env   # then set BACKEND_URL for local dev
```

## Cookie-proxy model

The app never calls the backend directly from the browser. All API calls go through `/api/*` on the web app's own origin:

- `next.config.ts` rewrites `/api/:path*` to `${BACKEND_URL}/:path*` server-side (see the `rewrites()` config).
- `src/lib/api.ts` is the only place that issues `fetch` calls, and it always targets `/api/...`.
- Auth is an httpOnly cookie (`access_token`) set by the backend on login; the browser can't read it, and it rides along automatically on same-origin `/api/*` requests.
- `src/middleware.ts` gates every non-public route (everything except `/login`) by checking for the presence of that cookie, redirecting to `/login` when it's missing and away from `/login` when it's already present.

`BACKEND_URL` is a **server-only** environment variable — it's read in `next.config.ts` at build/start time and is not exposed to client-side code.

## Running locally

```bash
BACKEND_URL=http://localhost:3000 pnpm dev
```

Starts the dev server on `:3001` (see the `dev` script in `package.json`). Requires the backend to already be running and reachable at `BACKEND_URL` — the app itself has no fallback/mock backend.

For a production-style run:

```bash
pnpm build
BACKEND_URL=http://localhost:3000 pnpm start
```

## Component tests (`pnpm test`)

```bash
pnpm test
```

Runs the Vitest suite (`*.test.ts(x)` files alongside the components/pages they cover, jsdom environment, `fetch` stubbed per-test). This suite requires **no running backend or stack** — it's pure component/unit testing and is safe to run in CI on every push. It does not include the `e2e/` directory (see below).

## End-to-end smoke test (`pnpm e2e`) — opt-in

```bash
pnpm e2e
```

Runs `e2e/smoke.spec.ts` with Playwright: log in, see the camera list, open the create-profile form. This is **not** part of `pnpm test` and is **not** run automatically in CI — it needs a fully running stack plus a seeded user, and is meant to be run manually (or wired into a separate integration-test job) when that's available.

Prerequisites before running `pnpm e2e`:

1. The backend running on `:3000`, with a seeded user to log in as.
2. This web app running on `:3001` (`pnpm dev` or `pnpm build && pnpm start`), pointed at that backend via `BACKEND_URL`.
3. Playwright's browser binaries installed once per machine: `npx playwright install`.

Environment variables the spec reads (all optional, with defaults matching the values above):

| Variable | Default | Purpose |
|---|---|---|
| `WEB_URL` | `http://localhost:3001` | Base URL the test drives (`playwright.config.ts`) |
| `TEST_EMAIL` | `e2e@x.com` | Email of the seeded user to log in as |
| `TEST_PASSWORD` | `password123` | Password of the seeded user |

Example, assuming the backend is already up and seeded:

```bash
# terminal 1
cd ../  # repo root, or wherever the backend lives
BACKEND_URL=... pnpm start:dev

# terminal 2
cd web
BACKEND_URL=http://localhost:3000 pnpm build && pnpm start &
TEST_EMAIL=e2e@x.com TEST_PASSWORD=password123 pnpm e2e
```

## Recordings

Browse per-camera recordings at `/profiles/<id>/recordings` (linked from the "View recordings →" button on the profile detail page). The browser navigates the storage tree (typically `/YYYY/MM/DD`), shows thumbnails, and plays clips with seeking; thumbnails and video stream through the authenticated `/api` proxy, which forwards `Range` requests so seeking works without buffering the whole file. Deleting recordings (single or bulk via selection) and manual "older than N days" pruning are available from the manager bar and require `manage` permission on the profile — view-only shares get a friendly 403 message instead of the controls.

## Live view (frontend)

`/profiles/<id>/live` (linked from the "Live view →" button on the profile detail page) streams the camera via the authenticated `/api` proxy (go2rtc MP4) and offers PTZ controls. PTZ requires `manage` permission on the profile — a view-only grantee gets a friendly permission message instead of working controls. **Real streaming and PTZ require the Plan 3b services (neolink, go2rtc, the MQTT broker) running against the physical camera; this cannot be verified in this sandbox and is an explicit manual smoke test, not an assumed-passing check.**

## Out of scope (this plan)

A shares list/revoke UI is not part of this plan; a download button is deferred as polish (the browser can already save clips from the player or `recordingFileUrl` directly).
