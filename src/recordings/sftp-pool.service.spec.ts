import { SftpPoolService, SftpConnConfig } from './sftp-pool.service';

const cfg: SftpConnConfig = { host: '127.0.0.1', port: 2222, user: 'testuser', pass: 'testpass' };

describe('SftpPoolService (integration, needs sftp-test container)', () => {
  let pool: SftpPoolService;
  beforeAll(() => { pool = new SftpPoolService(); });
  afterAll(async () => { await pool.onModuleDestroy(); });

  it('runs an operation against a real SFTP box', async () => {
    const list = await pool.withConnection(cfg, (c) => c.list('/reolink'));
    expect(Array.isArray(list)).toBe(true);
  });

  it('never runs more than 4 operations concurrently (enforces max)', async () => {
    let inFlight = 0; let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        pool.withConnection(cfg, async (c) => {
          inFlight++; peak = Math.max(peak, inFlight);
          await c.exists('/reolink');
          await new Promise((r) => setTimeout(r, 50)); // hold the connection so concurrency builds
          inFlight--;
          return true;
        }),
      ),
    );
    expect(peak).toBeGreaterThan(1);   // genuinely concurrent
    expect(peak).toBeLessThanOrEqual(4); // but capped
  });

  it('keys pools by password hash so a wrong-password config cannot poison the real one', () => {
    const key = (c: SftpConnConfig) => (pool as unknown as { key(c: SftpConnConfig): string }).key(c);
    const bad: SftpConnConfig = { ...cfg, pass: 'wrong-password' };
    expect(key(bad)).not.toBe(key(cfg)); // same host/port/user, different password → distinct pool
    expect(key({ ...cfg })).toBe(key(cfg)); // identical credentials still share one pool
    expect(key(bad)).not.toContain('wrong-password'); // raw password never appears in the key
  });

  it('rejects with the operation error but still releases the connection', async () => {
    await expect(
      pool.withConnection(cfg, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // pool still usable afterwards:
    await expect(pool.withConnection(cfg, (c) => c.exists('/reolink'))).resolves.not.toBe(false);
  });
});
