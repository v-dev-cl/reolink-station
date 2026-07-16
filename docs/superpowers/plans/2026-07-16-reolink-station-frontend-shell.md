# Reolink Station — Frontend Shell + Auth + Camera Management — Implementation Plan (Plan 2b-i)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For UI polish, implementers should also load `frontend-design`.

**Goal:** A Next.js (App Router) frontend in `web/` that logs in against the existing API (cookie auth), protects routes, and lets a user create/edit camera profiles and manage shares — the shell the recordings UI (Plan 2b-ii) plugs into.

**Architecture:** Next.js 15 App Router + TypeScript + Tailwind, in a `web/` subdirectory (monorepo; backend stays at repo root). The browser only ever talks to the Next origin; a Next **rewrite proxies `/api/*` → the NestJS backend**, so the backend's httpOnly `access_token` cookie is same-origin and flows automatically — no CORS, no cross-site cookie. Middleware gates authenticated routes by the presence of the `access_token` cookie. A small typed `apiClient` wraps `fetch('/api/...')`. Server Components render data; Client Components handle forms/interactions.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, Vitest + @testing-library/react + jsdom (component tests), Playwright (one smoke e2e), pnpm, Node 22.

## Global Constraints

- **Same-origin only:** the browser never calls the backend directly; all API traffic goes through the Next `/api/*` rewrite. `BACKEND_URL` (server env) is the proxy target; never exposed to the client.
- **Never render secrets:** the API already masks secrets (`hasPass`/`hasPassword` booleans); the UI shows "set"/"not set" and a "leave blank to keep" affordance on edit — it never displays or round-trips ciphertext.
- **Auth via httpOnly cookie:** the frontend cannot read the token; it derives auth state from `GET /api/auth/me` (or cookie presence in middleware). Login posts to `/api/auth/login`; logout to `/api/auth/logout`.
- **Route protection:** unauthenticated access to any app route (except `/login`) redirects to `/login`; an authenticated user on `/login` redirects to `/`.
- **Isolation is the API's job:** the frontend passes profile ids through; the backend guard enforces access. The UI must handle 401 (→ login) and 404/403 (→ friendly message) responses.
- Node 22, pnpm frozen installs; `web/` is a self-contained package with its own `package.json`.

## File Structure

```
web/
  package.json, tsconfig.json, next.config.ts, postcss.config.mjs, vitest.config.ts, vitest.setup.ts, playwright.config.ts
  .env.example                       # BACKEND_URL=http://localhost:3000
  middleware.ts                      # cookie-gate auth
  src/
    lib/api.ts                       # typed fetch wrapper + types
    lib/api.test.ts
    app/
      layout.tsx                     # root layout + nav shell
      globals.css                    # tailwind
      page.tsx                       # camera list (home, protected)
      login/page.tsx                 # login form (client)
      profiles/new/page.tsx          # create profile
      profiles/[id]/page.tsx         # profile detail (settings + shares; recordings tab added in 2b-ii)
    components/
      LoginForm.tsx / LoginForm.test.tsx
      CameraCard.tsx / CameraCard.test.tsx
      ProfileForm.tsx / ProfileForm.test.tsx
      SharePanel.tsx / SharePanel.test.tsx
      NavBar.tsx
  e2e/
    smoke.spec.ts                    # login → list → create profile
```

New workspace: `web/` has its own `package.json`; do NOT merge its deps into the root backend package.

---

### Task 1: Scaffold Next.js in `web/` + API proxy + test harness

**Files:**
- Create: `web/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env.example`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` (placeholder), `vitest.config.ts`, `vitest.setup.ts`
- Test: `web/src/app/home.test.tsx`

**Interfaces:**
- Produces: a Next.js app that builds; a `/api/:path*` → `${BACKEND_URL}/:path*` rewrite; a Vitest+RTL harness. `next dev` serves on `:3001`.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "reolink-station-web",
  "private": true,
  "packageManager": "pnpm@10.11.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 2: Config files**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"], "allowJs": true,
    "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true,
    "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true,
    "isolatedModules": true, "jsx": "preserve", "incremental": true,
    "plugins": [{ "name": "next" }], "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`web/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/:path*` }];
  },
};
export default nextConfig;
```

`web/postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`web/.env.example`:
```
BACKEND_URL=http://localhost:3000
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
```

`web/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: App shell files**

`web/src/app/globals.css`:
```css
@import "tailwindcss";
```

`web/src/app/layout.tsx`:
```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Reolink Station' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
```

`web/src/app/page.tsx` (placeholder replaced in Task 3):
```tsx
export default function Home() {
  return <main data-testid="home">Reolink Station</main>;
}
```

- [ ] **Step 4: Write the failing test**

`web/src/app/home.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import Home from './page';

it('renders the home landmark', () => {
  render(<Home />);
  expect(screen.getByTestId('home')).toBeInTheDocument();
});
```

- [ ] **Step 5: Install, run test**

Run:
```bash
cd web && pnpm install && pnpm test
```
Expected: PASS (1 test). Also `pnpm build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): scaffold next.js app with api proxy and vitest harness"
```

---

### Task 2: Typed API client + auth (middleware, login, logout)

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/lib/api.test.ts`, `web/middleware.ts`, `web/src/components/LoginForm.tsx`, `web/src/components/LoginForm.test.tsx`, `web/src/app/login/page.tsx`
- Test: the two `.test.tsx/.test.ts` above

**Interfaces:**
- Produces: `api.get<T>(path)`, `api.post<T>(path, body)`, `api.patch`, `api.del` — all `fetch('/api'+path, { credentials: 'same-origin' })`, throwing `ApiError { status }` on non-2xx. Types: `Me { id; email; role }`, `CameraProfile { id; name; storage; camera; createdAt }` (masked shape). `LoginForm` posts to `/api/auth/login`. Middleware redirects unauthenticated → `/login`, authenticated-on-login → `/`.

- [ ] **Step 1: Write the failing tests**

`web/src/lib/api.test.ts`:
```ts
import { api, ApiError } from './api';
import { vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('GET returns parsed json', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
  await expect(api.get<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
});
it('throws ApiError with status on non-2xx', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
  await expect(api.get('/x')).rejects.toMatchObject({ status: 401 } as ApiError);
});
it('POST sends json body and credentials', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  await api.post('/auth/login', { email: 'a@b.c', password: 'x' });
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/auth/login');
  expect(init.credentials).toBe('same-origin');
  expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c', password: 'x' });
});
```

`web/src/components/LoginForm.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import LoginForm from './LoginForm';

it('submits credentials and calls onSuccess', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"1","email":"a@b.c","role":"user"}', { status: 201 })));
  const onSuccess = vi.fn();
  render(<LoginForm onSuccess={onSuccess} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
  await userEvent.type(screen.getByLabelText(/password/i), 'secret');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(onSuccess).toHaveBeenCalled();
});

it('shows an error on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 401 })));
  render(<LoginForm onSuccess={vi.fn()} />);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@b.c');
  await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`web/src/lib/api.ts`:
```ts
export class ApiError extends Error {
  constructor(public status: number, message?: string) { super(message ?? `HTTP ${status}`); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => undefined));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  del: <T>(p: string, b?: unknown) => req<T>('DELETE', p, b),
};

export interface Me { id: string; email: string; role: 'user' | 'admin' }
export interface MaskedStorage { host: string; port: number; user: string; basePath: string; hasPass: boolean }
export interface MaskedCamera { uid: string; codec: string; hasPassword: boolean }
export interface CameraProfile { id: string; name: string; storage: MaskedStorage; camera: MaskedCamera; createdAt: string }
```

`web/middleware.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login'];

export function middleware(req: NextRequest) {
  const hasToken = req.cookies.has('access_token');
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!hasToken && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (hasToken && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
```

`web/src/components/LoginForm.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.post('/auth/login', { email, password });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Invalid credentials' : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex w-80 flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">Email
        <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required className="rounded bg-neutral-800 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">Password
        <input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required className="rounded bg-neutral-800 px-3 py-2" />
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className="rounded bg-blue-600 py-2 font-medium disabled:opacity-50">Sign in</button>
    </form>
  );
}
```

`web/src/app/login/page.tsx`:
```tsx
'use client';
import { useRouter } from 'next/navigation';
import LoginForm from '@/components/LoginForm';

export default function LoginPage() {
  const router = useRouter();
  return <LoginForm onSuccess={() => router.replace('/')} />;
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): api client, cookie-auth middleware, login form"
```

---

### Task 3: Camera list (home)

**Files:**
- Modify: `web/src/app/page.tsx`
- Create: `web/src/components/CameraCard.tsx`, `web/src/components/CameraCard.test.tsx`, `web/src/components/NavBar.tsx`
- Test: `CameraCard.test.tsx`

**Interfaces:**
- Consumes: `api.get<CameraProfile[]>('/camera-profiles')`, `CameraProfile`.
- Produces: home page listing the user's cameras as `CameraCard`s (name, host, "Add camera" link); `CameraCard` links to `/profiles/[id]`.

- [ ] **Step 1: Write the failing test**

`web/src/components/CameraCard.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import CameraCard from './CameraCard';

const p = {
  id: 'abc', name: 'Front door', createdAt: '2026-07-16',
  storage: { host: 'u1-sub1.your-storagebox.de', port: 21, user: 'u1-sub1', basePath: '/reolink', hasPass: true },
  camera: { uid: 'UID', codec: 'h264', hasPassword: true },
};

it('shows the camera name and links to its detail page', () => {
  render(<CameraCard profile={p} />);
  expect(screen.getByText('Front door')).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/profiles/abc');
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && pnpm test` → FAIL.

- [ ] **Step 3: Implement**

`web/src/components/CameraCard.tsx`:
```tsx
import Link from 'next/link';
import type { CameraProfile } from '@/lib/api';

export default function CameraCard({ profile }: { profile: CameraProfile }) {
  return (
    <Link href={`/profiles/${profile.id}`}
      className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600">
      <h3 className="font-medium">{profile.name}</h3>
      <p className="mt-1 text-sm text-neutral-400">{profile.storage.host}</p>
    </Link>
  );
}
```

`web/src/components/NavBar.tsx`:
```tsx
'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function NavBar() {
  const router = useRouter();
  async function logout() { await api.post('/auth/logout'); router.replace('/login'); }
  return (
    <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
      <Link href="/" className="font-semibold">Reolink Station</Link>
      <button onClick={logout} className="text-sm text-neutral-400 hover:text-neutral-200">Sign out</button>
    </nav>
  );
}
```

`web/src/app/page.tsx` (client component fetching the list):
```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, CameraProfile } from '@/lib/api';
import CameraCard from '@/components/CameraCard';
import NavBar from '@/components/NavBar';

export default function Home() {
  const [profiles, setProfiles] = useState<CameraProfile[] | null>(null);
  useEffect(() => { api.get<CameraProfile[]>('/camera-profiles').then(setProfiles).catch(() => setProfiles([])); }, []);
  return (
    <>
      <NavBar />
      <main data-testid="home" className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Cameras</h1>
          <Link href="/profiles/new" className="rounded bg-blue-600 px-3 py-1.5 text-sm">Add camera</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(profiles ?? []).map((p) => <CameraCard key={p.id} profile={p} />)}
        </div>
        {profiles?.length === 0 && <p className="text-neutral-400">No cameras yet.</p>}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run tests** — `cd web && pnpm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(web): camera list home page + card + navbar"
```

---

### Task 4: Profile create/edit form

**Files:**
- Create: `web/src/components/ProfileForm.tsx`, `web/src/components/ProfileForm.test.tsx`, `web/src/app/profiles/new/page.tsx`, `web/src/app/profiles/[id]/page.tsx`
- Test: `ProfileForm.test.tsx`

**Interfaces:**
- Produces: `ProfileForm` handling create (`api.post('/camera-profiles', dto)`) and edit (`api.patch('/camera-profiles/:id', dto)`). On edit, secret fields render empty with placeholder "leave blank to keep"; a blank secret is omitted from the PATCH body. Body shape: `{ name, storage: { host, port, user, pass, basePath }, camera: { uid, password } }`.

- [ ] **Step 1: Write the failing test**

`web/src/components/ProfileForm.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ProfileForm from './ProfileForm';

it('creates a profile with the entered values', async () => {
  const spy = vi.fn(async () => new Response('{"id":"1"}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  const onDone = vi.fn();
  render(<ProfileForm mode="create" onDone={onDone} />);
  await userEvent.type(screen.getByLabelText(/name/i), 'Front door');
  await userEvent.type(screen.getByLabelText(/^host/i), 'u1-sub1.your-storagebox.de');
  await userEvent.type(screen.getByLabelText(/storage user/i), 'u1-sub1');
  await userEvent.type(screen.getByLabelText(/storage password/i), 'sPASS');
  await userEvent.type(screen.getByLabelText(/base path/i), '/reolink');
  await userEvent.type(screen.getByLabelText(/camera uid/i), 'UID');
  await userEvent.type(screen.getByLabelText(/camera password/i), 'cPASS');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  const body = JSON.parse(spy.mock.calls[0][1].body);
  expect(body).toMatchObject({ name: 'Front door', storage: { host: 'u1-sub1.your-storagebox.de', user: 'u1-sub1', pass: 'sPASS', basePath: '/reolink' }, camera: { uid: 'UID', password: 'cPASS' } });
  expect(onDone).toHaveBeenCalled();
});

it('omits a blank secret on edit (keep-stored)', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', spy);
  render(<ProfileForm mode="edit" profileId="p1" initial={{
    name: 'Cam', storage: { host: 'h', port: 21, user: 'u', basePath: '/reolink', hasPass: true },
    camera: { uid: 'UID', codec: 'h264', hasPassword: true },
  }} onDone={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  const body = JSON.parse(spy.mock.calls[0][1].body);
  expect(body.storage.pass).toBeUndefined();
  expect(body.camera.password).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/ProfileForm.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { api, MaskedCamera, MaskedStorage } from '@/lib/api';

type Initial = { name: string; storage: MaskedStorage; camera: MaskedCamera };

export default function ProfileForm(props:
  | { mode: 'create'; onDone: () => void }
  | { mode: 'edit'; profileId: string; initial: Initial; onDone: () => void }) {
  const init = props.mode === 'edit' ? props.initial : undefined;
  const [name, setName] = useState(init?.name ?? '');
  const [host, setHost] = useState(init?.storage.host ?? '');
  const [port, setPort] = useState(String(init?.storage.port ?? 21));
  const [sUser, setSUser] = useState(init?.storage.user ?? '');
  const [sPass, setSPass] = useState('');
  const [basePath, setBasePath] = useState(init?.storage.basePath ?? '/');
  const [uid, setUid] = useState(init?.camera.uid ?? '');
  const [cPass, setCPass] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const storage: Record<string, unknown> = { host, port: Number(port), user: sUser, basePath };
    const camera: Record<string, unknown> = { uid };
    if (sPass) storage.pass = sPass;           // blank = keep stored (edit) / required by API (create)
    if (cPass) camera.password = cPass;
    try {
      if (props.mode === 'create') await api.post('/camera-profiles', { name, storage, camera });
      else await api.patch(`/camera-profiles/${props.profileId}`, { name, storage, camera });
      props.onDone();
    } catch { setError('Could not save'); }
  }

  const editing = props.mode === 'edit';
  const secretPlaceholder = editing ? 'leave blank to keep' : '';
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <Field label="Name" value={name} onChange={setName} required />
      <Field label="Host" value={host} onChange={setHost} required />
      <Field label="Port" value={port} onChange={setPort} />
      <Field label="Storage user" value={sUser} onChange={setSUser} required />
      <Field label="Storage password" value={sPass} onChange={setSPass} type="password" placeholder={secretPlaceholder} required={!editing} />
      <Field label="Base path" value={basePath} onChange={setBasePath} required />
      <Field label="Camera UID" value={uid} onChange={setUid} required />
      <Field label="Camera password" value={cPass} onChange={setCPass} type="password" placeholder={secretPlaceholder} required={!editing} />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button className="rounded bg-blue-600 py-2">Save</button>
    </form>
  );
}

function Field({ label, value, onChange, type = 'text', required, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">{label}
      <input aria-label={label} type={type} value={value} placeholder={placeholder} required={required}
        onChange={(e) => onChange(e.target.value)} className="rounded bg-neutral-800 px-3 py-2" />
    </label>
  );
}
```

`web/src/app/profiles/new/page.tsx`:
```tsx
'use client';
import { useRouter } from 'next/navigation';
import ProfileForm from '@/components/ProfileForm';
import NavBar from '@/components/NavBar';

export default function NewProfile() {
  const router = useRouter();
  return <><NavBar /><ProfileForm mode="create" onDone={() => router.replace('/')} /></>;
}
```

`web/src/app/profiles/[id]/page.tsx` (settings + shares; recordings tab added in 2b-ii):
```tsx
'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, CameraProfile } from '@/lib/api';
import ProfileForm from '@/components/ProfileForm';
import SharePanel from '@/components/SharePanel';
import NavBar from '@/components/NavBar';

export default function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [p, setP] = useState<CameraProfile | null>(null);
  useEffect(() => { api.get<CameraProfile>(`/camera-profiles/${id}`).then(setP).catch(() => setP(null)); }, [id]);
  if (!p) return <><NavBar /><main className="p-6 text-neutral-400">Loading…</main></>;
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-md">
        <h1 className="px-6 pt-6 text-xl font-semibold">{p.name}</h1>
        <ProfileForm mode="edit" profileId={id} initial={p} onDone={() => router.replace('/')} />
        <SharePanel profileId={id} />
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run tests** — `cd web && pnpm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(web): profile create/edit form (blank secret = keep) + detail page"
```

---

### Task 5: Sharing panel

**Files:**
- Create: `web/src/components/SharePanel.tsx`, `web/src/components/SharePanel.test.tsx`
- Test: `SharePanel.test.tsx`

**Interfaces:**
- Produces: `SharePanel` — grant a share by email + permission (`api.post('/camera-profiles/:id/shares', { email, permission })`), revoke (`api.del('/camera-profiles/:id/shares/:granteeId')`). Handles 403 (not manager) with a friendly message.

- [ ] **Step 1: Write the failing test**

`web/src/components/SharePanel.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import SharePanel from './SharePanel';

it('grants a share by email + permission', async () => {
  const spy = vi.fn(async () => new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', spy);
  render(<SharePanel profileId="p1" />);
  await userEvent.type(screen.getByLabelText(/share with email/i), 'parent@x.com');
  await userEvent.selectOptions(screen.getByLabelText(/permission/i), 'view');
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  const [url, init] = spy.mock.calls[0];
  expect(url).toBe('/api/camera-profiles/p1/shares');
  expect(JSON.parse(init.body)).toEqual({ email: 'parent@x.com', permission: 'view' });
});

it('shows a friendly message when the caller lacks manage (403)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 403 })));
  render(<SharePanel profileId="p1" />);
  await userEvent.type(screen.getByLabelText(/share with email/i), 'x@y.z');
  await userEvent.click(screen.getByRole('button', { name: /share/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement**

`web/src/components/SharePanel.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export default function SharePanel({ profileId }: { profileId: string }) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'manage'>('view');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function share(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api.post(`/camera-profiles/${profileId}/shares`, { email, permission });
      setMsg(`Shared with ${email}`); setEmail('');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'You need manage permission to share'
        : err instanceof ApiError && err.status === 404 ? 'No user with that email' : 'Could not share');
    }
  }

  return (
    <section className="border-t border-neutral-800 p-6">
      <h2 className="mb-2 font-medium">Sharing</h2>
      <form onSubmit={share} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm">Share with email
          <input aria-label="Share with email" type="email" value={email} required
            onChange={(e) => setEmail(e.target.value)} className="rounded bg-neutral-800 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Permission
          <select aria-label="Permission" value={permission}
            onChange={(e) => setPermission(e.target.value as 'view' | 'manage')} className="rounded bg-neutral-800 px-3 py-2">
            <option value="view">View</option>
            <option value="manage">Manage</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {msg && <p className="text-sm text-green-400">{msg}</p>}
        <button className="rounded bg-blue-600 py-2">Share</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run tests** — `cd web && pnpm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(web): sharing panel (grant by email + permission, 403 handling)"
```

---

### Task 6: Playwright smoke (login → list → create) + README

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/smoke.spec.ts`, `web/README.md`
- Modify: `web/package.json` (already has `e2e` script)

**Interfaces:**
- Produces: one Playwright test that, against a running full stack (backend on :3000 with a seeded user, web on :3001), logs in, sees the camera list, and creates a profile. Documented as opt-in (requires the stack + seed), not part of `pnpm test`.

- [ ] **Step 1: Playwright config + smoke test**

`web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3001' },
});
```

`web/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

// Requires: backend running on :3000 with a user TEST_EMAIL/TEST_PASSWORD, web on :3001.
const email = process.env.TEST_EMAIL ?? 'e2e@x.com';
const password = process.env.TEST_PASSWORD ?? 'password123';

test('login → camera list → create profile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Cameras' })).toBeVisible();
  await page.getByRole('link', { name: /add camera/i }).click();
  await expect(page.getByLabel('Name')).toBeVisible();
});
```

- [ ] **Step 2: README**

`web/README.md` documents: `pnpm install`, `pnpm dev` (needs `BACKEND_URL`), `pnpm test` (component tests, no stack), and the opt-in `pnpm e2e` (needs the backend + a seeded user + web running). Note the cookie-proxy model (all API calls go through `/api/*`).

- [ ] **Step 3: Verify build + component tests**

Run: `cd web && pnpm test && pnpm build`
Expected: all component tests pass; production build succeeds. (Playwright smoke is opt-in; do not gate the task on a running backend — document how to run it.)

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "test(web): playwright smoke (opt-in) + web README"
```

---

## Self-Review

**Spec coverage (design §3 frontend, §5 sharing):**
- Next.js App Router + Tailwind, self-hosted-ready → Task 1. ✅
- Login (cookie auth) + route protection → Task 2. ✅
- Camera list → Task 3. ✅
- Profile create/edit with masked secrets + "leave blank to keep" → Task 4. ✅
- View/manage sharing UI → Task 5. ✅
- **Out of this plan (2b-ii):** recordings browser, video player, delete/prune UI — the `/profiles/[id]` page has the seam (a recordings tab) to add them.

**Placeholder scan:** No TBD/TODO. The Playwright smoke is explicitly opt-in (needs a running stack) and documented as such — not a missing test but an integration test with stated prerequisites; component behavior is covered by Vitest tests that stub `fetch`.

**Type consistency:** `CameraProfile`/`MaskedStorage`/`MaskedCamera` (Task 2) match the backend's masked read shape (`hasPass`/`hasPassword`, no ciphertext) from Plan 1's `camera-profile.masking.ts`; the create/edit body shape (`{name, storage:{host,port,user,pass,basePath}, camera:{uid,password}}`) matches the backend `CreateCameraProfileDto`/`UpdateCameraProfileDto`; share body `{email, permission}` matches `CreateShareDto`; blank-secret-omitted matches the backend's "blank = keep stored" update semantics.

**Security:** the browser never sees the backend origin or `BACKEND_URL` (server-only, used in the rewrite); secrets are never rendered (masked booleans only); auth is httpOnly-cookie via same-origin proxy; middleware gates every non-public route; API 401/403/404 are handled in the UI.
