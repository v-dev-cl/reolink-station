import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('Invites (e2e)', () => {
  let app: INestApplication;
  let users: UsersService;
  let auth: AuthService;
  let adminCookie: string;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await users['repo'].clear();
    const admin = await users.create('admin@example.com', await auth.hashPassword('pw'), 'admin');
    adminCookie = `access_token=${auth.signToken(admin)}`;
  });

  it('admin creates an invite, invitee redeems it and can log in', async () => {
    const inv = await request(app.getHttpServer())
      .post('/invites').set('Cookie', adminCookie)
      .send({ email: 'parent@example.com' }).expect(201);
    const token = inv.body.token;

    await request(app.getHttpServer())
      .post('/invites/redeem').send({ token, password: 'parent-pw-123' }).expect(201);

    await request(app.getHttpServer())
      .post('/auth/login').send({ email: 'parent@example.com', password: 'parent-pw-123' }).expect(201);
  });

  it('non-admin cannot create invites', async () => {
    const u = await users.create('plain@example.com', await auth.hashPassword('pw'), 'user');
    await request(app.getHttpServer())
      .post('/invites').set('Cookie', `access_token=${auth.signToken(u)}`)
      .send({ email: 'x@example.com' }).expect(403);
  });

  it('rejects an unknown or reused token', async () => {
    await request(app.getHttpServer())
      .post('/invites/redeem').send({ token: 'nope', password: 'whatever12' }).expect(400);
  });

  it('rejects redeeming an invite whose email already has an account (409)', async () => {
    await users.create('taken@example.com', await auth.hashPassword('pw'));
    const inv = await request(app.getHttpServer())
      .post('/invites').set('Cookie', adminCookie)
      .send({ email: 'taken@example.com' }).expect(201);
    await request(app.getHttpServer())
      .post('/invites/redeem')
      .send({ token: inv.body.token, password: 'password123' }).expect(409);
  });

  it('rejects reusing a token that was already redeemed (400)', async () => {
    const inv = await request(app.getHttpServer())
      .post('/invites').set('Cookie', adminCookie)
      .send({ email: 'once@example.com' }).expect(201);
    await request(app.getHttpServer())
      .post('/invites/redeem')
      .send({ token: inv.body.token, password: 'password123' }).expect(201);
    await request(app.getHttpServer())
      .post('/invites/redeem')
      .send({ token: inv.body.token, password: 'password123' }).expect(400);
  });
});
