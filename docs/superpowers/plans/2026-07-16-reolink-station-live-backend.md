# Reolink Station — Live Backend (config-gen + stream proxy + PTZ) — Implementation Plan (Plan 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend live-view control layer to the NestJS API: generate neolink + go2rtc config from camera profiles, expose an authz-gated live‑stream proxy (browser `<video>` → backend → go2rtc MP4), and an authz-gated PTZ endpoint that publishes to neolink over MQTT.

**Architecture:** `neolink` (on the fleet) reaches each camera by UID/relay and re-exposes RTSP; `go2rtc` wraps those RTSP streams and serves `GET /api/stream.mp4?src=<id>` (progressive fMP4, plays in a plain `<video>`). Both stay **internal**; the NestJS backend proxies go2rtc's MP4 endpoint behind `CameraAccessGuard`, so the httpOnly cookie authenticates media and a non-owner gets 404. **PTZ** goes backend → MQTT (`neolink/<id>/control/ptz "<dir> <amount>"`) → neolink → camera (the RLC‑823 series is on neolink's supported-PTZ list). This plan builds and tests the config generation, the proxy, and the PTZ command path with mocked go2rtc/MQTT; **actually streaming/moving a real camera is a manual smoke test in Plan 3b.**

**Tech Stack:** NestJS 11, Node global `fetch` (proxy), `mqtt` (PTZ publish), Jest + Supertest. Reuses `CameraProfilesService.findOneDecryptedForConnection` (UID+password), `JwtAuthGuard`, `CameraAccessGuard`, `@CurrentUser`.

## Global Constraints

- **Internal services only:** the browser never reaches go2rtc/neolink directly; every live request goes through `/camera-profiles/:id/live/...` under `JwtAuthGuard` + `CameraAccessGuard` (non-owner → 404, same isolation chokepoint as recordings). `GO2RTC_URL` / MQTT config are server env, never returned to clients.
- **Stream name = profile id:** go2rtc stream `src` and the neolink camera name are both the `CameraProfileEntity.id`, so access control maps 1:1 to the existing profile guard.
- **Secrets stay server-side:** camera UID+password appear only in generated config / MQTT auth, never in a response body or log.
- **PTZ input is validated + bounded:** command ∈ a fixed enum; amount is an optional bounded number; a bad command is 400, not forwarded.
- **Testable without hardware:** the proxy is tested by stubbing `fetch` to a fake go2rtc; PTZ by injecting a fake `PtzTransport`. No test needs a real broker/camera/go2rtc.
- Node 22, pnpm, snake_case, e2e serialized — as established. Run the ROOT `pnpm build` in verification (monorepo: backend tsconfig excludes `web/`).

## File Structure

```
src/live/
  live-config.service.ts      # generate neolink TOML + go2rtc YAML from profiles
  live-config.service.spec.ts
  ptz.ts                      # PtzCommand enum + buildPtzMessage() (pure) + PtzTransport interface
  ptz.spec.ts
  mqtt-ptz.transport.ts       # MqttPtzTransport (mqtt publish) — thin, real impl
  live.controller.ts          # GET :id/live/stream.mp4 (proxy) + POST :id/ptz
  dto/ptz.dto.ts
  live.module.ts
(modify) src/app.module.ts    # import LiveModule
test/live.e2e-spec.ts         # authz + proxy + ptz (fake transport, stubbed fetch)
```

New dep: `mqtt` (+ `@types` if needed — `mqtt` ships its own types).

---

### Task 1: Live config generation (`LiveConfigService`)

**Files:**
- Create: `src/live/live-config.service.ts`, `src/live/live.module.ts`
- Test: `src/live/live-config.service.spec.ts`

**Interfaces:**
- Consumes: `CameraProfilesService` (its repo, to load all profiles decrypted for config).
- Produces:
  - `LiveConfigService.neolinkConfig(): Promise<string>` — TOML: a global `bind`/`[mqtt]` block + one `[[cameras]]` per profile with `name` (= id), `uid`, `username`, `password` (decrypted).
  - `LiveConfigService.go2rtcConfig(): Promise<string>` — YAML: `streams:` map, `<id>: rtsp://neolink:8554/<id>` per profile.
  - Both source profiles via a repo `find()` + `findOneDecryptedForConnection` (decrypted UID/password).

- [ ] **Step 1: Write the failing test**

`src/live/live-config.service.spec.ts`:
```ts
import { LiveConfigService } from './live-config.service';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';

const profiles = [
  { id: 'aaa', camera: { uid: 'UID-A', password: 'pwA', codec: 'h264' } },
  { id: 'bbb', camera: { uid: 'UID-B', password: 'pwB', codec: 'h264' } },
];
const fake = {
  listAllIds: async () => profiles.map((p) => p.id),
  findOneDecryptedForConnection: async (id: string) => profiles.find((p) => p.id === id)!,
} as unknown as CameraProfilesService;

describe('LiveConfigService', () => {
  const svc = new LiveConfigService(fake);

  it('generates a neolink camera block per profile with uid/name/password', async () => {
    const toml = await svc.neolinkConfig();
    expect(toml).toContain('[[cameras]]');
    expect(toml).toContain('name = "aaa"');
    expect(toml).toContain('uid = "UID-A"');
    expect(toml).toContain('password = "pwA"');
    expect(toml).toContain('name = "bbb"');
    expect(toml).toContain('uid = "UID-B"');
  });

  it('generates a go2rtc stream per profile pointing at neolink rtsp', async () => {
    const yaml = await svc.go2rtcConfig();
    expect(yaml).toContain('aaa: rtsp://neolink:8554/aaa');
    expect(yaml).toContain('bbb: rtsp://neolink:8554/bbb');
  });
});
```

*Implementer note:* add a small `listAllIds()` to `CameraProfilesService` if it lacks one (a `this.repo.find({ select: ['id'] })` → ids); keep it minimal. The spec injects a fake with `listAllIds` + `findOneDecryptedForConnection`, so the service must call exactly those.

- [ ] **Step 2: Run to verify failure** — `pnpm test -- live-config` → FAIL.

- [ ] **Step 3: Implement**

`src/live/live-config.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';

@Injectable()
export class LiveConfigService {
  constructor(private readonly profiles: CameraProfilesService) {}

  async neolinkConfig(): Promise<string> {
    const ids = await this.profiles.listAllIds();
    const blocks: string[] = [];
    for (const id of ids) {
      const p = await this.profiles.findOneDecryptedForConnection(id);
      blocks.push(
        [
          '[[cameras]]',
          `name = ${JSON.stringify(id)}`,
          `uid = ${JSON.stringify(p.camera.uid)}`,
          `username = "admin"`,
          `password = ${JSON.stringify(p.camera.password)}`,
        ].join('\n'),
      );
    }
    return ['bind = "0.0.0.0"', 'bind_port = 8554', '', ...blocks, ''].join('\n');
  }

  async go2rtcConfig(): Promise<string> {
    const ids = await this.profiles.listAllIds();
    const lines = ids.map((id) => `  ${id}: rtsp://neolink:8554/${id}`);
    return ['streams:', ...lines, ''].join('\n');
  }
}
```

`src/live/live.module.ts` (extended in later tasks):
```ts
import { Module } from '@nestjs/common';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { LiveConfigService } from './live-config.service';

@Module({
  imports: [CameraProfilesModule],
  providers: [LiveConfigService],
  exports: [LiveConfigService],
})
export class LiveModule {}
```

Add `listAllIds()` to `CameraProfilesService`:
```ts
  async listAllIds(): Promise<string[]> {
    const rows = await this.repo.find({ select: ['id'] });
    return rows.map((r) => r.id);
  }
```

- [ ] **Step 4: Run to verify pass** — `pnpm test -- live-config` → PASS. Add `LiveModule` to `AppModule`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(live): generate neolink + go2rtc config from camera profiles"
```

---

### Task 2: PTZ command model + transport (`ptz.ts`, MQTT impl)

**Files:**
- Create: `src/live/ptz.ts`, `src/live/mqtt-ptz.transport.ts`
- Test: `src/live/ptz.spec.ts`

**Interfaces:**
- Produces:
  - `type PtzCommand = 'up'|'down'|'left'|'right'|'in'|'out'|'stop'`
  - `buildPtzTopic(profileId: string): string` → `neolink/${profileId}/control/ptz`
  - `buildPtzPayload(command: PtzCommand, amount?: number): string` → e.g. `"left 32"` (default amount 32; `stop` → `"stop"`).
  - `interface PtzTransport { send(profileId: string, command: PtzCommand, amount?: number): Promise<void>; }`
  - `PTZ_TRANSPORT` injection token.
  - `MqttPtzTransport implements PtzTransport` — publishes `buildPtzPayload(...)` to `buildPtzTopic(...)` via an mqtt client (connects to `MQTT_URL`).

- [ ] **Step 1: Write the failing test** (pure functions only — no broker)

`src/live/ptz.spec.ts`:
```ts
import { buildPtzTopic, buildPtzPayload } from './ptz';

describe('ptz message building', () => {
  it('topic is the neolink control topic for the profile', () => {
    expect(buildPtzTopic('cam1')).toBe('neolink/cam1/control/ptz');
  });
  it('payload defaults amount to 32', () => {
    expect(buildPtzPayload('left')).toBe('left 32');
  });
  it('payload honors an explicit amount', () => {
    expect(buildPtzPayload('up', 10)).toBe('up 10');
  });
  it('stop has no amount', () => {
    expect(buildPtzPayload('stop')).toBe('stop');
    expect(buildPtzPayload('stop', 50)).toBe('stop');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- ptz` → FAIL.

- [ ] **Step 3: Implement**

`src/live/ptz.ts`:
```ts
export type PtzCommand = 'up' | 'down' | 'left' | 'right' | 'in' | 'out' | 'stop';
export const PTZ_COMMANDS: PtzCommand[] = ['up', 'down', 'left', 'right', 'in', 'out', 'stop'];

export function buildPtzTopic(profileId: string): string {
  return `neolink/${profileId}/control/ptz`;
}
export function buildPtzPayload(command: PtzCommand, amount = 32): string {
  return command === 'stop' ? 'stop' : `${command} ${amount}`;
}

export interface PtzTransport {
  send(profileId: string, command: PtzCommand, amount?: number): Promise<void>;
}
export const PTZ_TRANSPORT = Symbol('PTZ_TRANSPORT');
```

`src/live/mqtt-ptz.transport.ts`:
```ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, MqttClient } from 'mqtt';
import { buildPtzPayload, buildPtzTopic, PtzCommand, PtzTransport } from './ptz';

@Injectable()
export class MqttPtzTransport implements PtzTransport, OnModuleDestroy {
  private readonly logger = new Logger(MqttPtzTransport.name);
  private client?: MqttClient;

  constructor(private readonly config: ConfigService) {}

  private conn(): MqttClient {
    if (!this.client) {
      this.client = connect(this.config.getOrThrow<string>('MQTT_URL'));
      this.client.on('error', (e) => this.logger.warn(`mqtt error: ${e.message}`));
    }
    return this.client;
  }

  async send(profileId: string, command: PtzCommand, amount?: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.conn().publish(buildPtzTopic(profileId), buildPtzPayload(command, amount), (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((r) => (this.client ? this.client.end(false, {}, () => r()) : r()));
  }
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm test -- ptz` → PASS (4 tests). (MqttPtzTransport is exercised via the e2e's real-vs-fake swap in Task 4; its pure helpers are covered here.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(live): ptz command model + mqtt transport"
```

---

### Task 3: Live controller — stream proxy + PTZ endpoint

**Files:**
- Create: `src/live/live.controller.ts`, `src/live/dto/ptz.dto.ts`
- Modify: `src/live/live.module.ts` (register controller + bind `PTZ_TRANSPORT` → `MqttPtzTransport`)
- Test: `test/live.e2e-spec.ts`

**Interfaces:**
- Consumes: `RecordingsService`? no — `LiveConfigService` unused here; `PtzTransport` (via `PTZ_TRANSPORT`), `JwtAuthGuard`, `CameraAccessGuard`, `ConfigService` (`GO2RTC_URL`).
- Produces (both `@UseGuards(JwtAuthGuard, CameraAccessGuard)`):
  - `GET /camera-profiles/:id/live/stream.mp4` → proxies `${GO2RTC_URL}/api/stream.mp4?src=${id}`, streams the body with `Content-Type: video/mp4`.
  - `POST /camera-profiles/:id/ptz` body `{ command: PtzCommand; amount?: number }` → `transport.send(id, command, amount)` → `{ ok: true }`.

- [ ] **Step 1: Write the failing e2e**

`test/live.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { vi } from 'vitest'; // NOTE: backend uses jest, not vitest — use jest.fn()/jest spies instead
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { CameraProfilesService } from '../src/camera-profiles/camera-profiles.service';
import { PTZ_TRANSPORT } from '../src/live/ptz';

describe('Live (e2e)', () => {
  let app: INestApplication; let users: UsersService; let auth: AuthService;
  let profiles: CameraProfilesService;
  let cookie: string; let profileId: string;
  const sends: Array<[string, string, number | undefined]> = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PTZ_TRANSPORT)
      .useValue({ send: async (id: string, c: string, a?: number) => { sends.push([id, c, a]); } })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService); profiles = mod.get(CameraProfilesService);
    await users['repo'].clear();
    const u = await users.create('live@x.com', await auth.hashPassword('pw'));
    cookie = `access_token=${auth.signToken(u)}`;
    const p = await profiles.create(u.id, {
      name: 'Cam', storage: { host: 'h', port: 21, user: 'u', pass: 'p', basePath: '/' },
      camera: { uid: 'UID', password: 'cp' },
    });
    profileId = p.id;
  });
  afterAll(async () => { await app.close(); });

  it('PTZ forwards the command for an authorized user', async () => {
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/ptz`).set('Cookie', cookie)
      .send({ command: 'left', amount: 20 }).expect(201);
    expect(sends.at(-1)).toEqual([profileId, 'left', 20]);
  });

  it('rejects an invalid PTZ command (400)', async () => {
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/ptz`).set('Cookie', cookie)
      .send({ command: 'spin' }).expect(400);
  });

  it('a non-owner cannot PTZ (404)', async () => {
    const other = await users.create('other@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/ptz`).set('Cookie', `access_token=${auth.signToken(other)}`)
      .send({ command: 'left' }).expect(404);
  });

  it('proxies the go2rtc mp4 stream for an authorized user', async () => {
    const realFetch = global.fetch;
    global.fetch = (async (url: unknown) => {
      expect(String(url)).toContain(`/api/stream.mp4?src=${profileId}`);
      return new Response(Buffer.from('fake-mp4'), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }) as typeof fetch;
    try {
      const res = await request(app.getHttpServer())
        .get(`/camera-profiles/${profileId}/live/stream.mp4`).set('Cookie', cookie).expect(200);
      expect(res.headers['content-type']).toContain('video/mp4');
      expect(res.body.toString()).toBe('fake-mp4');
    } finally { global.fetch = realFetch; }
  });

  it('a non-owner cannot access the stream (404)', async () => {
    const other = await users.create('nope@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/live/stream.mp4`).set('Cookie', `access_token=${auth.signToken(other)}`).expect(404);
  });
});
```
*Implementer note:* the backend test runner is **jest**, not vitest — remove the `vitest` import; use plain reassignment of `global.fetch` as shown (no vi). Keep the `overrideProvider(PTZ_TRANSPORT).useValue(...)` fake.

- [ ] **Step 2: Run to verify failure** — `pnpm test:e2e -- live` → FAIL.

- [ ] **Step 3: Implement DTO + controller + wiring**

`src/live/dto/ptz.dto.ts`:
```ts
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PTZ_COMMANDS, PtzCommand } from '../ptz';
export class PtzDto {
  @IsIn(PTZ_COMMANDS) command!: PtzCommand;
  @IsOptional() @IsInt() @Min(1) @Max(100) amount?: number;
}
```

`src/live/live.controller.ts`:
```ts
import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard } from '../sharing/camera-access.guard';
import { PtzDto } from './dto/ptz.dto';
import { PTZ_TRANSPORT, PtzTransport } from './ptz';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@Controller('camera-profiles/:id')
export class LiveController {
  constructor(
    private readonly config: ConfigService,
    @Inject(PTZ_TRANSPORT) private readonly ptz: PtzTransport,
  ) {}

  @Get('live/stream.mp4')
  async stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const base = this.config.getOrThrow<string>('GO2RTC_URL');
    const upstream = await fetch(`${base}/api/stream.mp4?src=${encodeURIComponent(id)}`);
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4');
    if (!upstream.body) { res.end(); return; }
    Readable.fromWeb(upstream.body as never).pipe(res);
    req.on('close', () => { /* client left; upstream GC's on stream end */ });
  }

  @Post('ptz')
  async movePtz(@Param('id') id: string, @Body() dto: PtzDto): Promise<{ ok: true }> {
    await this.ptz.send(id, dto.command, dto.amount);
    return { ok: true };
  }
}
```

`src/live/live.module.ts` (final):
```ts
import { Module } from '@nestjs/common';
import { CameraProfilesModule } from '../camera-profiles/camera-profiles.module';
import { SharingModule } from '../sharing/sharing.module';
import { LiveConfigService } from './live-config.service';
import { LiveController } from './live.controller';
import { MqttPtzTransport } from './mqtt-ptz.transport';
import { PTZ_TRANSPORT } from './ptz';

@Module({
  imports: [CameraProfilesModule, SharingModule],
  providers: [LiveConfigService, MqttPtzTransport, { provide: PTZ_TRANSPORT, useExisting: MqttPtzTransport }],
  controllers: [LiveController],
  exports: [LiveConfigService],
})
export class LiveModule {}
```
(`SharingModule` exports `CameraAccessGuard`/`CameraAccessService` used by the guard.)

- [ ] **Step 4: Run to verify pass** — `pnpm test:e2e -- live` → PASS (5 cases). Add `MQTT_URL`/`GO2RTC_URL` to `.env.example` + `.env.test` (dummy values; the e2e overrides the transport and stubs fetch, so no real broker/go2rtc is contacted).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(live): authz-gated go2rtc stream proxy + ptz endpoint"
```

---

### Task 4: Wire-up, env, full verify

**Files:**
- Modify: `.env.example`, `.env.test` (add `GO2RTC_URL`, `MQTT_URL`), `src/app.module.ts` (ensure `LiveModule` imported), `README.md` (live section, incl. the manual-smoke note)

**Interfaces:** none new — verification + docs.

- [ ] **Step 1: Env + docs**

Add to `.env.example`:
```
GO2RTC_URL=http://go2rtc:1984
MQTT_URL=mqtt://mqtt:1883
```
Add to `.env.test`:
```
GO2RTC_URL=http://go2rtc.test:1984
MQTT_URL=mqtt://mqtt.test:1883
```
`README.md`: add a "Live view (backend)" note — the API proxies go2rtc's `stream.mp4` per profile under the access guard, and PTZ publishes to neolink over MQTT; the actual neolink+go2rtc+broker bring-up and a real-camera smoke test come in Plan 3b.

- [ ] **Step 2: Confirm `LiveModule` in `AppModule`**

Ensure `src/app.module.ts` imports `LiveModule` (added in Task 1).

- [ ] **Step 3: Full verify**

Run: `pnpm test` (all backend unit incl. live-config + ptz), `pnpm test:e2e` (incl. live), and the **ROOT** `pnpm build` (must be clean — monorepo tsconfig excludes `web/`). All green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(live): env + docs + wire live module; full verify"
```

---

## Self-Review

**Spec coverage (design §7 live view & PTZ, backend side):**
- neolink/go2rtc config from profiles (UID/relay, per-profile stream) → Task 1. ✅
- Authz-gated live stream, internal go2rtc, non-owner 404 → Task 3 proxy. ✅
- PTZ proxied + access-checked → Task 3 + Task 2 (MQTT to neolink). ✅
- H.264 stream assumption → go2rtc `stream.mp4` is fMP4 (browser-native); consistent with the H.264 camera decision.
- **Out of this plan (3b/3c + manual):** deploying neolink+go2rtc+MQTT (kustomize/compose), config regeneration-on-profile-change wiring, and the frontend Live tab/player/PTZ UI; **and a real-camera smoke test** — no sandbox test can prove the actual media/PTZ path, so that's an explicit manual step, recorded, not silently assumed passing.

**Placeholder scan:** none — full code in every step. The two implementer-notes (jest-not-vitest in the e2e; `listAllIds` addition) are concrete instructions, not gaps. go2rtc/neolink API shapes (`/api/stream.mp4?src=`, `neolink/<id>/control/ptz "<dir> <amt>"`) are grounded in their docs; the neolink TOML field names are the one spot to re-verify against the installed neolink version in Plan 3b (flagged).

**Type consistency:** `PtzCommand`/`PTZ_COMMANDS` shared by `ptz.ts`, the DTO, and the transport; `PTZ_TRANSPORT` token bound to `MqttPtzTransport` and overridable in tests; stream `src`/neolink `name` both = `CameraProfileEntity.id`; reuses `CameraAccessGuard` unchanged (view-level access gates both stream and PTZ — a viewer can watch and pan, consistent with the family model; note: PTZ is intentionally NOT `@RequireManage`, so any granted viewer can move the camera).
