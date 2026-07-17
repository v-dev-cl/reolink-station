# Reolink Station — Frontend Live Tab (player + PTZ) — Implementation Plan (Plan 3c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For UI polish, also load `frontend-design`.

**Goal:** Add a Live view to the Next.js frontend: a `<video>` player streaming the camera live via the backend go2rtc proxy, plus PTZ controls that drive the manage‑gated PTZ endpoint — at `/profiles/[id]/live`, linked from the profile detail page.

**Architecture:** The browser only talks to the same‑origin `/api/*` proxy (cookie auth). Live video is a plain `<video src="/api/camera-profiles/:id/live/stream.mp4">` — the backend proxies go2rtc's progressive fMP4, which plays natively; no WebRTC/JS SDK needed. PTZ buttons POST `{ command, amount? }` to `/api/camera-profiles/:id/ptz`; that endpoint requires **manage**, so a view‑grantee gets 403 — the UI surfaces a friendly "need manage permission" message rather than hiding controls (the frontend doesn't know the caller's level; it degrades on 403, the same pattern already used for delete/prune/share).

**Tech Stack:** Existing `web/` — Next.js 15 App Router, React 19, Tailwind v4, Vitest + RTL (fetch‑stubbed, stack‑free). No new deps. Reuses `api`/`ApiError`.

## Global Constraints

- **Same‑origin only:** the live URL and PTZ POST go through `/api/*`; the video `src` is the backend proxy path (never the go2rtc origin); no tokens in URLs (cookie authenticates).
- **PTZ matches the backend contract exactly:** command ∈ `'up'|'down'|'left'|'right'|'in'|'out'|'stop'`; optional integer `amount` 1–100. A bad value never reaches the API.
- **403 is expected, not an error:** a view‑grantee POSTing PTZ gets 403 → a friendly "you need manage permission to control this camera" `role="alert"`, never a raw error. (401 already auto‑redirects via `api.ts`.)
- **Live is best‑effort:** a stalled/failed stream shows a retry affordance, not a crash — the sandbox can't verify real playback (needs Plan 3b), so components are wired + unit‑tested; **real video/PTZ is a Plan 3b manual smoke with the RLC‑823S1.**
- **Reuse conventions:** `api` client, `aria-label`s, `role="alert"`, neutral Tailwind; buttons disabled while a request is in flight.
- Tests stay stack‑free (stub `fetch`); run BOTH `cd web && pnpm test`/`pnpm build` AND the ROOT `pnpm build` isn't needed here (frontend‑only) — but confirm `web` build is clean.

## Backend contract consumed (Plan 3a — match, don't change)

- `GET /camera-profiles/:id/live/stream.mp4` → progressive `video/mp4` (view‑level access; non‑owner 404).
- `POST /camera-profiles/:id/ptz` body `{ command: PtzCommand; amount?: number }` → `{ ok: true }` (201); **403 for a view‑grantee**; 400 for a bad command.

## File Structure

```
web/src/lib/live.ts                    # liveStreamUrl() + sendPtz() + PtzCommand type
web/src/lib/live.test.ts
web/src/components/live/
  LivePlayer.tsx / .test.tsx           # <video> at the proxy URL + error/retry
  PtzControls.tsx / .test.tsx          # directional + zoom buttons, 403 handling
web/src/app/profiles/[id]/live/page.tsx   # route mounting player + controls
(modify) web/src/app/profiles/[id]/page.tsx      # "Live view" link
(modify) web/src/app/profiles/[id]/page.test.tsx # assert the link
(modify) web/README.md                            # Live view (frontend) note
```

---

### Task 1: Live API client (`lib/live.ts`)

**Files:**
- Create: `web/src/lib/live.ts`, `web/src/lib/live.test.ts`

**Interfaces:**
- Produces:
  - `type PtzCommand = 'up'|'down'|'left'|'right'|'in'|'out'|'stop'`
  - `liveStreamUrl(profileId: string): string` → `/api/camera-profiles/${profileId}/live/stream.mp4`
  - `sendPtz(profileId: string, command: PtzCommand, amount?: number): Promise<void>` → `api.post('/camera-profiles/:id/ptz', { command, amount? })` (omit `amount` when undefined).

- [ ] **Step 1: Write the failing test**

`web/src/lib/live.test.ts`:
```ts
import { vi, afterEach } from 'vitest';
import { liveStreamUrl, sendPtz } from './live';

afterEach(() => vi.unstubAllGlobals());

it('liveStreamUrl points at the same-origin proxy for the profile', () => {
  expect(liveStreamUrl('p1')).toBe('/api/camera-profiles/p1/live/stream.mp4');
});

it('sendPtz posts the command (no amount key when omitted)', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await sendPtz('p1', 'left');
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/ptz');
  expect(JSON.parse(init.body)).toEqual({ command: 'left' });
});

it('sendPtz includes amount when provided', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await sendPtz('p1', 'in', 20);
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ command: 'in', amount: 20 });
});
```

- [ ] **Step 2: Run to verify failure** — `cd /home/vampfernmsi/WebstormProjects/reolink-station/web && pnpm test -- live` → FAIL.

- [ ] **Step 3: Implement**

`web/src/lib/live.ts`:
```ts
import { api } from './api';

export type PtzCommand = 'up' | 'down' | 'left' | 'right' | 'in' | 'out' | 'stop';

export function liveStreamUrl(profileId: string): string {
  return `/api/camera-profiles/${profileId}/live/stream.mp4`;
}

export function sendPtz(profileId: string, command: PtzCommand, amount?: number): Promise<void> {
  const body: { command: PtzCommand; amount?: number } = { command };
  if (amount !== undefined) body.amount = amount;
  return api.post<void>(`/camera-profiles/${profileId}/ptz`, body);
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- live` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): live api client (stream url + ptz)"
```

---

### Task 2: `LivePlayer`

**Files:**
- Create: `web/src/components/live/LivePlayer.tsx`, `LivePlayer.test.tsx`

**Interfaces:**
- Consumes: `liveStreamUrl` (Task 1).
- Produces: `LivePlayer({ profileId })` — a `<video data-testid="live-video" controls autoPlay muted playsInline>` whose `src` is `liveStreamUrl(profileId)`; on the video's `error` event, shows a `role="alert"` message + a "Retry" button that reloads the stream (bumps a key so the `<video>` remounts with a fresh request).

- [ ] **Step 1: Write the failing test**

`web/src/components/live/LivePlayer.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LivePlayer from './LivePlayer';

it('renders a muted autoplay video at the proxy stream url', () => {
  render(<LivePlayer profileId="p1" />);
  const v = screen.getByTestId('live-video') as HTMLVideoElement;
  expect(v).toHaveAttribute('src', '/api/camera-profiles/p1/live/stream.mp4');
  expect(v).toHaveAttribute('muted');
  expect(v).toHaveAttribute('autoplay');
});

it('shows an error + retry when the stream errors, and retry remounts a fresh video', async () => {
  render(<LivePlayer profileId="p1" />);
  fireEvent.error(screen.getByTestId('live-video'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load the live stream/i);
  await userEvent.click(screen.getByRole('button', { name: /retry/i }));
  // after retry the video is back (error cleared)
  expect(screen.getByTestId('live-video')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/live/LivePlayer.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { liveStreamUrl } from '@/lib/live';

export default function LivePlayer({ profileId }: { profileId: string }) {
  const [errored, setErrored] = useState(false);
  const [key, setKey] = useState(0);

  function retry() { setErrored(false); setKey((k) => k + 1); }

  if (errored) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg bg-neutral-900">
        <p role="alert" className="text-sm text-neutral-300">
          Couldn&apos;t load the live stream. The camera may be offline or still connecting.
        </p>
        <button onClick={retry} className="rounded bg-blue-600 px-3 py-1.5 text-sm">Retry</button>
      </div>
    );
  }

  return (
    <video
      key={key}
      data-testid="live-video"
      src={liveStreamUrl(profileId)}
      controls
      autoPlay
      muted
      playsInline
      onError={() => setErrored(true)}
      className="w-full rounded-lg bg-black"
    />
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- LivePlayer` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): live video player with error/retry"
```

---

### Task 3: `PtzControls`

**Files:**
- Create: `web/src/components/live/PtzControls.tsx`, `PtzControls.test.tsx`

**Interfaces:**
- Consumes: `sendPtz`, `PtzCommand` (Task 1), `ApiError` (`@/lib/api`).
- Produces: `PtzControls({ profileId })` — buttons for the 7 commands (labels: Up/Down/Left/Right, Zoom in/Zoom out, Stop); each calls `sendPtz(profileId, command)`; buttons disabled while a request is in flight; a 403 shows `role="alert"` "You need manage permission to control this camera"; other errors → generic "Command failed".

- [ ] **Step 1: Write the failing test**

`web/src/components/live/PtzControls.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import PtzControls from './PtzControls';

afterEach(() => vi.unstubAllGlobals());

it('sends the matching command for each direction/zoom button', async () => {
  const spy = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^left$/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ command: 'left' });
  await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
  expect(JSON.parse(spy.mock.calls[1][1].body)).toEqual({ command: 'in' });
  await userEvent.click(screen.getByRole('button', { name: /^stop$/i }));
  expect(JSON.parse(spy.mock.calls[2][1].body)).toEqual({ command: 'stop' });
});

it('shows a manage-permission message on 403', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<PtzControls profileId="p1" />);
  await userEvent.click(screen.getByRole('button', { name: /^up$/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/live/PtzControls.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { PtzCommand, sendPtz } from '@/lib/live';

const BUTTONS: { command: PtzCommand; label: string }[] = [
  { command: 'up', label: 'Up' },
  { command: 'down', label: 'Down' },
  { command: 'left', label: 'Left' },
  { command: 'right', label: 'Right' },
  { command: 'in', label: 'Zoom in' },
  { command: 'out', label: 'Zoom out' },
  { command: 'stop', label: 'Stop' },
];

export default function PtzControls({ profileId }: { profileId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function move(command: PtzCommand) {
    setError(''); setBusy(true);
    try {
      await sendPtz(profileId, command);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? 'You need manage permission to control this camera'
        : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="grid grid-cols-4 gap-2">
        {BUTTONS.map((b) => (
          <button
            key={b.command}
            onClick={() => move(b.command)}
            disabled={busy}
            className="rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {b.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- PtzControls` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): ptz controls (7 commands, 403 handling)"
```

---

### Task 4: Live route + profile link + README + verify

**Files:**
- Create: `web/src/app/profiles/[id]/live/page.tsx`
- Modify: `web/src/app/profiles/[id]/page.tsx` (add "Live view" link), `web/src/app/profiles/[id]/page.test.tsx` (assert the link), `web/README.md`

**Interfaces:**
- Consumes: `LivePlayer` (Task 2), `PtzControls` (Task 3), `NavBar`.
- Produces: route `/profiles/[id]/live` (auth‑gated by the existing middleware) mounting the player + PTZ; a "Live view" link on the profile detail page (success state).

- [ ] **Step 1: Write the failing detail-page test addition**

In `web/src/app/profiles/[id]/page.test.tsx`, add to the existing SUCCESS-path test:
```tsx
  expect(screen.getByRole('link', { name: /live view/i }))
    .toHaveAttribute('href', expect.stringMatching(/\/profiles\/.+\/live$/));
```
Run `cd web && pnpm test -- profiles` → FAIL (link absent).

- [ ] **Step 2: Implement**

`web/src/app/profiles/[id]/live/page.tsx`:
```tsx
'use client';
import { use } from 'react';
import NavBar from '@/components/NavBar';
import LivePlayer from '@/components/live/LivePlayer';
import PtzControls from '@/components/live/PtzControls';

export default function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Live</h1>
        <LivePlayer profileId={id} />
        <PtzControls profileId={id} />
      </main>
    </>
  );
}
```

In `web/src/app/profiles/[id]/page.tsx` (success branch, near the existing "View recordings" link), add (`Link` already imported):
```tsx
        <Link
          href={`/profiles/${id}/live`}
          className="mx-6 mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-sm"
        >
          Live view →
        </Link>
```
(Adapt placement/classNames to the file's current structure — requirement: a link with accessible name "Live view" and href `/profiles/${id}/live`, on the success state.)

- [ ] **Step 3: README**

Add a "Live view (frontend)" note to `web/README.md`: `/profiles/<id>/live` streams the camera via the authenticated `/api` proxy (go2rtc MP4); PTZ controls require `manage` permission (a view‑grantee sees a permission message); **real streaming/PTZ requires the Plan 3b services running against the camera.**

- [ ] **Step 4: Full verify**

Run: `cd web && pnpm test` (ALL green) and `pnpm build` (clean; the new `/profiles/[id]/live` route listed).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): live route + profile link + docs"
```

---

## Self-Review

**Spec coverage (design §7 live view & PTZ, frontend side):**
- Live video in the browser via the backend go2rtc proxy → Tasks 1–2 (`<video>` at `stream.mp4`). ✅
- PTZ controls driving the manage‑gated endpoint, with 403 handling → Tasks 1,3. ✅
- Route + entry point from the profile page → Task 4. ✅
- **Out of scope (Plan 3b + manual):** deploying neolink/go2rtc/broker; **real playback + real PTZ against the RLC‑823S1** — the sandbox can't verify media, so components are wired and unit‑tested and the live path is an explicit manual smoke, recorded, not assumed passing.

**Placeholder scan:** none — full code in every step. The Task‑4 link note specifies the exact requirement (accessible name + href) rather than guessing the file's current layout; the snippet is provided.

**Type consistency:** `PtzCommand` mirrors the backend `ptz.ts` union exactly (verified against `src/live/ptz.ts`); `sendPtz` body `{ command, amount? }` matches the backend `PtzDto`; `liveStreamUrl` matches the backend `GET .../live/stream.mp4` route; reuses `api`/`ApiError` and the established 403‑is‑friendly pattern from `SharePanel`/`ManagerBar`.
