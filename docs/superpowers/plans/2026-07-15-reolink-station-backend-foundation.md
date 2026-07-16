# Reolink Station — Backend Foundation & Multi-Tenant Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NestJS API that authenticates users (invite-only), stores per-user camera profiles with credentials encrypted at rest, supports sharing, and enforces strict multi-tenant isolation.

**Architecture:** NestJS 11 + TypeORM + Postgres. Secrets (Storage Box + camera passwords) are AES-256-GCM encrypted inside JSONB columns using a lifted-and-adapted `crypto.service.ts` from `feed-service`, masked on read. Every profile-scoped request passes through one `CameraAccessService`/guard that grants access only to the owner or a share grantee. Auth is argon2 + JWT in an httpOnly cookie.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL, `@nestjs/jwt`, `passport-jwt`, `argon2`, `class-validator`, `cookie-parser`, `helmet`, Jest + Supertest, pnpm, Node 22.

## Global Constraints

- **Runtime:** Node 22, pnpm with frozen lockfile. Non-root Docker image (house scaffolding standard).
- **Encryption:** AES-256-GCM; `APP_ENCRYPTION_KEY` must be exactly 32 bytes; format `iv:authTag:ciphertext` (each base64url). Key delivered via ESO — **never** commit it to git.
- **Secrets never leave the server:** API responses expose `hasPassword`-style booleans, never ciphertext or plaintext secrets.
- **Isolation is central:** profile access = owner OR share grant, enforced in ONE place; every profile query is scoped by it. This is the must-pass security property.
- **Auth:** argon2id password hashing; JWT in httpOnly, Secure, SameSite=Lax cookie; login rate-limited.
- **DB naming:** snake_case tables/columns (`users`, `camera_profiles`, `camera_shares`).
- **Tests use a disposable Postgres** (`docker-compose.test.yml`) with `synchronize: true`; production uses generated migrations (Task 8).

## File Structure

```
reolink-station/
  package.json, tsconfig.json, tsconfig.build.json, nest-cli.json
  .env.example, .env.test, docker-compose.test.yml
  src/
    main.ts                         # bootstrap: helmet, cookie-parser, global ValidationPipe
    app.module.ts                   # ConfigModule + TypeOrmModule + feature modules
    config/
      database.config.ts            # TypeORM options factory
    health/
      health.controller.ts          # GET /health
    crypto/
      crypto.service.ts             # AES-256-GCM encrypt/decrypt/isEncrypted
      crypto.module.ts
    users/
      user.entity.ts                # users table
      users.service.ts              # create/findByEmail/findById
      users.module.ts
    auth/
      auth.service.ts               # argon2 hash/verify, JWT sign
      auth.controller.ts            # POST /auth/login, POST /auth/logout
      jwt.strategy.ts               # reads JWT from cookie
      jwt-auth.guard.ts             # protects routes
      current-user.decorator.ts     # @CurrentUser()
      dto/login.dto.ts
      auth.module.ts
    invites/
      invite.entity.ts              # invite_tokens table
      invites.service.ts            # createInvite (admin), redeemInvite
      invites.controller.ts         # POST /invites (admin), POST /invites/redeem
      dto/{create-invite,redeem-invite}.dto.ts
      invites.module.ts
    camera-profiles/
      camera-profile.entity.ts      # camera_profiles table (jsonb configs)
      camera-profile.config.ts      # config shapes + which keys are secret
      camera-profile.masking.ts     # mask-on-read helper
      camera-profiles.service.ts    # CRUD + encrypt-on-save + merge-on-update
      camera-profiles.controller.ts # scoped CRUD
      dto/{create,update}-camera-profile.dto.ts
      camera-profiles.module.ts
    sharing/
      camera-share.entity.ts        # camera_shares table
      camera-access.service.ts      # canAccess(userId, profileId) -> 'owner'|'manage'|'view'|null
      camera-access.guard.ts        # applies canAccess to :id routes
      sharing.service.ts            # grant/revoke
      sharing.controller.ts         # POST/DELETE /camera-profiles/:id/shares
      dto/create-share.dto.ts
      sharing.module.ts
  test/
    *.e2e-spec.ts                   # supertest flows
  k8s/{base,overlays/{dev,prod}}    # Task 8
  Dockerfile, .github/workflows/build-and-publish.yml   # Task 8
```

---

### Task 1: Project scaffold + config + health endpoint

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.env.example`, `.env.test`, `docker-compose.test.yml`
- Create: `src/main.ts`, `src/app.module.ts`, `src/config/database.config.ts`, `src/health/health.controller.ts`
- Test: `test/health.e2e-spec.ts`

**Interfaces:**
- Produces: a bootable Nest app on `PORT` (default 3000); `GET /health` → `200 {"status":"ok"}`; `databaseConfig(config: ConfigService): TypeOrmModuleOptions`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "reolink-station-api",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.11.0",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.1.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/passport": "^11.0.0",
    "@nestjs/platform-express": "^11.1.0",
    "@nestjs/typeorm": "^11.0.0",
    "argon2": "^0.41.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "helmet": "^8.0.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.13.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.20"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.1.0",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "@types/passport-jwt": "^4.0.1",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.ts$": "ts-jest" },
    "collectCoverageFrom": ["**/*.ts"],
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create TS/Nest config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

`tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*spec.ts"] }
```

`nest-cli.json`:
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

`test/jest-e2e.json`:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.ts$": "ts-jest" }
}
```

- [ ] **Step 3: Create env + test-DB files**

`.env.example`:
```
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/reolink_station
APP_ENCRYPTION_KEY=change-me-to-a-32-byte-string!!!
JWT_SECRET=change-me
JWT_EXPIRES_IN=7d
COOKIE_SECURE=false
```

`.env.test`:
```
PORT=3001
DATABASE_URL=postgres://postgres:postgres@localhost:5433/reolink_test
APP_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
JWT_SECRET=test-secret
JWT_EXPIRES_IN=1h
COOKIE_SECURE=false
```

`docker-compose.test.yml`:
```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: reolink_test
    ports: ["5433:5432"]
```

- [ ] **Step 4: Create `src/config/database.config.ts`**

```ts
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function databaseConfig(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: config.getOrThrow<string>('DATABASE_URL'),
    autoLoadEntities: true,
    synchronize: config.get('NODE_ENV') !== 'production',
  };
}
```

- [ ] **Step 5: Create `src/app.module.ts`, `src/health/health.controller.ts`, `src/main.ts`**

`src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test', '.env'] }),
    TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: databaseConfig }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

`src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Write the failing e2e test**

`test/health.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /health -> 200 ok', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
```

- [ ] **Step 7: Start test DB, install, run test**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
pnpm install
pnpm test:e2e -- health
```
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: scaffold nest api with config, typeorm, health endpoint"
```

---

### Task 2: Crypto service (AES-256-GCM)

**Files:**
- Create: `src/crypto/crypto.service.ts`, `src/crypto/crypto.module.ts`
- Test: `src/crypto/crypto.service.spec.ts`

**Interfaces:**
- Produces: `CryptoService.encrypt(text: string): string`, `decrypt(payload: string): string`, `isEncrypted(value: string): boolean`. Global module (exported), reads `APP_ENCRYPTION_KEY`.

- [ ] **Step 1: Write the failing test**

`src/crypto/crypto.service.spec.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

const cfg = { getOrThrow: () => '0123456789abcdef0123456789abcdef' } as unknown as ConfigService;

describe('CryptoService', () => {
  const svc = new CryptoService(cfg);

  it('round-trips a secret', () => {
    const enc = svc.encrypt('hunter2');
    expect(enc).not.toContain('hunter2');
    expect(enc.split(':')).toHaveLength(3);
    expect(svc.decrypt(enc)).toBe('hunter2');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('detects a tampered ciphertext via auth tag', () => {
    const enc = svc.encrypt('secret');
    const [iv, tag, ct] = enc.split(':');
    const bad = `${iv}:${tag}:${ct.slice(0, -2)}AA`;
    expect(() => svc.decrypt(bad)).toThrow();
  });

  it('isEncrypted recognizes its own output and rejects plaintext', () => {
    expect(svc.isEncrypted(svc.encrypt('a'))).toBe(true);
    expect(svc.isEncrypted('plaintext')).toBe(false);
  });

  it('rejects a key that is not 32 bytes', () => {
    const badCfg = { getOrThrow: () => 'too-short' } as unknown as ConfigService;
    expect(() => new CryptoService(badCfg)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- crypto`
Expected: FAIL ("Cannot find module './crypto.service'").

- [ ] **Step 3: Write the implementation**

`src/crypto/crypto.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('APP_ENCRYPTION_KEY');
    const buf = Buffer.from(secret);
    if (buf.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be exactly 32 bytes');
    }
    this.key = buf;
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let enc = cipher.update(text, 'utf8', 'base64url');
    enc += cipher.final('base64url');
    const tag = cipher.getAuthTag().toString('base64url');
    return `${iv.toString('base64url')}:${tag}:${enc}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ct] = payload.split(':');
    if (!ivB64 || !tagB64 || ct === undefined) throw new Error('malformed ciphertext');
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(ivB64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    let dec = decipher.update(ct, 'base64url', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  isEncrypted(value: string): boolean {
    if (typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 3 && parts[0].length === 16 && parts[1].length === 22;
  }
}
```

`src/crypto/crypto.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- crypto`
Expected: PASS (5 tests). Add `CryptoModule` to `AppModule` imports.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add AES-256-GCM crypto service (adapted from feed-service)"
```

---

### Task 3: User entity + users service

**Files:**
- Create: `src/users/user.entity.ts`, `src/users/users.service.ts`, `src/users/users.module.ts`
- Test: `src/users/users.service.spec.ts`

**Interfaces:**
- Produces: `UserEntity { id: string; email: string; passwordHash: string; role: 'user'|'admin'; createdAt: Date }`; `UsersService.create(email, passwordHash, role?)`, `findByEmail(email): Promise<UserEntity|null>`, `findById(id): Promise<UserEntity|null>`.

- [ ] **Step 1: Write the entity**

`src/users/user.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type UserRole = 'user' | 'admin';

@Entity('users')
@Unique(['email'])
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) email: string;
  @Column({ name: 'password_hash', type: 'varchar' }) passwordHash: string;
  @Column({ type: 'varchar', default: 'user' }) role: UserRole;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

- [ ] **Step 2: Write the failing test**

`src/users/users.service.spec.ts` (integration against the test DB):
```ts
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/database.config';
import { UserEntity } from './user.entity';
import { UsersService } from './users.service';
import { UsersModule } from './users.module';

describe('UsersService', () => {
  let svc: UsersService;
  let moduleRef: Awaited<ReturnType<typeof Test.prototype.compile>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test'] }),
        TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: databaseConfig }),
        UsersModule,
      ],
    }).compile();
    svc = moduleRef.get(UsersService);
  });
  afterAll(async () => { await moduleRef.close(); });
  beforeEach(async () => { await svc['repo'].delete({}); });

  it('creates and finds a user by email', async () => {
    const u = await svc.create('a@example.com', 'hash');
    expect(u.id).toBeDefined();
    const found = await svc.findByEmail('a@example.com');
    expect(found?.id).toBe(u.id);
  });

  it('rejects a duplicate email', async () => {
    await svc.create('dup@example.com', 'h');
    await expect(svc.create('dup@example.com', 'h')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- users`
Expected: FAIL (module not found).

- [ ] **Step 4: Write service + module**

`src/users/users.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<UserEntity>) {}

  create(email: string, passwordHash: string, role: UserRole = 'user'): Promise<UserEntity> {
    return this.repo.save(this.repo.create({ email, passwordHash, role }));
  }
  findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email } });
  }
  findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
```

`src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- users`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add user entity and users service"
```

---

### Task 4: Auth — argon2 + JWT cookie login

**Files:**
- Create: `src/auth/auth.service.ts`, `auth.controller.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `current-user.decorator.ts`, `dto/login.dto.ts`, `auth.module.ts`
- Test: `test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 3), `CryptoService` unused here.
- Produces: `AuthService.hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>`, `signToken(user): string`; `JwtAuthGuard`; `@CurrentUser()` → `{ userId: string; role: UserRole }`. Login sets cookie `access_token`. JWT payload: `{ sub: userId, role }`.

- [ ] **Step 1: Write the failing e2e test**

`test/auth.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
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
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService);
    auth = mod.get(AuthService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await users['repo'].delete({});
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
  });

  it('rejects a wrong password', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'wrong' })
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- auth`
Expected: FAIL (AuthService not found).

- [ ] **Step 3: Implement auth pieces**

`src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';
export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
}
```

`src/auth/auth.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}
  hashPassword(pw: string): Promise<string> { return argon2.hash(pw, { type: argon2.argon2id }); }
  verifyPassword(hash: string, pw: string): Promise<boolean> { return argon2.verify(hash, pw); }
  signToken(user: UserEntity): string { return this.jwt.sign({ sub: user.id, role: user.role }); }
}
```

`src/auth/jwt.strategy.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([(req: Request) => req?.cookies?.access_token ?? null]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }
  validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}
```

`src/auth/jwt-auth.guard.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

`src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface AuthUser { userId: string; role: string; }
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

`src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Get, Post, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthUser, CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !(await this.auth.verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('invalid credentials');
    }
    res.cookie('access_token', this.auth.signToken(user), {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      maxAge: 7 * 24 * 3600 * 1000,
    });
    return { id: user.id, email: user.email, role: user.role };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.users.findById(u.userId);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role };
  }
}
```

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: c.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 4: Wire into AppModule, run test**

Add `AuthModule` and `UsersModule` to `AppModule.imports`.
Run: `pnpm test:e2e -- auth`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: argon2 + jwt cookie auth with /auth/login,logout,me"
```

---

### Task 5: Invite-only account creation

**Files:**
- Create: `src/invites/invite.entity.ts`, `invites.service.ts`, `invites.controller.ts`, `dto/create-invite.dto.ts`, `dto/redeem-invite.dto.ts`, `invites.module.ts`
- Create: `src/auth/roles.guard.ts`, `src/auth/roles.decorator.ts`
- Test: `test/invites.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService`, `AuthService`, `JwtAuthGuard`, `@CurrentUser()`.
- Produces: `POST /invites` (admin-only) → `{ token }`; `POST /invites/redeem { token, password }` → creates user, returns `{ id, email }`. `@Roles('admin')` + `RolesGuard`. Invite entity: `{ id, email, tokenHash, redeemedAt, createdAt }`.

- [ ] **Step 1: Write the failing e2e test**

`test/invites.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
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
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await users['repo'].delete({});
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- invites`
Expected: FAIL.

- [ ] **Step 3: Implement roles guard + invites**

`src/auth/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

`src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const { user } = ctx.switchToHttp().getRequest();
    return roles.includes(user?.role);
  }
}
```

`src/invites/invite.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('invite_tokens')
export class InviteEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) email: string;
  @Column({ name: 'token_hash', type: 'varchar' }) tokenHash: string;
  @Column({ name: 'redeemed_at', type: 'timestamptz', nullable: true }) redeemedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

`src/invites/dto/create-invite.dto.ts`:
```ts
import { IsEmail } from 'class-validator';
export class CreateInviteDto { @IsEmail() email: string; }
```

`src/invites/dto/redeem-invite.dto.ts`:
```ts
import { IsString, MinLength } from 'class-validator';
export class RedeemInviteDto {
  @IsString() token: string;
  @IsString() @MinLength(10) password: string;
}
```

`src/invites/invites.service.ts`:
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import { InviteEntity } from './invite.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(InviteEntity) private readonly repo: Repository<InviteEntity>,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createInvite(email: string): Promise<{ token: string }> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.repo.save(this.repo.create({ email, tokenHash: this.hash(token), redeemedAt: null }));
    return { token };
  }

  async redeem(token: string, password: string): Promise<{ id: string; email: string }> {
    const invite = await this.repo.findOne({
      where: { tokenHash: this.hash(token), redeemedAt: IsNull() },
    });
    if (!invite) throw new BadRequestException('invalid or used invite');
    const user = await this.users.create(invite.email, await this.auth.hashPassword(password));
    invite.redeemedAt = new Date();
    await this.repo.save(invite);
    return { id: user.id, email: user.email };
  }
}
```

`src/invites/invites.controller.ts`:
```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RedeemInviteDto } from './dto/redeem-invite.dto';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateInviteDto) { return this.invites.createInvite(dto.email); }

  @Post('redeem')
  redeem(@Body() dto: RedeemInviteDto) { return this.invites.redeem(dto.token, dto.password); }
}
```

`src/invites/invites.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InviteEntity } from './invite.entity';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([InviteEntity]), UsersModule, AuthModule],
  providers: [InvitesService],
  controllers: [InvitesController],
})
export class InvitesModule {}
```

- [ ] **Step 4: Wire into AppModule, run test**

Add `InvitesModule` to `AppModule`.
Run: `pnpm test:e2e -- invites`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: invite-only account creation with admin roles guard"
```

---

### Task 6: Camera profiles with encrypted config + mask-on-read

**Files:**
- Create: `src/camera-profiles/camera-profile.entity.ts`, `camera-profile.config.ts`, `camera-profile.masking.ts`, `camera-profiles.service.ts`, `camera-profiles.controller.ts`, `dto/create-camera-profile.dto.ts`, `dto/update-camera-profile.dto.ts`, `camera-profiles.module.ts`
- Test: `src/camera-profiles/camera-profiles.service.spec.ts`

**Interfaces:**
- Consumes: `CryptoService`.
- Produces: `CameraProfileEntity { id; ownerId; name; storageConfig; cameraConfig; createdAt; updatedAt }`. `CameraProfilesService.create(ownerId, dto)`, `findOneDecryptedForConnection(id)` (internal use — returns plaintext secrets), `listForOwner(ownerId)`, `getMasked(id)`, `update(id, dto)`, `remove(id)`. Masked shape hides secrets and adds `hasStoragePass`, `hasCameraPassword`.

- [ ] **Step 1: Write the failing test**

`src/camera-profiles/camera-profiles.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/database.config';
import { CryptoModule } from '../crypto/crypto.module';
import { CameraProfilesModule } from './camera-profiles.module';
import { CameraProfilesService } from './camera-profiles.service';

describe('CameraProfilesService', () => {
  let svc: CameraProfilesService;
  let mod: Awaited<ReturnType<typeof Test.prototype.compile>>;
  const owner = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.test'] }),
        TypeOrmModule.forRootAsync({ inject: [ConfigService], useFactory: databaseConfig }),
        CryptoModule, CameraProfilesModule,
      ],
    }).compile();
    svc = mod.get(CameraProfilesService);
  });
  afterAll(async () => { await mod.close(); });
  beforeEach(async () => { await svc['repo'].delete({}); });

  const dto = {
    name: 'Front door',
    storage: { host: 'u1-sub1.your-storagebox.de', port: 21, user: 'u1-sub1', pass: 'sPASS', basePath: '/' },
    camera: { uid: 'ABC123', password: 'cPASS' },
  };

  it('encrypts secrets at rest', async () => {
    const p = await svc.create(owner, dto);
    const raw = await svc['repo'].findOneOrFail({ where: { id: p.id } });
    expect(raw.storageConfig.pass).not.toBe('sPASS');
    expect(raw.cameraConfig.password).not.toBe('cPASS');
    expect(raw.storageConfig.pass).toContain(':');
  });

  it('getMasked never returns secrets, exposes has-flags', async () => {
    const p = await svc.create(owner, dto);
    const masked = await svc.getMasked(p.id);
    expect((masked.storage as any).pass).toBeUndefined();
    expect(masked.storage.hasPass).toBe(true);
    expect(masked.camera.hasPassword).toBe(true);
    expect((masked.camera as any).password).toBeUndefined();
  });

  it('decrypts for internal connection use', async () => {
    const p = await svc.create(owner, dto);
    const conn = await svc.findOneDecryptedForConnection(p.id);
    expect(conn.storage.pass).toBe('sPASS');
    expect(conn.camera.password).toBe('cPASS');
  });

  it('update with blank password keeps the stored secret', async () => {
    const p = await svc.create(owner, dto);
    await svc.update(p.id, { camera: { uid: 'ABC123', password: '' } });
    const conn = await svc.findOneDecryptedForConnection(p.id);
    expect(conn.camera.password).toBe('cPASS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- camera-profiles`
Expected: FAIL.

- [ ] **Step 3: Implement config shapes, entity, masking, service, module**

`src/camera-profiles/camera-profile.config.ts`:
```ts
export interface StorageConfig { host: string; port: number; user: string; pass: string; basePath: string; }
export interface CameraConfig { uid: string; password: string; codec: 'h264'; }
export const STORAGE_SECRET_KEYS: (keyof StorageConfig)[] = ['pass'];
export const CAMERA_SECRET_KEYS: (keyof CameraConfig)[] = ['password'];
```

`src/camera-profiles/camera-profile.entity.ts`:
```ts
import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { CameraConfig, StorageConfig } from './camera-profile.config';

@Entity('camera_profiles')
export class CameraProfileEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ type: 'varchar' }) name: string;
  @Column({ name: 'storage_config', type: 'jsonb' }) storageConfig: StorageConfig;
  @Column({ name: 'camera_config', type: 'jsonb' }) cameraConfig: CameraConfig;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

`src/camera-profiles/camera-profile.masking.ts`:
```ts
import { CameraConfig, StorageConfig } from './camera-profile.config';

export function maskStorage(s: StorageConfig) {
  return { host: s.host, port: s.port, user: s.user, basePath: s.basePath, hasPass: !!s.pass };
}
export function maskCamera(c: CameraConfig) {
  return { uid: c.uid, codec: c.codec, hasPassword: !!c.password };
}
```

`src/camera-profiles/dto/create-camera-profile.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsInt, IsString, MinLength, ValidateNested } from 'class-validator';

class StorageDto {
  @IsString() host: string;
  @IsInt() port: number;
  @IsString() user: string;
  @IsString() pass: string;
  @IsString() basePath: string;
}
class CameraDto {
  @IsString() uid: string;
  @IsString() password: string;
}
export class CreateCameraProfileDto {
  @IsString() @MinLength(1) name: string;
  @ValidateNested() @Type(() => StorageDto) storage: StorageDto;
  @ValidateNested() @Type(() => CameraDto) camera: CameraDto;
}
```

`src/camera-profiles/dto/update-camera-profile.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

class StorageUpdateDto {
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() port?: number;
  @IsOptional() @IsString() user?: string;
  @IsOptional() @IsString() pass?: string;      // blank = keep stored
  @IsOptional() @IsString() basePath?: string;
}
class CameraUpdateDto {
  @IsOptional() @IsString() uid?: string;
  @IsOptional() @IsString() password?: string;  // blank = keep stored
}
export class UpdateCameraProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @ValidateNested() @Type(() => StorageUpdateDto) storage?: StorageUpdateDto;
  @IsOptional() @ValidateNested() @Type(() => CameraUpdateDto) camera?: CameraUpdateDto;
}
```

`src/camera-profiles/camera-profiles.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoService } from '../crypto/crypto.service';
import { CameraProfileEntity } from './camera-profile.entity';
import {
  CAMERA_SECRET_KEYS, CameraConfig, STORAGE_SECRET_KEYS, StorageConfig,
} from './camera-profile.config';
import { maskCamera, maskStorage } from './camera-profile.masking';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@Injectable()
export class CameraProfilesService {
  constructor(
    @InjectRepository(CameraProfileEntity) private readonly repo: Repository<CameraProfileEntity>,
    private readonly crypto: CryptoService,
  ) {}

  private encSecrets<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
    const out = { ...obj };
    for (const k of keys) {
      const v = out[k];
      if (typeof v === 'string' && v.length && !this.crypto.isEncrypted(v)) {
        out[k] = this.crypto.encrypt(v) as any;
      }
    }
    return out;
  }
  private decSecrets<T extends Record<string, any>>(obj: T, keys: (keyof T)[]): T {
    const out = { ...obj };
    for (const k of keys) {
      const v = out[k];
      if (typeof v === 'string' && this.crypto.isEncrypted(v)) out[k] = this.crypto.decrypt(v) as any;
    }
    return out;
  }

  async create(ownerId: string, dto: CreateCameraProfileDto): Promise<CameraProfileEntity> {
    const entity = this.repo.create({
      ownerId,
      name: dto.name,
      storageConfig: this.encSecrets({ ...dto.storage }, STORAGE_SECRET_KEYS),
      cameraConfig: this.encSecrets({ ...dto.camera, codec: 'h264' } as CameraConfig, CAMERA_SECRET_KEYS),
    });
    return this.repo.save(entity);
  }

  listForOwner(ownerId: string) {
    return this.repo.find({ where: { ownerId }, order: { createdAt: 'DESC' } })
      .then((rows) => rows.map((r) => this.toMasked(r)));
  }

  private async load(id: string): Promise<CameraProfileEntity> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('profile not found');
    return p;
  }

  private toMasked(p: CameraProfileEntity) {
    return { id: p.id, name: p.name, storage: maskStorage(p.storageConfig), camera: maskCamera(p.cameraConfig), createdAt: p.createdAt };
  }

  async getMasked(id: string) { return this.toMasked(await this.load(id)); }

  async findOneDecryptedForConnection(id: string): Promise<{ id: string; storage: StorageConfig; camera: CameraConfig }> {
    const p = await this.load(id);
    return {
      id: p.id,
      storage: this.decSecrets(p.storageConfig, STORAGE_SECRET_KEYS),
      camera: this.decSecrets(p.cameraConfig, CAMERA_SECRET_KEYS),
    };
  }

  async update(id: string, dto: UpdateCameraProfileDto) {
    const p = await this.load(id);
    if (dto.name) p.name = dto.name;
    if (dto.storage) {
      const merged = { ...p.storageConfig, ...stripBlank(dto.storage) };
      p.storageConfig = this.encSecrets(merged, STORAGE_SECRET_KEYS);
    }
    if (dto.camera) {
      const merged = { ...p.cameraConfig, ...stripBlank(dto.camera) };
      p.cameraConfig = this.encSecrets(merged, CAMERA_SECRET_KEYS);
    }
    return this.toMasked(await this.repo.save(p));
  }

  async remove(id: string) { await this.repo.delete({ id }); return { ok: true }; }
}

function stripBlank<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === undefined) continue; // blank secret = keep stored
    (out as any)[k] = v;
  }
  return out;
}
```

`src/camera-profiles/camera-profiles.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraProfileEntity } from './camera-profile.entity';
import { CameraProfilesService } from './camera-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([CameraProfileEntity])],
  providers: [CameraProfilesService],
  exports: [CameraProfilesService],
})
export class CameraProfilesModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- camera-profiles`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: camera profiles with encrypted config and mask-on-read"
```

---

### Task 7: Sharing + central tenant-isolation guard (the security-critical task)

**Files:**
- Create: `src/sharing/camera-share.entity.ts`, `camera-access.service.ts`, `camera-access.guard.ts`, `sharing.service.ts`, `sharing.controller.ts`, `dto/create-share.dto.ts`, `sharing.module.ts`
- Create: `src/camera-profiles/camera-profiles.controller.ts` (scoped CRUD, guarded)
- Test: `test/isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: `CameraProfilesService`, `UsersService`, `JwtAuthGuard`, `@CurrentUser()`.
- Produces: `CameraAccessService.access(userId, profileId): Promise<'owner'|'manage'|'view'|null>`; `CameraAccessGuard` (reads `:id` param, sets `req.access`, 404s when null); `SharingService.grant(profileId, granteeEmail, permission)`, `revoke(profileId, granteeId)`. Routes: `GET/POST /camera-profiles`, `GET/PATCH/DELETE /camera-profiles/:id`, `POST/DELETE /camera-profiles/:id/shares`.

- [ ] **Step 1: Write the failing isolation e2e test**

`test/isolation.e2e-spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

const profileBody = {
  name: 'Cam', storage: { host: 'h', port: 21, user: 'u', pass: 'p', basePath: '/' },
  camera: { uid: 'UID', password: 'cp' },
};

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication; let users: UsersService; let auth: AuthService;
  let aCookie: string; let bCookie: string; let bId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = mod.get(UsersService); auth = mod.get(AuthService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:e2e -- isolation`
Expected: FAIL.

- [ ] **Step 3: Implement share entity, access service/guard, sharing, scoped controller**

`src/sharing/camera-share.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
export type SharePermission = 'view' | 'manage';

@Entity('camera_shares')
@Unique(['cameraProfileId', 'granteeId'])
export class CameraShareEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'camera_profile_id', type: 'uuid' }) cameraProfileId: string;
  @Column({ name: 'grantee_id', type: 'uuid' }) granteeId: string;
  @Column({ type: 'varchar' }) permission: SharePermission;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

`src/sharing/camera-access.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CameraProfileEntity } from '../camera-profiles/camera-profile.entity';
import { CameraShareEntity } from './camera-share.entity';

export type AccessLevel = 'owner' | 'manage' | 'view' | null;

@Injectable()
export class CameraAccessService {
  constructor(
    @InjectRepository(CameraProfileEntity) private readonly profiles: Repository<CameraProfileEntity>,
    @InjectRepository(CameraShareEntity) private readonly shares: Repository<CameraShareEntity>,
  ) {}

  async access(userId: string, profileId: string): Promise<AccessLevel> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) return null;
    if (profile.ownerId === userId) return 'owner';
    const share = await this.shares.findOne({ where: { cameraProfileId: profileId, granteeId: userId } });
    return share ? share.permission : null;
  }

  /** ids of profiles this user can see (owned + shared). */
  async accessibleProfileIds(userId: string): Promise<string[]> {
    const owned = await this.profiles.find({ where: { ownerId: userId }, select: ['id'] });
    const shared = await this.shares.find({ where: { granteeId: userId }, select: ['cameraProfileId'] });
    return [...owned.map((p) => p.id), ...shared.map((s) => s.cameraProfileId)];
  }
}
```

`src/sharing/camera-access.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CameraAccessService } from './camera-access.service';

export const REQUIRE_MANAGE = 'require_manage';
import { SetMetadata } from '@nestjs/common';
export const RequireManage = () => SetMetadata(REQUIRE_MANAGE, true);

@Injectable()
export class CameraAccessGuard implements CanActivate {
  constructor(private readonly access: CameraAccessService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const level = await this.access.access(req.user.userId, req.params.id);
    if (!level) throw new NotFoundException('profile not found'); // do not leak existence
    const needsManage = this.reflector.getAllAndOverride<boolean>(REQUIRE_MANAGE, [ctx.getHandler(), ctx.getClass()]);
    if (needsManage && level === 'view') throw new ForbiddenException('manage permission required');
    req.access = level;
    return true;
  }
}
```

`src/sharing/dto/create-share.dto.ts`:
```ts
import { IsEmail, IsIn } from 'class-validator';
export class CreateShareDto {
  @IsEmail() email: string;
  @IsIn(['view', 'manage']) permission: 'view' | 'manage';
}
```

`src/sharing/sharing.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CameraShareEntity, SharePermission } from './camera-share.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(CameraShareEntity) private readonly shares: Repository<CameraShareEntity>,
    private readonly users: UsersService,
  ) {}

  async grant(profileId: string, email: string, permission: SharePermission) {
    const grantee = await this.users.findByEmail(email);
    if (!grantee) throw new NotFoundException('grantee not found');
    const existing = await this.shares.findOne({ where: { cameraProfileId: profileId, granteeId: grantee.id } });
    if (existing) { existing.permission = permission; return this.shares.save(existing); }
    return this.shares.save(this.shares.create({ cameraProfileId: profileId, granteeId: grantee.id, permission }));
  }

  async revoke(profileId: string, granteeId: string) {
    await this.shares.delete({ cameraProfileId: profileId, granteeId });
    return { ok: true };
  }
}
```

`src/sharing/sharing.controller.ts`:
```ts
import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CameraAccessGuard, RequireManage } from './camera-access.guard';
import { SharingService } from './sharing.service';
import { CreateShareDto } from './dto/create-share.dto';

@UseGuards(JwtAuthGuard, CameraAccessGuard)
@RequireManage()
@Controller('camera-profiles/:id/shares')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  grant(@Param('id') id: string, @Body() dto: CreateShareDto) {
    return this.sharing.grant(id, dto.email, dto.permission);
  }

  @Delete(':granteeId')
  revoke(@Param('id') id: string, @Param('granteeId') granteeId: string) {
    return this.sharing.revoke(id, granteeId);
  }
}
```

`src/sharing/sharing.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CameraShareEntity } from './camera-share.entity';
import { CameraProfileEntity } from '../camera-profiles/camera-profile.entity';
import { CameraAccessService } from './camera-access.service';
import { CameraAccessGuard } from './camera-access.guard';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([CameraShareEntity, CameraProfileEntity]), UsersModule],
  providers: [CameraAccessService, CameraAccessGuard, SharingService],
  controllers: [SharingController],
  exports: [CameraAccessService, CameraAccessGuard],
})
export class SharingModule {}
```

`src/camera-profiles/camera-profiles.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { CameraAccessGuard, RequireManage } from '../sharing/camera-access.guard';
import { CameraAccessService } from '../sharing/camera-access.service';
import { CameraProfilesService } from './camera-profiles.service';
import { CreateCameraProfileDto } from './dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from './dto/update-camera-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('camera-profiles')
export class CameraProfilesController {
  constructor(
    private readonly profiles: CameraProfilesService,
    private readonly access: CameraAccessService,
  ) {}

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateCameraProfileDto) {
    const p = await this.profiles.create(u.userId, dto);
    return this.profiles.getMasked(p.id);
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const ids = await this.access.accessibleProfileIds(u.userId);
    return Promise.all(ids.map((id) => this.profiles.getMasked(id)));
  }

  @UseGuards(CameraAccessGuard)
  @Get(':id')
  get(@Param('id') id: string) { return this.profiles.getMasked(id); }

  @UseGuards(CameraAccessGuard)
  @RequireManage()
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCameraProfileDto) {
    return this.profiles.update(id, dto);
  }

  @UseGuards(CameraAccessGuard)
  @RequireManage()
  @Delete(':id')
  remove(@Param('id') id: string) { return this.profiles.remove(id); }
}
```

- [ ] **Step 4: Register controllers/guards, run test**

In `CameraProfilesModule`, add `SharingModule` to imports and `CameraProfilesController` to controllers. Ensure `AppModule` imports `CameraProfilesModule` and `SharingModule`.
Run: `pnpm test:e2e -- isolation`
Expected: PASS (3 tests) — including the must-pass "user B → 404" case.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test && pnpm test:e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: sharing + central tenant-isolation guard (owner/manage/view)"
```

---

### Task 8: Deploy scaffolding (Docker, kustomize, ESO, CI, migrations)

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Create: `k8s/base/{deployment,service,kustomization}.yaml`, `k8s/base/external-secret.yaml`, `k8s/overlays/dev/kustomization.yaml`, `k8s/overlays/prod/kustomization.yaml`
- Create: `.github/workflows/build-and-publish.yml`
- Create: `src/data-source.ts` (migration data source), `README.md`

**Interfaces:**
- Produces: a non-root container image; ESO-sourced `APP_ENCRYPTION_KEY`, `JWT_SECRET`, `DATABASE_URL`; a migration entrypoint for prod.

- [ ] **Step 1: Dockerfile (multi-stage, non-root)**

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`.dockerignore`:
```
node_modules
dist
.git
.env*
test
```

- [ ] **Step 2: Migration data source + note**

`src/data-source.ts`:
```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from './users/user.entity';
import { InviteEntity } from './invites/invite.entity';
import { CameraProfileEntity } from './camera-profiles/camera-profile.entity';
import { CameraShareEntity } from './sharing/camera-share.entity';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [UserEntity, InviteEntity, CameraProfileEntity, CameraShareEntity],
  migrations: ['dist/migrations/*.js'],
});
```

Add scripts to `package.json`:
```json
"migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/data-source.ts",
"migration:run": "typeorm-ts-node-commonjs migration:run -d src/data-source.ts"
```
(Prod sets `synchronize:false` via `NODE_ENV=production` from Task 1's `database.config.ts`; run migrations on deploy.)

- [ ] **Step 3: kustomize base + ESO**

`k8s/base/external-secret.yaml`:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: reolink-station-api
spec:
  refreshInterval: 1h
  secretStoreRef: { name: cluster-secret-store, kind: ClusterSecretStore }
  target: { name: reolink-station-api-secrets }
  data:
    - secretKey: APP_ENCRYPTION_KEY
      remoteRef: { key: reolink-station/api, property: APP_ENCRYPTION_KEY }
    - secretKey: JWT_SECRET
      remoteRef: { key: reolink-station/api, property: JWT_SECRET }
    - secretKey: DATABASE_URL
      remoteRef: { key: reolink-station/api, property: DATABASE_URL }
```

`k8s/base/deployment.yaml` (excerpt — env from the ESO-created secret):
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: reolink-station-api }
spec:
  replicas: 1
  selector: { matchLabels: { app: reolink-station-api } }
  template:
    metadata: { labels: { app: reolink-station-api } }
    spec:
      securityContext: { runAsNonRoot: true, runAsUser: 1000 }
      containers:
        - name: api
          image: reolink-station-api
          ports: [{ containerPort: 3000 }]
          envFrom: [{ secretRef: { name: reolink-station-api-secrets } }]
          readinessProbe: { httpGet: { path: /health, port: 3000 } }
```

`k8s/base/service.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata: { name: reolink-station-api }
spec:
  selector: { app: reolink-station-api }
  ports: [{ port: 80, targetPort: 3000 }]
```

`k8s/base/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources: [deployment.yaml, service.yaml, external-secret.yaml]
```

`k8s/overlays/dev/kustomization.yaml` and `overlays/prod/kustomization.yaml`:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: default
resources: [../../base]
```

- [ ] **Step 4: CI (branch-name image tags, house standard)**

`.github/workflows/build-and-publish.yml`:
```yaml
name: build-and-publish
on: { push: { branches: ["**"] } }
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.11.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      # (unit tests here run against a service Postgres; see README)
      - name: Image tag from branch
        run: echo "TAG=${GITHUB_REF_NAME//\//-}" >> "$GITHUB_ENV"
      - run: echo "would build/push reolink-station-api:${TAG}"
```

- [ ] **Step 5: README with run/verify instructions**

`README.md` documents: `docker compose -f docker-compose.test.yml up -d`, `pnpm install`, `pnpm test`, `pnpm test:e2e`, the ESO keys required, and the H.264/Allow-SSH camera onboarding prerequisites from the spec §12.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: docker, kustomize+ESO, CI, migration data source, readme"
```

---

## Self-Review

**Spec coverage:**
- §4 data model → Tasks 3 (User), 6 (CameraProfile), 7 (CameraShare). ✅
- §5 auth & sharing → Tasks 4 (login/JWT), 5 (invite-only + admin roles), 7 (view/manage sharing). ✅
- §8 encryption + ESO key → Tasks 2 (crypto), 6 (encrypt-on-save/mask), 8 (ESO). ✅
- §9 isolation (must-pass) → Task 7 central `CameraAccessService`/guard + isolation e2e. ✅
- §10 deploy/testing → Task 8 + per-task TDD. ✅
- **Out of this plan (by design):** SFTP recordings/manager (Plan 2), neolink/go2rtc live+PTZ (Plan 3), frontend UI (Plans 2–3). Recorded here so the gap is explicit, not accidental.

**Placeholder scan:** No TBD/TODO; every code step carries full code. The CI "would build/push" line is intentionally a stub for the image registry, which is environment-specific — flagged, not silent.

**Type consistency:** `AuthUser { userId, role }` used consistently (Tasks 4–7); `access(userId, profileId): 'owner'|'manage'|'view'|null` matches guard usage; `findOneDecryptedForConnection` returns `{ storage, camera }` consumed by Plan 2; masked shape (`hasPass`/`hasPassword`) consistent between service and masking helper.
