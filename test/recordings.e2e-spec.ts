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
    // Content-Type is video/mp4 (correct for real playback), so superagent buffers
    // the response into res.body as a Buffer rather than parsing res.text.
    expect(res.body.toString()).toBe('01234');
  });

  it('serves the full file (200) without a Range header, marked browser-cacheable', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).expect(200);
    expect(res.body.toString()).toBe('0123456789');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('HEAD returns the headers without transferring the body', async () => {
    const res = await request(app.getHttpServer())
      .head(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).expect(200);
    expect(res.headers['content-length']).toBe('10');
    expect(res.body?.length ?? 0).toBe(0);
  });

  it('a non-owner cannot list (404)', async () => {
    const other = await users.create('other@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/list?dir=`).set('Cookie', `access_token=${auth.signToken(other)}`).expect(404);
  });

  it('serves a suffix range (last N bytes)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).set('Range', 'bytes=-5').expect(206);
    expect(res.headers['content-range']).toBe('bytes 5-9/10');
    expect(res.body.toString()).toBe('56789');
  });
  it('serves an open-ended range (bytes=0-)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).set('Range', 'bytes=0-').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-9/10');
    expect(res.body.toString()).toBe('0123456789');
  });
  it('returns 416 for an unsatisfiable range', async () => {
    const res = await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', cookie).set('Range', 'bytes=100-200').expect(416);
    expect(res.headers['content-range']).toBe('bytes */10');
  });
  it('returns 400 when path is missing', async () => {
    await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file`).set('Cookie', cookie).expect(400);
  });
  it('a non-owner cannot stream a file (404)', async () => {
    const stranger = await users.create('stranger@x.com', await auth.hashPassword('pw'));
    await request(app.getHttpServer())
      .get(`/camera-profiles/${profileId}/recordings/file?path=2026/07/15/clip.mp4`)
      .set('Cookie', `access_token=${auth.signToken(stranger)}`).expect(404);
  });

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
    await pool.withConnection(STORAGE, async (c) => {
      await c.mkdir('/reolink/2000/01/01', true);
      await c.put(Buffer.from('old'), '/reolink/2000/01/01/old.mp4');
      // atmoz/sftp stamps mtime as "now" on upload regardless of the path used, so
      // old.mp4 needs its mtime explicitly backdated for prune() to have a genuinely
      // old file to find (same fixture-seeding gotcha as recordings.service.spec.ts's
      // "prunes files older than N days" case). ssh2-sftp-client doesn't wrap SFTP
      // SETSTAT, so reach the underlying ssh2 sftp handle directly (test-seed only).
      const raw = (c as unknown as { sftp: { utimes: (p: string, a: Date, m: Date, cb: (err: unknown) => void) => void } }).sftp;
      const oldDate = new Date('2000-01-01T00:00:00Z');
      await new Promise<void>((resolve, reject) => {
        raw.utimes('/reolink/2000/01/01/old.mp4', oldDate, oldDate, (err) => (err ? reject(err) : resolve()));
      });
    });
    const res = await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/prune`).set('Cookie', cookie)
      .send({ olderThanDays: 30 }).expect(201);
    expect(res.body.deleted).toBeGreaterThanOrEqual(1);
  });

  it('rejects an empty delete paths array (400)', async () => {
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/delete`).set('Cookie', cookie)
      .send({ paths: [] }).expect(400);
  });

  it('rejects a traversal path in delete (403)', async () => {
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/delete`).set('Cookie', cookie)
      .send({ paths: ['../../etc/passwd'] }).expect(403);
  });

  it('rejects prune olderThanDays < 1 (400)', async () => {
    await request(app.getHttpServer())
      .post(`/camera-profiles/${profileId}/recordings/prune`).set('Cookie', cookie)
      .send({ olderThanDays: 0 }).expect(400);
  });
});
