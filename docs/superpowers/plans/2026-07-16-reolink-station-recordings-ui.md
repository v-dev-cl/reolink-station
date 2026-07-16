# Reolink Station — Recordings Browser + Player + Manager UI — Implementation Plan (Plan 2b-ii)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Next.js frontend a recordings UI per camera profile: browse the `YYYY/MM/DD` folder tree, view `.jpg` thumbnails, play `.mp4` clips (native `<video>` over the backend's Range endpoint), select + delete files, and prune by age.

**Architecture:** All data flows through the existing same-origin `/api/*` proxy and cookie auth — `<img>`/`<video>` tags point straight at `/api/camera-profiles/:id/recordings/file?path=…` (the browser attaches the cookie automatically; the backend already serves Range/206). A small `lib/recordings.ts` wraps the four endpoints. Components: `RecordingTile` (file card), `PlayerModal` (video/image overlay), `ManagerBar` (delete/prune, manage-gated server-side), and `RecordingsBrowser` (folder navigation + selection + composition), mounted on a new `/profiles/[id]/recordings` route linked from the profile detail page.

**Tech Stack:** Existing `web/` stack — Next.js 15 App Router, React 19, Tailwind v4, Vitest + RTL (fetch-stubbed, stack-free). No new dependencies.

## Global Constraints

- **Same-origin media only:** every listing/file URL is `/api/...` (never the backend origin); `dir`/`path` query values are `encodeURIComponent`-ed. No tokens in URLs — the httpOnly cookie authenticates media requests automatically.
- **Destructive actions guarded:** delete and prune require a `window.confirm`, are disabled while in flight, and a 403 (view-grantee) renders a friendly "need manage permission" message — never a raw error.
- **Fresh after mutation:** after a successful delete/prune, the listing is re-fetched and the selection cleared (backend cache invalidates server-side).
- **Server is the authority:** path safety and access control are backend concerns; the UI just passes ids/paths through and handles 401 (already auto-redirects via `api.ts`), 403, 404, and 5xx gracefully.
- **Tests stay stack-free:** all Vitest tests stub `fetch` (and `confirm` where needed); `pnpm test` runs with no backend.
- Follow existing `web/` conventions: the `api` client, `aria-label`s, `role="alert"` for errors, neutral-palette Tailwind.

## Backend contract consumed (from Plan 2a — verify names only, do not change)

- `GET /camera-profiles/:id/recordings/list?dir=<rel>` → `RecordingEntry[]` where `RecordingEntry { name: string; path: string; type: 'dir'|'file'; size: number; mtime: number }` (`path` relative to the profile base, `mtime` epoch ms).
- `GET /camera-profiles/:id/recordings/file?path=<rel>` → bytes; `Content-Type` video/mp4 or image/jpeg; supports Range.
- `POST /camera-profiles/:id/recordings/delete { paths: string[] }` → `{ deleted: number }` (201; 403 for view-grantee).
- `POST /camera-profiles/:id/recordings/prune { olderThanDays: number }` → `{ deleted: number }` (201; 403 for view-grantee).

## File Structure

```
web/src/lib/recordings.ts               # types + endpoint wrappers + isVideo/isImage
web/src/lib/recordings.test.ts
web/src/components/recordings/
  RecordingTile.tsx / .test.tsx         # file card: img thumbnail or play placeholder, checkbox, open
  PlayerModal.tsx / .test.tsx           # <video controls> / <img> overlay
  ManagerBar.tsx / .test.tsx            # delete-selected + prune (confirm, 403 handling)
  RecordingsBrowser.tsx / .test.tsx     # dir state, breadcrumb, grid, selection, composition
web/src/app/profiles/[id]/recordings/page.tsx   # route
(modify) web/src/app/profiles/[id]/page.tsx     # "View recordings" link
(modify) web/src/app/profiles/[id]/page.test.tsx # assert the link
(modify) web/README.md                          # recordings section
```

---

### Task 1: Recordings API client (`lib/recordings.ts`)

**Files:**
- Create: `web/src/lib/recordings.ts`
- Test: `web/src/lib/recordings.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `RecordingEntry { name: string; path: string; type: 'dir'|'file'; size: number; mtime: number }`
  - `listRecordings(profileId: string, dir?: string): Promise<RecordingEntry[]>`
  - `recordingFileUrl(profileId: string, path: string): string` — returns `/api/camera-profiles/${profileId}/recordings/file?path=${encodeURIComponent(path)}`
  - `deleteRecordings(profileId: string, paths: string[]): Promise<{ deleted: number }>`
  - `pruneRecordings(profileId: string, olderThanDays: number): Promise<{ deleted: number }>`
  - `isVideo(name: string): boolean`, `isImage(name: string): boolean`

- [ ] **Step 1: Write the failing test**

`web/src/lib/recordings.test.ts`:
```ts
import { vi, afterEach } from 'vitest';
import {
  listRecordings, recordingFileUrl, deleteRecordings, pruneRecordings, isVideo, isImage,
} from './recordings';

afterEach(() => { vi.unstubAllGlobals(); });

it('listRecordings encodes the dir into the query', async () => {
  const spy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  await listRecordings('p1', '2026/07/15');
  expect(spy.mock.calls[0][0]).toBe('/api/camera-profiles/p1/recordings/list?dir=2026%2F07%2F15');
});

it('listRecordings defaults to the root dir', async () => {
  const spy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  await listRecordings('p1');
  expect(spy.mock.calls[0][0]).toBe('/api/camera-profiles/p1/recordings/list?dir=');
});

it('recordingFileUrl encodes the path', () => {
  expect(recordingFileUrl('p1', '2026/07/15/a b.mp4'))
    .toBe('/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fa%20b.mp4');
});

it('deleteRecordings posts the paths array', async () => {
  const spy = vi.fn(async () => new Response('{"deleted":2}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await expect(deleteRecordings('p1', ['a.mp4', 'b.jpg'])).resolves.toEqual({ deleted: 2 });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/recordings/delete');
  expect(JSON.parse(init.body)).toEqual({ paths: ['a.mp4', 'b.jpg'] });
});

it('pruneRecordings posts olderThanDays', async () => {
  const spy = vi.fn(async () => new Response('{"deleted":5}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await expect(pruneRecordings('p1', 30)).resolves.toEqual({ deleted: 5 });
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ olderThanDays: 30 });
});

it('classifies file kinds by extension (case-insensitive)', () => {
  expect(isVideo('clip.mp4')).toBe(true);
  expect(isVideo('CLIP.MP4')).toBe(true);
  expect(isImage('shot.jpg')).toBe(true);
  expect(isImage('shot.JPEG')).toBe(true);
  expect(isVideo('shot.jpg')).toBe(false);
  expect(isImage('clip.mp4')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /home/vampfernmsi/WebstormProjects/reolink-station/web && pnpm test -- recordings`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`web/src/lib/recordings.ts`:
```ts
import { api } from './api';

export interface RecordingEntry {
  name: string;
  path: string; // relative to the profile's storage base path
  type: 'dir' | 'file';
  size: number;
  mtime: number; // epoch ms
}

export function listRecordings(profileId: string, dir = ''): Promise<RecordingEntry[]> {
  return api.get<RecordingEntry[]>(
    `/camera-profiles/${profileId}/recordings/list?dir=${encodeURIComponent(dir)}`,
  );
}

/** Same-origin media URL — the httpOnly cookie authenticates it automatically. */
export function recordingFileUrl(profileId: string, path: string): string {
  return `/api/camera-profiles/${profileId}/recordings/file?path=${encodeURIComponent(path)}`;
}

export function deleteRecordings(profileId: string, paths: string[]): Promise<{ deleted: number }> {
  return api.post<{ deleted: number }>(`/camera-profiles/${profileId}/recordings/delete`, { paths });
}

export function pruneRecordings(profileId: string, olderThanDays: number): Promise<{ deleted: number }> {
  return api.post<{ deleted: number }>(`/camera-profiles/${profileId}/recordings/prune`, { olderThanDays });
}

export function isVideo(name: string): boolean {
  return /\.mp4$/i.test(name);
}
export function isImage(name: string): boolean {
  return /\.jpe?g$/i.test(name);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && pnpm test -- recordings`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): recordings api client (list/file-url/delete/prune)"
```

---

### Task 2: `RecordingTile` + `PlayerModal`

**Files:**
- Create: `web/src/components/recordings/RecordingTile.tsx`, `RecordingTile.test.tsx`, `PlayerModal.tsx`, `PlayerModal.test.tsx`

**Interfaces:**
- Consumes: `recordingFileUrl`, `isImage`, `isVideo`, `RecordingEntry` (Task 1).
- Produces:
  - `RecordingTile({ profileId, entry, selected, onToggle, onOpen })` — image thumbnail (via `recordingFileUrl`) or a ▶ placeholder for videos; a checkbox (`aria-label` \`Select ${entry.name}\`) firing `onToggle`; the main surface fires `onOpen`.
  - `PlayerModal({ profileId, entry, onClose })` — `role="dialog"`; `<video data-testid="player" controls autoPlay>` for videos, `<img>` for images; Close button + backdrop click → `onClose`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/recordings/RecordingTile.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import RecordingTile from './RecordingTile';

const img = { name: 'shot.jpg', path: '2026/07/15/shot.jpg', type: 'file' as const, size: 2, mtime: 0 };
const vid = { name: 'clip.mp4', path: '2026/07/15/clip.mp4', type: 'file' as const, size: 5, mtime: 0 };

it('renders an image thumbnail pointing at the file endpoint', () => {
  render(<RecordingTile profileId="p1" entry={img} selected={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.getByRole('img')).toHaveAttribute(
    'src', '/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fshot.jpg',
  );
});

it('renders a play placeholder (no img) for videos', () => {
  render(<RecordingTile profileId="p1" entry={vid} selected={false} onToggle={vi.fn()} onOpen={vi.fn()} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('fires onOpen and onToggle independently', async () => {
  const onOpen = vi.fn(); const onToggle = vi.fn();
  render(<RecordingTile profileId="p1" entry={vid} selected={false} onToggle={onToggle} onOpen={onOpen} />);
  await userEvent.click(screen.getByRole('button', { name: /open clip.mp4/i }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('checkbox', { name: /select clip.mp4/i }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledTimes(1); // toggling must not open
});
```

`web/src/components/recordings/PlayerModal.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PlayerModal from './PlayerModal';

const vid = { name: 'clip.mp4', path: '2026/07/15/clip.mp4', type: 'file' as const, size: 5, mtime: 0 };
const img = { name: 'shot.jpg', path: '2026/07/15/shot.jpg', type: 'file' as const, size: 2, mtime: 0 };

it('renders a video element with the file url for mp4', () => {
  render(<PlayerModal profileId="p1" entry={vid} onClose={vi.fn()} />);
  expect(screen.getByTestId('player')).toHaveAttribute(
    'src', '/api/camera-profiles/p1/recordings/file?path=2026%2F07%2F15%2Fclip.mp4',
  );
});

it('renders an img (not video) for jpg', () => {
  render(<PlayerModal profileId="p1" entry={img} onClose={vi.fn()} />);
  expect(screen.getByRole('img')).toBeInTheDocument();
  expect(screen.queryByTestId('player')).not.toBeInTheDocument();
});

it('close button calls onClose', async () => {
  const onClose = vi.fn();
  render(<PlayerModal profileId="p1" entry={vid} onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && pnpm test -- recordings/` → FAIL.

- [ ] **Step 3: Implement**

`web/src/components/recordings/RecordingTile.tsx`:
```tsx
'use client';
import { isImage, recordingFileUrl, RecordingEntry } from '@/lib/recordings';

export default function RecordingTile({ profileId, entry, selected, onToggle, onOpen }: {
  profileId: string;
  entry: RecordingEntry;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="relative rounded-lg border border-neutral-800 bg-neutral-900 p-2">
      <input
        aria-label={`Select ${entry.name}`}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="absolute left-3 top-3 z-10 h-4 w-4 accent-blue-600"
      />
      <button aria-label={`Open ${entry.name}`} onClick={onOpen} className="block w-full">
        {isImage(entry.name) ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin media; next/image optimization would break the cookie flow
          <img
            src={recordingFileUrl(profileId, entry.path)}
            alt={entry.name}
            loading="lazy"
            className="h-28 w-full rounded object-cover"
          />
        ) : (
          <div className="flex h-28 w-full items-center justify-center rounded bg-neutral-800 text-3xl">▶</div>
        )}
      </button>
      <p className="mt-1 truncate text-xs text-neutral-400">{entry.name}</p>
    </div>
  );
}
```

`web/src/components/recordings/PlayerModal.tsx`:
```tsx
'use client';
import { isImage, recordingFileUrl, RecordingEntry } from '@/lib/recordings';

export default function PlayerModal({ profileId, entry, onClose }: {
  profileId: string;
  entry: RecordingEntry;
  onClose: () => void;
}) {
  const url = recordingFileUrl(profileId, entry.path);
  return (
    <div
      role="dialog"
      aria-label={entry.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="max-h-full w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        {isImage(entry.name) ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin media
          <img src={url} alt={entry.name} className="mx-auto max-h-[80vh] rounded" />
        ) : (
          <video data-testid="player" src={url} controls autoPlay className="mx-auto max-h-[80vh] w-full rounded" />
        )}
        <div className="mt-2 flex items-center justify-between text-sm text-neutral-300">
          <span className="truncate">{entry.name}</span>
          <button onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 hover:bg-neutral-700">Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- recordings/` → PASS (6 tests across the two files).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): recording tile and player modal (range-backed video/image)"
```

---

### Task 3: `ManagerBar` (delete selected + prune)

**Files:**
- Create: `web/src/components/recordings/ManagerBar.tsx`, `ManagerBar.test.tsx`

**Interfaces:**
- Consumes: `deleteRecordings`, `pruneRecordings` (Task 1), `ApiError` (`@/lib/api`).
- Produces: `ManagerBar({ profileId, selected, onMutated })` — `selected: string[]` (relative paths); "Delete selected (N)" disabled at 0 or while busy, `window.confirm`-guarded; prune with a numeric days input (integer ≥ 1, validated client-side) and its own confirm; on success shows "Deleted N file(s)" and calls `onMutated()`; 403 → "need manage permission" `role="alert"`.

- [ ] **Step 1: Write the failing test**

`web/src/components/recordings/ManagerBar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import ManagerBar from './ManagerBar';

afterEach(() => { vi.unstubAllGlobals(); });

it('deletes the selection after confirmation and reports the count', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn(async () => new Response('{"deleted":2}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  const onMutated = vi.fn();
  render(<ManagerBar profileId="p1" selected={['a.mp4', 'b.jpg']} onMutated={onMutated} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected \(2\)/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ paths: ['a.mp4', 'b.jpg'] });
  expect(await screen.findByText(/deleted 2 files/i)).toBeInTheDocument();
  expect(onMutated).toHaveBeenCalled();
});

it('makes no request when confirmation is declined', async () => {
  vi.stubGlobal('confirm', vi.fn(() => false));
  const spy = vi.fn();
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={['a.mp4']} onMutated={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
  expect(spy).not.toHaveBeenCalled();
});

it('shows the manage-permission message on 403', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<ManagerBar profileId="p1" selected={['a.mp4']} onMutated={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/manage permission/i);
});

it('prunes with the entered day count', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn(async () => new Response('{"deleted":7}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  const days = screen.getByLabelText(/older than days/i);
  await userEvent.clear(days);
  await userEvent.type(days, '60');
  await userEvent.click(screen.getByRole('button', { name: /prune/i }));
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ olderThanDays: 60 });
  expect(await screen.findByText(/deleted 7 files/i)).toBeInTheDocument();
});

it('rejects an invalid day count without a request', async () => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  const spy = vi.fn();
  vi.stubGlobal('fetch', spy);
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  const days = screen.getByLabelText(/older than days/i);
  await userEvent.clear(days);
  await userEvent.click(screen.getByRole('button', { name: /prune/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/i);
  expect(spy).not.toHaveBeenCalled();
});

it('delete is disabled when nothing is selected', () => {
  render(<ManagerBar profileId="p1" selected={[]} onMutated={vi.fn()} />);
  expect(screen.getByRole('button', { name: /delete selected \(0\)/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/recordings/ManagerBar.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { deleteRecordings, pruneRecordings } from '@/lib/recordings';

export default function ManagerBar({ profileId, selected, onMutated }: {
  profileId: string;
  selected: string[];
  onMutated: () => void;
}) {
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ deleted: number }>) {
    setError(''); setMsg(''); setBusy(true);
    try {
      const { deleted } = await fn();
      setMsg(`Deleted ${deleted} file${deleted === 1 ? '' : 's'}`);
      onMutated();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? 'You need manage permission to delete recordings'
        : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!selected.length) return;
    if (!window.confirm(`Delete ${selected.length} selected file(s)? This cannot be undone.`)) return;
    await run(() => deleteRecordings(profileId, selected));
  }

  async function prune() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) { setError('Days must be a whole number of at least 1'); return; }
    if (!window.confirm(`Delete ALL recordings older than ${n} days? This cannot be undone.`)) return;
    await run(() => pruneRecordings(profileId, n));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <button
        onClick={del}
        disabled={busy || selected.length === 0}
        className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        Delete selected ({selected.length})
      </button>
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="prune-days">Older than</label>
        <input
          id="prune-days"
          aria-label="Older than days"
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20 rounded bg-neutral-800 px-2 py-1"
        />
        <span>days</span>
        <button onClick={prune} disabled={busy} className="rounded bg-red-900 px-3 py-1.5 disabled:opacity-50">
          Prune
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {msg && <p className="text-sm text-green-400">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- ManagerBar` → PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): recordings manager bar (confirm-guarded delete + prune, 403 handling)"
```

---

### Task 4: `RecordingsBrowser` (navigation + selection + composition)

**Files:**
- Create: `web/src/components/recordings/RecordingsBrowser.tsx`, `RecordingsBrowser.test.tsx`

**Interfaces:**
- Consumes: `listRecordings`, `RecordingEntry` (Task 1); `RecordingTile`, `PlayerModal` (Task 2); `ManagerBar` (Task 3).
- Produces: `RecordingsBrowser({ profileId })` — folder navigation with breadcrumb (root labeled "Recordings"), dirs sorted name-desc (newest date first), files sorted mtime-desc; per-file selection (cleared on dir change and after mutation); `PlayerModal` on open; `ManagerBar` wired with `onMutated` → clear selection + refresh; loading/empty/error states (`role="alert"` for errors).

- [ ] **Step 1: Write the failing test**

`web/src/components/recordings/RecordingsBrowser.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, afterEach } from 'vitest';
import RecordingsBrowser from './RecordingsBrowser';

afterEach(() => { vi.unstubAllGlobals(); });

const root = [{ name: '2026', path: '2026', type: 'dir', size: 0, mtime: 0 }];
const files = [
  { name: 'clip.mp4', path: '2026/clip.mp4', type: 'file', size: 5, mtime: 2 },
  { name: 'shot.jpg', path: '2026/shot.jpg', type: 'file', size: 2, mtime: 1 },
];

function stubListing() {
  return vi.fn(async (url: string) => {
    const dir = new URL(url, 'http://x').searchParams.get('dir') ?? '';
    return new Response(JSON.stringify(dir === '' ? root : files), { status: 200 });
  });
}

it('lists folders at the root and drills down to files', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  expect(await screen.findByText('clip.mp4')).toBeInTheDocument();
  expect(screen.getByText('shot.jpg')).toBeInTheDocument();
});

it('breadcrumb returns to the root listing', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  await screen.findByText('clip.mp4');
  await userEvent.click(screen.getByRole('button', { name: /^recordings$/i }));
  expect(await screen.findByRole('button', { name: /open folder 2026/i })).toBeInTheDocument();
});

it('opens the player when a file is opened', async () => {
  vi.stubGlobal('fetch', stubListing());
  render(<RecordingsBrowser profileId="p1" />);
  await userEvent.click(await screen.findByRole('button', { name: /open folder 2026/i }));
  await userEvent.click(await screen.findByRole('button', { name: /open clip.mp4/i }));
  expect(screen.getByRole('dialog', { name: 'clip.mp4' })).toBeInTheDocument();
});

it('shows an alert when listing fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
  render(<RecordingsBrowser profileId="p1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
});

it('shows an empty state for a folder with no entries', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  render(<RecordingsBrowser profileId="p1" />);
  expect(await screen.findByText(/no recordings/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/recordings/RecordingsBrowser.tsx`:
```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { listRecordings, RecordingEntry } from '@/lib/recordings';
import RecordingTile from './RecordingTile';
import PlayerModal from './PlayerModal';
import ManagerBar from './ManagerBar';

export default function RecordingsBrowser({ profileId }: { profileId: string }) {
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<RecordingEntry[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<RecordingEntry | null>(null);

  const refresh = useCallback(() => {
    setEntries(null);
    setError('');
    listRecordings(profileId, dir)
      .then(setEntries)
      .catch(() => { setError('Could not load recordings'); setEntries([]); });
  }, [profileId, dir]);

  useEffect(() => { setSelected(new Set()); refresh(); }, [refresh]);

  const dirs = (entries ?? []).filter((e) => e.type === 'dir').sort((a, b) => b.name.localeCompare(a.name));
  const files = (entries ?? []).filter((e) => e.type === 'file').sort((a, b) => b.mtime - a.mtime);
  const crumbs = dir ? dir.split('/') : [];

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-neutral-400">
        <button onClick={() => setDir('')} className="hover:text-neutral-200">Recordings</button>
        {crumbs.map((seg, i) => (
          <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-1">
            <span>/</span>
            <button onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))} className="hover:text-neutral-200">
              {seg}
            </button>
          </span>
        ))}
      </nav>

      {entries === null && <p className="text-neutral-400">Loading…</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {entries?.length === 0 && !error && <p className="text-neutral-400">No recordings in this folder.</p>}

      {dirs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dirs.map((d) => (
            <button
              key={d.path}
              aria-label={`Open folder ${d.name}`}
              onClick={() => setDir(d.path)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm hover:border-neutral-600"
            >
              📁 {d.name}
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {files.map((f) => (
              <RecordingTile
                key={f.path}
                profileId={profileId}
                entry={f}
                selected={selected.has(f.path)}
                onToggle={() => toggle(f.path)}
                onOpen={() => setOpen(f)}
              />
            ))}
          </div>
          <ManagerBar
            profileId={profileId}
            selected={[...selected]}
            onMutated={() => { setSelected(new Set()); refresh(); }}
          />
        </>
      )}

      {open && <PlayerModal profileId={profileId} entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd web && pnpm test -- RecordingsBrowser` → PASS (5 tests). Then the full `pnpm test` (all green).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): recordings browser (breadcrumb nav, selection, player, manager)"
```

---

### Task 5: Route page + detail-page link + README + full verify

**Files:**
- Create: `web/src/app/profiles/[id]/recordings/page.tsx`
- Modify: `web/src/app/profiles/[id]/page.tsx` (add a "View recordings" link), `web/src/app/profiles/[id]/page.test.tsx` (assert the link), `web/README.md` (recordings section)

**Interfaces:**
- Consumes: `RecordingsBrowser` (Task 4), `NavBar`.
- Produces: route `/profiles/[id]/recordings` (auth-gated by the existing middleware matcher automatically); a prominent link on the profile detail page.

- [ ] **Step 1: Write the failing test additions**

In `web/src/app/profiles/[id]/page.test.tsx`, add to the existing SUCCESS-path test (reuse its rendered profile id — whatever id that test already uses):
```tsx
  expect(screen.getByRole('link', { name: /view recordings/i }))
    .toHaveAttribute('href', expect.stringMatching(/\/profiles\/.+\/recordings$/));
```
Run `cd web && pnpm test -- profiles` → FAIL (link absent).

- [ ] **Step 2: Implement**

`web/src/app/profiles/[id]/recordings/page.tsx`:
```tsx
'use client';
import { use } from 'react';
import NavBar from '@/components/NavBar';
import RecordingsBrowser from '@/components/recordings/RecordingsBrowser';

export default function RecordingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-semibold">Recordings</h1>
        <RecordingsBrowser profileId={id} />
      </main>
    </>
  );
}
```

In `web/src/app/profiles/[id]/page.tsx`, inside the success-rendered `<main>`, directly after the `<h1>` block, add (import `Link` from `next/link`):
```tsx
        <Link
          href={`/profiles/${id}/recordings`}
          className="mx-6 mt-2 inline-block rounded bg-blue-600 px-3 py-1.5 text-sm"
        >
          View recordings →
        </Link>
```
(Adapt placement/classNames to the file's current structure — the requirement is: a link with accessible name "View recordings" and href `/profiles/${id}/recordings`, visible on the success state.)

- [ ] **Step 3: README**

Add a "Recordings" subsection to `web/README.md`: browse per-camera recordings at `/profiles/<id>/recordings`; thumbnails/video stream through the authenticated `/api` proxy (Range-backed seeking); delete/prune need `manage` permission on the profile.

- [ ] **Step 4: Full verify**

Run: `cd web && pnpm test` (ALL green — expect ~42 tests) and `pnpm build` (clean; new route listed).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): recordings route + profile link + docs"
```

---

## Self-Review

**Spec coverage (design §6 recordings & manager, frontend side):**
- Browse `/YYYY/MM/DD` → Tasks 1+4 (generic dir navigation + breadcrumb). ✅
- Thumbnails (`.jpg` via file endpoint) → Task 2 tile. ✅
- Play clips with seeking → Task 2 `PlayerModal` (`<video>` over the Range endpoint). ✅
- Delete (bulk via selection) + manual "older than N days" prune → Task 3, wired in Task 4. ✅
- 403 for view-grantees handled as a friendly message (server enforces; UI degrades). ✅
- Route + entry point → Task 5. ✅
- **Not in scope (recorded):** live view (Plan 3); a shares list/revoke UI (blocked on backend `GET /shares`); download button (browser can save from the player/`recordingFileUrl` directly — deferred as polish).

**Placeholder scan:** none — every step carries full code; the one "adapt placement" note (Task 5 link) specifies the exact requirement (accessible name + href) rather than guessing the current file's line layout, with the snippet provided.

**Type consistency:** `RecordingEntry` matches Plan 2a's backend `types.ts` field-for-field; endpoint paths/bodies match `recordings.controller.ts` / `recordings-manager.controller.ts` (`{paths}`, `{olderThanDays}`, 201 responses); `recordingFileUrl` matches the `file?path=` query contract; `ApiError`/`api` reused from 2b-i unchanged; `PlayerModal`/`RecordingTile`/`ManagerBar` props consumed by Task 4 exactly as produced in Tasks 2–3.
