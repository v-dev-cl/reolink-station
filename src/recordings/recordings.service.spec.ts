import { Writable } from 'node:stream';
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
      // atmoz/sftp stamps mtime as "now" on upload regardless of the path used,
      // so old.mp4 needs its mtime explicitly backdated for prune() to have a
      // genuinely old file to find. ssh2-sftp-client doesn't wrap SFTP SETSTAT,
      // so reach the underlying ssh2 sftp handle directly (test-seed only).
      const raw = (c as unknown as { sftp: { utimes: (p: string, a: Date, m: Date, cb: (err: unknown) => void) => void } }).sftp;
      const oldDate = new Date('2000-01-01T00:00:00Z');
      await new Promise<void>((resolve, reject) => {
        raw.utimes('/reolink/2000/01/01/old.mp4', oldDate, oldDate, (err) => (err ? reject(err) : resolve()));
      });
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

  it('streams a byte range to a writable without buffering the file', async () => {
    const chunks: Buffer[] = [];
    const dst = new Writable({ write(c, _enc, cb) { chunks.push(c as Buffer); cb(); } });
    await svc.streamTo(P, '2026/07/15/clip.mp4', dst, { start: 0, end: 4 });
    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  it('streams the whole file via a full span', async () => {
    const chunks: Buffer[] = [];
    const dst = new Writable({ write(c, _enc, cb) { chunks.push(c as Buffer); cb(); } });
    await svc.streamTo(P, '2026/07/15/clip.mp4', dst, { start: 0, end: 14 });
    expect(Buffer.concat(chunks).toString()).toBe('hello-mp4-bytes');
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

  it('prunes files older than N days, invalidating a previously-cached listing', async () => {
    // populate the listCache for '2000/01/01' before pruning, so this genuinely
    // exercises invalidation rather than an incidental cache-miss re-list.
    const before = await svc.listDir(P, '2000/01/01');
    expect(before.map((e) => e.name)).toEqual(['old.mp4']);
    const { deleted } = await svc.prune(P, 30);
    expect(deleted).toBeGreaterThanOrEqual(1); // the 2000/01/01/old.mp4
    const gone = await svc.listDir(P, '2000/01/01').catch(() => []);
    expect(gone.find((e) => e.name === 'old.mp4')).toBeUndefined();
  });
});
