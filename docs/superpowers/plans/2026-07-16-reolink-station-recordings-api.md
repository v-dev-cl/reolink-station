# Reolink Station — Recordings & Manager API — Implementation Plan (Plan 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, tenant-scoped endpoints to the existing NestJS API that browse, stream (with HTTP Range), delete, and prune a camera profile's recordings on its Hetzner Storage Box over pooled SFTP.

**Architecture:** A `SftpPoolService` (generic-pool over `ssh2-sftp-client`, ≤4 connections per box) provides short-lived connections keyed by host+port+user. A `RecordingsService` uses a profile's decrypted storage creds (`CameraProfilesService.findOneDecryptedForConnection`) to list/stat/stream/delete/prune, with every client-supplied path confined to the profile's `base_path` by a `resolveSafe` helper. Controllers reuse the existing `JwtAuthGuard` + `CameraAccessGuard` (`@RequireManage` for mutations). A short-TTL in-memory cache backs directory listings.

**Tech Stack:** NestJS 11, `ssh2-sftp-client`, `generic-pool`, Jest + Supertest, an `atmoz/sftp` test container. Builds on the merged backend (`master`).

## Global Constraints

- **Path safety (security-critical):** every client-supplied path/dir is resolved against the profile's `base_path` and REJECTED if it escapes it (no `..`, no absolute-outside). This is the must-pass security property of this plan.
- **Isolation unchanged:** all recording routes live under `/camera-profiles/:id/...` and pass through `JwtAuthGuard` + `CameraAccessGuard`; mutations (delete, prune) additionally require `@RequireManage()`. No new path to a profile bypasses the existing chokepoint.
- **Connection cap:** ≤4 pooled SFTP connections per box (Hetzner allows 10 per sub-account; stay well under). Connections are released back to the pool, and idle ones evicted.
- **Secrets:** storage creds are only ever obtained via `findOneDecryptedForConnection` server-side and used to open SFTP; never logged, never returned to clients.
- **Streaming:** file responses support HTTP Range (`206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`) so video seeks work; Content-Type by extension (`.mp4`→`video/mp4`, `.jpg`→`image/jpeg`).
- **Tests use real SFTP:** integration/e2e tests run against a disposable `atmoz/sftp` container (not mocks), seeded with fixture files.
- Node 22, pnpm, snake_case DB, e2e serialized (`jest-e2e.json` `maxWorkers:1`) — all as established in Plan 1.

## File Structure

```
src/recordings/
  sftp-pool.service.ts        # generic-pool<ssh2-sftp-client>, keyed by conn, max 4/box
  sftp-pool.module.ts
  path-safety.ts              # resolveSafe(basePath, relative) -> absolute or throws
  recordings.service.ts       # list/stat/openRead/delete/prune over a profile's box
  recordings.cache.ts         # tiny TTL cache for listings
  recordings.controller.ts    # GET list, GET file (Range) — view-gated
  recordings-manager.controller.ts  # POST delete, POST prune — manage-gated
  recordings.module.ts
  dto/{delete-recordings,prune-recordings}.dto.ts
  types.ts                    # RecordingEntry, RangeSpec
docker-compose.test.yml       # + sftp-test service (modify)
test/recordings.e2e-spec.ts   # seeded-SFTP e2e
```

New deps: `ssh2-sftp-client`, `generic-pool` (+ `@types/ssh2-sftp-client` if needed).

---

### Task 1: Deps + test SFTP container + path-safety helper

**Files:**
- Modify: `package.json` (add deps), `docker-compose.test.yml` (add `sftp-test`)
- Create: `src/recordings/path-safety.ts`, `src/recordings/types.ts`
- Test: `src/recordings/path-safety.spec.ts`

**Interfaces:**
- Produces: `resolveSafe(basePath: string, relative: string): string` — returns the joined POSIX absolute path, or throws `ForbiddenException` if it escapes `basePath`. `RecordingEntry { name: string; path: string; type: 'dir'|'file'; size: number; mtime: number }`. `RangeSpec { start: number; end: number }`.

- [ ] **Step 1: Add deps + test container**

`package.json` dependencies — add:
```json
    "generic-pool": "^3.9.0",
    "ssh2-sftp-client": "^11.0.0"
```
devDependencies — add:
```json
    "@types/ssh2-sftp-client": "^9.0.4"
```
`docker-compose.test.yml` — add service:
```yaml
  sftp-test:
    image: atmoz/sftp:alpine
    command: testuser:testpass:::reolink
    ports: ["2222:22"]
```
Run `pnpm install` (regenerates lockfile), `docker compose -f docker-compose.test.yml up -d`.

- [ ] **Step 2: Write the failing path-safety test**

`src/recordings/path-safety.spec.ts`:
```ts
import { ForbiddenException } from '@nestjs/common';
import { resolveSafe } from './path-safety';

describe('resolveSafe', () => {
  const base = '/reolink';
  it('joins a clean relative path under base', () => {
    expect(resolveSafe(base, '2026/07/15/clip.mp4')).toBe('/reolink/2026/07/15/clip.mp4');
  });
  it('treats empty/./ as the base itself', () => {
    expect(resolveSafe(base, '')).toBe('/reolink');
    expect(resolveSafe(base, '.')).toBe('/reolink');
  });
  it('rejects parent-traversal', () => {
    expect(() => resolveSafe(base, '../secret')).toThrow(ForbiddenException);
    expect(() => resolveSafe(base, '2026/../../etc')).toThrow(ForbiddenException);
  });
  it('rejects an absolute path that escapes base', () => {
    expect(() => resolveSafe(base, '/etc/passwd')).toThrow(ForbiddenException);
  });
  it('rejects a sibling-prefix escape', () => {
    expect(() => resolveSafe('/reolink', '../reolink-evil/x')).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- path-safety`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `path-safety.ts` and `types.ts`**

`src/recordings/types.ts`:
```ts
export interface RecordingEntry {
  name: string;
  path: string; // relative to the profile base_path
  type: 'dir' | 'file';
  size: number;
  mtime: number; // epoch ms
}
export interface RangeSpec { start: number; end: number }
```

`src/recordings/path-safety.ts`:
```ts
import { ForbiddenException } from '@nestjs/common';
import * as path from 'node:path';

/**
 * Resolve `relative` under `basePath` (both POSIX). Returns the absolute path
 * if and only if it stays within basePath; throws ForbiddenException otherwise.
 */
export function resolveSafe(basePath: string, relative: string): string {
  const base = path.posix.normalize(basePath).replace(/\/+$/, '') || '/';
  // Reject absolute inputs outright; callers pass paths relative to base.
  const rel = (relative ?? '').replace(/^\/+/, '');
  const resolved = path.posix.normalize(path.posix.join(base, rel));
  if (resolved !== base && !resolved.startsWith(base + '/')) {
    throw new ForbiddenException('path escapes base directory');
  }
  return resolved;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- path-safety`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(recordings): add sftp deps, test container, and path-safety helper"
```

---

### Task 2: SFTP connection pool

**Files:**
- Create: `src/recordings/sftp-pool.service.ts`, `src/recordings/sftp-pool.module.ts`
- Test: `src/recordings/sftp-pool.service.spec.ts`

**Interfaces:**
- Consumes: none (leaf service).
- Produces: `SftpConnConfig { host: string; port: number; user: string; pass: string }`; `SftpPoolService.withConnection<T>(cfg: SftpConnConfig, fn: (client: SftpClient) => Promise<T>): Promise<T>` — acquires a pooled `ssh2-sftp-client` for that box, runs `fn`, releases it. `onModuleDestroy` drains all pools. Max 4 per connection key (`host:port:user`).

- [ ] **Step 1: Write the failing integration test**

`src/recordings/sftp-pool.service.spec.ts`:
```ts
import { SftpPoolService, SftpConnConfig } from './sftp-pool.service';

const cfg: SftpConnConfig = { host: '127.0.0.1', port: 2222, user: 'testuser', pass: 'testpass' };

describe('SftpPoolService (integration, needs sftp-test container)', () => {
  let pool: SftpPoolService;
  beforeAll(() => { pool = new SftpPoolService(); });
  afterAll(async () => { await pool.onModuleDestroy(); });

  it('runs an operation against a real SFTP box', async () => {
    const list = await pool.withConnection(cfg, (c) => c.list('/reolink'));
    expect(Array.isArray(list)).toBe(true);
  });

  it('serves many concurrent ops without exceeding the pool (no errors)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => pool.withConnection(cfg, (c) => c.exists('/reolink'))),
    );
    expect(results.every((r) => r !== false)).toBe(true);
  });

  it('rejects with the operation error but still releases the connection', async () => {
    await expect(
      pool.withConnection(cfg, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // pool still usable afterwards:
    await expect(pool.withConnection(cfg, (c) => c.exists('/reolink'))).resolves.not.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- sftp-pool`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pool**

`src/recordings/sftp-pool.service.ts`:
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool } from 'generic-pool';
import SftpClient from 'ssh2-sftp-client';

export interface SftpConnConfig { host: string; port: number; user: string; pass: string }

const MAX_PER_BOX = 4;
const IDLE_MS = 30_000;

@Injectable()
export class SftpPoolService implements OnModuleDestroy {
  private readonly pools = new Map<string, Pool<SftpClient>>();

  private key(c: SftpConnConfig): string { return `${c.host}:${c.port}:${c.user}`; }

  private poolFor(cfg: SftpConnConfig): Pool<SftpClient> {
    const k = this.key(cfg);
    let pool = this.pools.get(k);
    if (!pool) {
      pool = createPool<SftpClient>(
        {
          create: async () => {
            const client = new SftpClient();
            await client.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.pass });
            return client;
          },
          destroy: async (client) => { await client.end().catch(() => undefined); },
          validate: async (client) => {
            try { await client.exists('.'); return true; } catch { return false; }
          },
        },
        { max: MAX_PER_BOX, min: 0, idleTimeoutMillis: IDLE_MS, testOnBorrow: true, acquireTimeoutMillis: 20_000 },
      );
      this.pools.set(k, pool);
    }
    return pool;
  }

  async withConnection<T>(cfg: SftpConnConfig, fn: (client: SftpClient) => Promise<T>): Promise<T> {
    const pool = this.poolFor(cfg);
    const client = await pool.acquire();
    try {
      return await fn(client);
    } finally {
      await pool.release(client);
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.drain();
      await pool.clear();
    }
    this.pools.clear();
  }
}
```

`src/recordings/sftp-pool.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SftpPoolService } from './sftp-pool.service';

@Module({ providers: [SftpPoolService], exports: [SftpPoolService] })
export class SftpPoolModule {}
```

*Implementer note:* `ssh2-sftp-client` types — confirm `connect`, `list`, `exists`, `end` signatures against the installed version (v11). If `validate` with `exists('.')` misbehaves under the pool, use `client.cwd()` instead. Keep the `withConnection` contract identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- sftp-pool`
Expected: PASS (3 tests) against the running `sftp-test` container.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(recordings): pooled ssh2-sftp-client connection service (max 4/box)"
```

---

### Task 3: Recordings service (list/stat/read/delete/prune)

**Files:**
- Create: `src/recordings/recordings.service.ts`
- Test: `src/recordings/recordings.service.spec.ts`

**Interfaces:**
- Consumes: `SftpPoolService`, `CameraProfilesService.findOneDecryptedForConnection(id)` (returns `{ storage: { host, port, user, pass, basePath }, camera }`).
- Produces:
  - `listDir(profileId: string, relDir: string): Promise<RecordingEntry[]>`
  - `openRead(profileId: string, relPath: string, range?: RangeSpec): Promise<{ stream: Readable; size: number }>`
  - `stat(profileId: string, relPath: string): Promise<{ size: number; mtime: number }>`
  - `deleteFiles(profileId: string, relPaths: string[]): Promise<{ deleted: number }>`
  - `prune(profileId: string, olderThanDays: number): Promise<{ deleted: number }>`
  - All confine paths via `resolveSafe(storage.basePath, rel)`.

- [ ] **Step 1: Write the failing integration test** (seeds the container, then exercises the service)

`src/recordings/recordings.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { SftpPoolModule } from './sftp-pool.module';
import { SftpPoolService } from './sftp-pool.service';
import { RecordingsService } from './recordings.service';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';

const STORAGE = { host: '127.0.0.1', port: 2222, user: 'testuser', pass: 'testpass', basePath: '/reolink' };

// Fake profiles service returning fixed decrypted creds for a known id.
const fakeProfiles = {
  findOneDecryptedForConnection: async (id: string) => ({ id, storage: STORAGE, camera: { uid: 'x', password: 'y', codec: 'h264' } }),
} as unknown as CameraProfilesService;

describe('RecordingsService (integration)', () => {
  let svc: RecordingsService;
  let pool: SftpPoolService;
  const P = 'profile-1';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [SftpPoolModule],
      providers: [RecordingsService, { provide: CameraProfilesService, useValue: fakeProfiles }],
    }).compile();
    svc = mod.get(RecordingsService);
    pool = mod.get(SftpPoolService);
    // seed: /reolink/2026/07/15/{clip.mp4, shot.jpg} and an old file /reolink/2000/01/01/old.mp4
    await pool.withConnection(STORAGE, async (c) => {
      await c.mkdir('/reolink/2026/07/15', true);
      await c.mkdir('/reolink/2000/01/01', true);
      await c.put(Buffer.from('hello-mp4-bytes'), '/reolink/2026/07/15/clip.mp4');
      await c.put(Buffer.from('jpgdata'), '/reolink/2026/07/15/shot.jpg');
      await c.put(Buffer.from('old'), '/reolink/2000/01/01/old.mp4');
    });
  });
  afterAll(async () => {
    await pool.withConnection(STORAGE, async (c) => { await c.rmdir('/reolink', true).catch(() => undefined); });
    await pool.onModuleDestroy();
  });

  it('lists a directory with type/size/mtime', async () => {
    const entries = await svc.listDir(P, '2026/07/15');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['clip.mp4', 'shot.jpg']);
    const clip = entries.find((e) => e.name === 'clip.mp4')!;
    expect(clip.type).toBe('file');
    expect(clip.size).toBe(15);
    expect(clip.path).toBe('2026/07/15/clip.mp4');
  });

  it('reads a byte range', async () => {
    const { stream, size } = await svc.openRead(P, '2026/07/15/clip.mp4', { start: 0, end: 4 });
    expect(size).toBe(15);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('rejects a traversal path', async () => {
    await expect(svc.listDir(P, '../../etc')).rejects.toThrow();
  });

  it('deletes specific files', async () => {
    const { deleted } = await svc.deleteFiles(P, ['2026/07/15/shot.jpg']);
    expect(deleted).toBe(1);
    const entries = await svc.listDir(P, '2026/07/15');
    expect(entries.map((e) => e.name)).toEqual(['clip.mp4']);
  });

  it('prunes files older than N days', async () => {
    const { deleted } = await svc.prune(P, 30);
    expect(deleted).toBeGreaterThanOrEqual(1); // the 2000/01/01/old.mp4
    const gone = await svc.listDir(P, '2000/01/01').catch(() => []);
    expect(gone.find((e) => e.name === 'old.mp4')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- recordings.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `recordings.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { SftpConnConfig, SftpPoolService } from './sftp-pool.service';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';
import { resolveSafe } from './path-safety';
import { RangeSpec, RecordingEntry } from './types';

@Injectable()
export class RecordingsService {
  constructor(
    private readonly pool: SftpPoolService,
    private readonly profiles: CameraProfilesService,
  ) {}

  private async conn(profileId: string): Promise<{ cfg: SftpConnConfig; base: string }> {
    const p = await this.profiles.findOneDecryptedForConnection(profileId);
    const s = p.storage;
    return { cfg: { host: s.host, port: s.port, user: s.user, pass: s.pass }, base: s.basePath };
  }

  async listDir(profileId: string, relDir: string): Promise<RecordingEntry[]> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relDir);
    return this.pool.withConnection(cfg, async (c) => {
      const items = await c.list(abs);
      return items.map((i) => ({
        name: i.name,
        path: relJoin(relDir, i.name),
        type: i.type === 'd' ? 'dir' : 'file',
        size: i.size,
        mtime: i.modifyTime,
      }));
    });
  }

  async stat(profileId: string, relPath: string): Promise<{ size: number; mtime: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relPath);
    return this.pool.withConnection(cfg, async (c) => {
      const st = await c.stat(abs).catch(() => { throw new NotFoundException('file not found'); });
      return { size: st.size, mtime: st.modifyTime };
    });
  }

  async openRead(profileId: string, relPath: string, range?: RangeSpec): Promise<{ stream: Readable; size: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relPath);
    const st = await this.stat(profileId, relPath);
    // Buffer the (ranged) bytes through the pooled connection, then release it.
    const buf = await this.pool.withConnection(cfg, async (c) => {
      const opts = range ? { readStreamOptions: { start: range.start, end: range.end } } : undefined;
      return (await c.get(abs, undefined, opts as never)) as Buffer;
    });
    return { stream: Readable.from(buf), size: st.size };
  }

  async deleteFiles(profileId: string, relPaths: string[]): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abses = relPaths.map((r) => resolveSafe(base, r));
    return this.pool.withConnection(cfg, async (c) => {
      let deleted = 0;
      for (const abs of abses) {
        try { await c.delete(abs); deleted++; } catch { /* already gone */ }
      }
      return { deleted };
    });
  }

  async prune(profileId: string, olderThanDays: number): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const cutoff = daysAgoEpoch(olderThanDays);
    return this.pool.withConnection(cfg, async (c) => {
      let deleted = 0;
      const walk = async (dir: string): Promise<void> => {
        const items = await c.list(dir);
        for (const i of items) {
          const full = `${dir}/${i.name}`;
          if (i.type === 'd') await walk(full);
          else if (i.modifyTime < cutoff) { try { await c.delete(full); deleted++; } catch { /* ignore */ } }
        }
      };
      await walk(resolveSafe(base, ''));
      return { deleted };
    });
  }
}

function relJoin(dir: string, name: string): string {
  const d = (dir ?? '').replace(/^\/+|\/+$/g, '');
  return d ? `${d}/${name}` : name;
}
function daysAgoEpoch(days: number): number {
  // pure arithmetic (no Date.now allowed to vary in tests? callers pass real days) —
  // use Date via injected clock in prod; here compute from Date at call time.
  return Date.now() - days * 24 * 60 * 60 * 1000;
}
```

*Implementer notes:* (1) `ssh2-sftp-client`'s `list()` returns items with `.type` (`'-'|'d'|'l'`), `.size`, `.modifyTime` (ms) — verify field names against the installed version and adjust the mapping only. (2) For `get()` with a range, confirm the option path (`readStreamOptions.start/end`); if the installed API differs, obtain the raw stream via the client and slice — keep `openRead`'s return contract identical. (3) `daysAgoEpoch` uses `Date.now()` — that's fine in app code (the no-`Date.now` rule is workflow-script-only).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- recordings.service`
Expected: PASS (5 tests) against the seeded container.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(recordings): recordings service (list/stat/read-range/delete/prune) with path confinement"
```

---

### Task 4: Read controller — list + Range file streaming (view-gated)

**Files:**
- Create: `src/recordings/recordings.controller.ts`, `src/recordings/recordings.module.ts`
- Modify: `src/app.module.ts` (import `RecordingsModule`)
- Test: `test/recordings.e2e-spec.ts` (list + range parts)

**Interfaces:**
- Consumes: `RecordingsService`, `JwtAuthGuard`, `CameraAccessGuard`, `CameraProfilesService` (to create a test profile pointing at the container).
- Produces routes (all `@UseGuards(JwtAuthGuard, CameraAccessGuard)`):
  - `GET /camera-profiles/:id/recordings/list?dir=<rel>` → `RecordingEntry[]`
  - `GET /camera-profiles/:id/recordings/file?path=<rel>` → streams bytes; honors `Range`; `200` full or `206` partial.

- [ ] **Step 1: Write the failing e2e** (creates a real profile pointing at the sftp-test box, seeds it, logs in, lists + ranges)

`test/recordings.e2e-spec.ts` (list + range portion — the full file also covers Task 5):
```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { CameraProfilesService } from '../src/camera-profiles/camera-profiles.service';
import { SftpPoolService } from '../src/recordings/sftp-pool.service';

const STORAGE = { host: '127.0.0.1', port: 2222, user: 'testuser', pass: 'testpass', basePath: '/reolink' };

describe('Recordings (e2e)', () => {
  let app: INestApplication; let users: UsersService; let auth: AuthService;
  let profiles: CameraProfilesService; let pool: SftpPoolService;
  let cookie: string; let profileId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService);
    profiles = mod.get(CameraProfilesService); pool = mod.get(SftpPoolService);

    await users['repo'].clear();
    const u = await users.create('rec@x.com', await auth.hashPassword('pw'));
    cookie = `access_token=${auth.signToken(u)}`;
    const p = await profiles.create(u.id, {
      name: 'Cam', storage: { host: STORAGE.host, port: STORAGE.port, user: STORAGE.user, pass: STORAGE.pass, basePath: STORAGE.basePath },
      camera: { uid: 'UID', password: 'cp' },
    });
    profileId = p.id;
    await pool.withConnection(STORAGE, async (c) => {
      await c.mkdir('/reolink/2026/07/15', true);
      await c.put(Buffer.from('0123456789'), '/reolink/2026/07/15/clip.mp4');
    });
  });
  afterAll(async () => {
    await pool.withConnection(STORAGE, async (c) => { await c.rmdir('/reolink', true).catch(() => undefined); });
    await app.close();
  });

  it('lists a directory', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/list?dir=2026/07/15`).set('Cookie', cookie).expect(200);
    expect(res.body.map((e: any) => e.name)).toContain('clip.mp4');
  });

  it('streams a byte range (206)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).set('Range', 'bytes=0-4').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-4/10');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.text).toBe('01234');
  });

  it('serves the full file (200) without a Range header', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).expect(200);
    expect(res.text).toBe('0123456789');
  });

  it('a non-owner cannot list (404)', async () => {
    const other = await users.create('other@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/list?dir=`).set('Cookie', `access_token=${auth.signToken(other)}`).expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- recordings`
Expected: FAIL (routes 404 / module missing).

- [ ] **Step 3: Implement controller + module**

`src/recordings/recordings.controller.ts`:
```ts
import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard } from '../sharing/camera-access.guard';
import { RecordingsService } from './recordings.service';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id/recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get('list')
  list(@Param('id') id: string, @Query('dir') dir = '') {
    return this.recordings.listDir(id, dir);
  }

  @Get('file')
  async file(
    @Param('id') id: string,
    @Query('path') path: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { size } = await this.recordings.stat(id, path);
    const range = parseRange(req.headers.range, size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType(path));
    if (range) {
      const { stream } = await this.recordings.openRead(id, path, range);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      stream.pipe(res);
    } else {
      const { stream } = await this.recordings.openRead(id, path);
      res.status(200);
      res.setHeader('Content-Length', String(size));
      stream.pipe(res);
    }
  }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? 0 : parseInt(m[1], 10);
  let end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) { start = 0; end = size - 1; }
  return { start, end };
}
function contentType(p: string): string {
  if (p.endsWith('.mp4')) return 'video/mp4';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
```

`src/recordings/recordings.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SftpPoolModule } from './sftp-pool.module';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { SharingModule } from '../sharing/sharing.module';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';

@Module({
  imports: [SftpPoolModule, CameraProfilesModule, SharingModule],
  providers: [RecordingsService],
  controllers: [RecordingsController],
  exports: [RecordingsService],
})
export class RecordingsModule {}
```
Add `RecordingsModule` to `AppModule` imports. (`SharingModule` export of `CameraAccessGuard`/`CameraAccessService` is used by the guard; confirm `CameraAccessGuard` is exported from `SharingModule`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:e2e -- recordings`
Expected: the list + range + 200 + non-owner-404 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(recordings): view-gated list + Range file streaming endpoints"
```

---

### Task 5: Manager controller — delete + prune (manage-gated)

**Files:**
- Create: `src/recordings/recordings-manager.controller.ts`, `dto/delete-recordings.dto.ts`, `dto/prune-recordings.dto.ts`
- Modify: `src/recordings/recordings.module.ts` (register the controller)
- Test: extend `test/recordings.e2e-spec.ts`

**Interfaces:**
- Produces (all `@UseGuards(JwtAuthGuard, CameraAccessGuard)` + `@RequireManage()`):
  - `POST /camera-profiles/:id/recordings/delete` body `{ paths: string[] }` → `{ deleted: number }`
  - `POST /camera-profiles/:id/recordings/prune` body `{ olderThanDays: number }` → `{ deleted: number }`

- [ ] **Step 1: Write the failing e2e additions**

Append to `test/recordings.e2e-spec.ts`:
```ts
  it('owner deletes a file (manage)', async () => {
    await pool.withConnection(STORAGE, async (c) => { await c.put(Buffer.from('x'), '/reolink/2026/07/15/todelete.mp4'); });
    const res = await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/delete`).set('Cookie', cookie)
      .send({ paths: ['2026/07/15/todelete.mp4'] }).expect(201);
    expect(res.body.deleted).toBe(1);
  });

  it('a view grantee cannot delete (403)', async () => {
    const viewer = await users.create('viewer@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/shares`).set('Cookie', cookie)
      .send({ email: 'viewer@x.com', permission: 'view' }).expect(201);
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/delete`).set('Cookie', `access_token=${auth.signToken(viewer)}`)
      .send({ paths: ['2026/07/15/clip.mp4'] }).expect(403);
  });

  it('prune rejects a traversal path implicitly and deletes old files', async () => {
    await pool.withConnection(STORAGE, async (c) => { await c.mkdir('/reolink/2000/01/01', true); await c.put(Buffer.from('old'), '/reolink/2000/01/01/old.mp4'); });
    const res = await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/prune`).set('Cookie', cookie)
      .send({ olderThanDays: 30 }).expect(201);
    expect(res.body.deleted).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- recordings`
Expected: the new cases FAIL (routes missing).

- [ ] **Step 3: Implement DTOs + manager controller**

`src/recordings/dto/delete-recordings.dto.ts`:
```ts
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
export class DeleteRecordingsDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) paths!: string[];
}
```
`src/recordings/dto/prune-recordings.dto.ts`:
```ts
import { IsInt, Min } from 'class-validator';
export class PruneRecordingsDto {
  @IsInt() @Min(1) olderThanDays!: number;
}
```
`src/recordings/recordings-manager.controller.ts`:
```ts
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard, RequireManage } from '../sharing/camera-access.guard';
import { RecordingsService } from './recordings.service';
import { DeleteRecordingsDto } from './dto/delete-recordings.dto';
import { PruneRecordingsDto } from './dto/prune-recordings.dto';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@RequireManage()
@Controller('camera-profiles/:id/recordings')
export class RecordingsManagerController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post('delete')
  remove(@Param('id') id: string, @Body() dto: DeleteRecordingsDto) {
    return this.recordings.deleteFiles(id, dto.paths);
  }

  @Post('prune')
  prune(@Param('id') id: string, @Body() dto: PruneRecordingsDto) {
    return this.recordings.prune(id, dto.olderThanDays);
  }
}
```
Register `RecordingsManagerController` in `RecordingsModule.controllers` alongside `RecordingsController`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:e2e -- recordings`
Expected: all recordings e2e cases PASS (list, range, 200, non-owner 404, delete, view-403, prune).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(recordings): manage-gated delete + prune endpoints"
```

---

### Task 6: Listing cache + wire-up + full suite

**Files:**
- Create: `src/recordings/recordings.cache.ts`
- Modify: `src/recordings/recordings.service.ts` (cache `listDir`), `recordings.module.ts`
- Test: `src/recordings/recordings.cache.spec.ts`

**Interfaces:**
- Produces: `TtlCache<T>` with `get(key)`, `set(key, val)`, `invalidate(prefix)`; `listDir` results cached with a short TTL keyed by `profileId:relDir`, invalidated on `deleteFiles`/`prune` for that profile.

- [ ] **Step 1: Write the failing cache test**

`src/recordings/recordings.cache.spec.ts`:
```ts
import { TtlCache } from './recordings.cache';

describe('TtlCache', () => {
  it('returns a cached value within ttl and misses after invalidate', () => {
    const c = new TtlCache<number>(1000);
    c.set('profile-1:a', 5);
    expect(c.get('profile-1:a')).toBe(5);
    c.invalidate('profile-1:');
    expect(c.get('profile-1:a')).toBeUndefined();
  });
  it('does not leak across prefixes on invalidate', () => {
    const c = new TtlCache<number>(1000);
    c.set('profile-1:a', 1); c.set('profile-2:a', 2);
    c.invalidate('profile-1:');
    expect(c.get('profile-2:a')).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- recordings.cache`
Expected: FAIL.

- [ ] **Step 3: Implement cache + wire into service**

`src/recordings/recordings.cache.ts`:
```ts
export class TtlCache<T> {
  private readonly store = new Map<string, { val: T; exp: number }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp < now()) { this.store.delete(key); return undefined; }
    return e.val;
  }
  set(key: string, val: T): void { this.store.set(key, { val, exp: now() + this.ttlMs }); }
  invalidate(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }
}
function now(): number { return Date.now(); }
```
In `recordings.service.ts`: add `private readonly listCache = new TtlCache<RecordingEntry[]>(10_000);` Wrap `listDir` to check/populate `listCache` keyed by `${profileId}:${relDir}`; in `deleteFiles` and `prune`, call `this.listCache.invalidate(`${profileId}:`)` after mutation.

- [ ] **Step 4: Run test + full suites**

Run: `pnpm test -- recordings.cache` (PASS), then `pnpm test` and `pnpm test:e2e` (all green), `pnpm build` (clean).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(recordings): short-TTL listing cache invalidated on mutation"
```

---

## Self-Review

**Spec coverage (design §6 Recordings & manager):**
- SFTP proxy, pooled ≤4/box → Task 2. ✅
- List `/YYYY/MM/DD` → Task 3/4 (generic dir listing the frontend walks). ✅
- Stream with HTTP Range → Task 4. ✅
- `.jpg` thumbnails → served by the same `file` endpoint (they're just files); no separate endpoint (YAGNI). ✅
- Delete (single/bulk) + manual "delete older than N days" → Task 5. ✅
- Lazy cache → Task 6. ✅
- Tenant scoping via existing guard → Tasks 4/5 (view for read, manage for mutate) + non-owner-404 e2e. ✅
- **Out of this plan (2b):** the Next.js UI (browser/player/manager screens) — recorded, not accidental.

**Placeholder scan:** No TBD/TODO. Two implementer-notes flag library-specific fields (`ssh2-sftp-client` `list()`/`get()` shapes) to verify against the installed version — these are verification instructions, not missing code; the behavior and contracts are fully specified.

**Type consistency:** `SftpConnConfig {host,port,user,pass}` used by pool + service; `RecordingEntry`/`RangeSpec` from `types.ts` consistent across service/controller; `findOneDecryptedForConnection` return (`{storage:{host,port,user,pass,basePath}}`) matches Plan 1's Task 6 producer; guard/`@RequireManage` reused unchanged from Plan 1.

**Security focus:** every path param flows through `resolveSafe` (Task 1, tested for traversal/absolute/sibling-prefix escapes); mutations are `@RequireManage`; non-owner access is 404 (existing guard); creds never leave the server. The path-safety and isolation properties each have dedicated failing-first tests.
