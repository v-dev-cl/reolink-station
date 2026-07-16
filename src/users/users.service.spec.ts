import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/database.config';
import { UserEntity } from './user.entity';
import { UsersService } from './users.service';
import { UsersModule } from './users.module';

describe('UsersService', () => {
  let svc: UsersService;
  let moduleRef: TestingModule;

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
  beforeEach(async () => { await svc['repo'].clear(); });

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
