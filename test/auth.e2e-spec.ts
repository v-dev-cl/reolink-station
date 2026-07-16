import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let users: UsersService;
  let auth: AuthService;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService);
    auth = mod.get(AuthService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await users['repo'].clear();
    await users.create('login@example.com', await auth.hashPassword('correct-horse'));
  });

  it('logs in with valid creds and sets an httpOnly cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'correct-horse' })
      .expect(201);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('access_token=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects a wrong password', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'wrong' })
      .expect(401);
  });

  it('rejects a nonexistent email with 401 (no enumeration signal)', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
      .expect(401);
  });

  it('blocks a protected route without a cookie (uses /auth/me)', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('allows a protected route with the cookie', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'correct-horse' });
    const cookie = login.headers['set-cookie'][0];
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.email).toBe('login@example.com');
  });
});
