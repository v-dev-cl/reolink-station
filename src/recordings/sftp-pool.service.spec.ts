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

  it('serves many concurrent ops without exceeding the pool (no errors)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => pool.withConnection(cfg, (c) => c.exists('/reolink'))),
    );
    expect(results.every((r) => r !== false)).toBe(true);
  });

  it('rejects with the operation error but still releases the connection', async () => {
    await expect(
      pool.withConnection(cfg, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // pool still usable afterwards:
    await expect(pool.withConnection(cfg, (c) => c.exists('/reolink'))).resolves.not.toBe(false);
  });
});
