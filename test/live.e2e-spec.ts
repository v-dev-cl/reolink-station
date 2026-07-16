import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
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
