import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { CameraShareEntity } from '../src/sharing/camera-share.entity';
import { CameraProfileEntity } from '../src/camera-profiles/camera-profile.entity';

const profileBody = {
  name: 'Cam', storage: { host: 'h', port: 21, user: 'u', pass: 'p', basePath: '/' },
  camera: { uid: 'UID', password: 'cp' },
};

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication; let users: UsersService; let auth: AuthService;
  let shareRepo: Repository<CameraShareEntity>; let profileRepo: Repository<CameraProfileEntity>;
  let aCookie: string; let bCookie: string; let bId: string;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService);
    shareRepo = mod.get(getRepositoryToken(CameraShareEntity));
    profileRepo = mod.get(getRepositoryToken(CameraProfileEntity));
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await shareRepo.clear();       // camera_shares
    await profileRepo.clear();     // camera_profiles
    await users['repo'].clear();   // users

    const a = await users.create('a@x.com', await auth.hashPassword('pw'));
    const b = await users.create('b@x.com', await auth.hashPassword('pw'));
    aCookie = `access_token=${auth.signToken(a)}`;
    bCookie = `access_token=${auth.signToken(b)}`;
    bId = b.id;
  });

  it('user B cannot read user A\'s profile (404, not leaked)', async () => {
    const created = await request(app.getHttpServer())
      .post('/camera-profiles').set('Cookie', aCookie).send(profileBody).expect(201);
    await request(app.getHttpServer())
      .get(`/camera-profiles/${created.body.id}`).set('Cookie', bCookie).expect(404);
  });

  it('a shared user CAN read it (view), but cannot delete (manage-only)', async () => {
    const created = await request(app.getHttpServer())
      .post('/camera-profiles').set('Cookie', aCookie).send(profileBody).expect(201);
    await request(app.getHttpServer())
      .post(`/camera-profiles/${created.body.id}/shares`).set('Cookie', aCookie)
      .send({ email: 'b@x.com', permission: 'view' }).expect(201);
    await request(app.getHttpServer())
      .get(`/camera-profiles/${created.body.id}`).set('Cookie', bCookie).expect(200);
    await request(app.getHttpServer())
      .delete(`/camera-profiles/${created.body.id}`).set('Cookie', bCookie).expect(403);
  });

  it('list only returns your own + shared profiles', async () => {
    await request(app.getHttpServer()).post('/camera-profiles').set('Cookie', aCookie).send(profileBody);
    const bList = await request(app.getHttpServer()).get('/camera-profiles').set('Cookie', bCookie).expect(200);
    expect(bList.body).toHaveLength(0);
  });
});
