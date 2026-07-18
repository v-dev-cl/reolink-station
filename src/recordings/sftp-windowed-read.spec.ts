import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import SftpClient from 'ssh2-sftp-client';
import { RawSftp, windowedRead } from './sftp-windowed-read';

const CFG = { host: '127.0.0.1', port: 2222, username: 'testuser', password: 'testpass' };
const FILE = '/reolink/windowed-read-fixture.bin';
// > WINDOW * CHUNK_SIZE so the test exercises window refill and ordered reassembly
const DATA = randomBytes(1_000_000);

describe('windowedRead (integration, needs sftp-test container)', () => {
  let client: SftpClient;
  let raw: RawSftp;

  beforeAll(async () => {
    client = new SftpClient();
    await client.connect(CFG);
    await client.mkdir('/reolink', true).catch(() => undefined);
    await client.put(Buffer.from(DATA), FILE);
    raw = (client as unknown as { sftp: RawSftp }).sftp;
  });
  afterAll(async () => {
    await client.delete(FILE).catch(() => undefined);
    await client.end();
  });

  function collector(): { dst: Writable; chunks: Buffer[] } {
    const chunks: Buffer[] = [];
    const dst = new Writable({ write(c, _e, cb) { chunks.push(c as Buffer); cb(); } });
    return { dst, chunks };
  }

  it('reassembles a large file byte-identical despite concurrent reads', async () => {
    const { dst, chunks } = collector();
    await windowedRead(raw, FILE, 0, DATA.length - 1, dst);
    expect(Buffer.concat(chunks).equals(DATA)).toBe(true);
  });

  it('honors an inclusive byte range that is not chunk-aligned', async () => {
    const { dst, chunks } = collector();
    await windowedRead(raw, FILE, 33_000, 99_998, dst);
    expect(Buffer.concat(chunks).equals(DATA.subarray(33_000, 99_999))).toBe(true);
  });

  it('settles promptly when the destination closes mid-stream and the session stays usable', async () => {
    const chunks: Buffer[] = [];
    const dst = new Writable({
      write(c, _e, cb) {
        chunks.push(c as Buffer);
        cb();
        if (chunks.length === 1) this.destroy(); // simulate the client going away
      },
    });
    await expect(windowedRead(raw, FILE, 0, DATA.length - 1, dst)).resolves.toBeUndefined();
    // the file handle was closed and the SFTP session is NOT wedged:
    const list = await client.list('/reolink');
    expect(list.some((e) => e.name === 'windowed-read-fixture.bin')).toBe(true);
  });

  it('handles an empty span (start > end) by just ending the destination', async () => {
    const { dst, chunks } = collector();
    await windowedRead(raw, FILE, 5, 4, dst);
    expect(chunks.length).toBe(0);
  });
});
