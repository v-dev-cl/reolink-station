import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/database.config';
import { CryptoModule } from '../crypto/crypto.module';
import { CameraProfilesModule } from './camera-profiles.module';
import { CameraProfilesService } from './camera-profiles.service';

describe('CameraProfilesService', () => {
  let svc: CameraProfilesService;
  let mod: TestingModule;
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
  beforeEach(async () => { await svc['repo'].clear(); });

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
