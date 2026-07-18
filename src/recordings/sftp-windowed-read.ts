import { Writable } from 'node:stream';

// Minimal surface of ssh2's raw SFTPWrapper that we need.
export interface RawSftp {
  open(path: string, flags: string, cb: (err: Error | null | undefined, handle: Buffer) => void): void;
  read(
    handle: Buffer,
    buf: Buffer,
    off: number,
    len: number,
    position: number,
    cb: (err: Error | null | undefined, bytesRead: number) => void,
  ): void;
  close(handle: Buffer, cb: (err?: Error | null) => void): void;
}

const CHUNK_SIZE = 32 * 1024; // safe SFTP read size across servers
const WINDOW = 24; // concurrent in-flight reads; window bytes = WINDOW * CHUNK_SIZE (~768 KB) — must outrun the camera's 6144 kbps bitrate on ~200 ms RTT links

// Reads [start, end] (inclusive) of remotePath and writes it to dst IN ORDER.
//
// ssh2's createReadStream requests one chunk per round-trip, which collapses to
// tens of KB/s on high-latency links (e.g. Chile → Falkenstein ≈ 200 ms RTT).
// This reader keeps WINDOW chunk-reads in flight concurrently — same idea as
// ssh2's fastGet, but range-aware and streaming to a Writable with backpressure.
//
// Settles as soon as either side terminates: source EOF/error, dst error, or
// dst close (client abort) — never depends on the client's cooperation.
export function windowedRead(
  sftp: RawSftp,
  remotePath: string,
  start: number,
  end: number,
  dst: Writable,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let handle: Buffer | undefined;
    let nextOffset = start; // next chunk offset to request
    let emitOffset = start; // next offset owed to dst
    let inflight = 0;
    let settled = false;
    let awaitingDrain = false;
    const completed = new Map<number, Buffer>(); // finished chunks waiting their turn

    const finish = (err?: Error | null): void => {
      if (settled) return;
      settled = true;
      completed.clear();
      dst.removeListener('close', onDstClose);
      dst.removeListener('error', onDstError);
      dst.removeListener('drain', onDrain);
      if (handle) sftp.close(handle, () => undefined);
      if (err) reject(err);
      else resolve();
    };

    const onDstClose = (): void => finish(); // normal finish or client abort — either way we are done
    const onDstError = (e: Error): void => finish(e);

    const emitReady = (): void => {
      if (settled || awaitingDrain) return;
      while (completed.has(emitOffset)) {
        const buf = completed.get(emitOffset)!;
        completed.delete(emitOffset);
        emitOffset += buf.length;
        const ok = dst.write(buf);
        if (emitOffset > end) {
          dst.end(); // 'close' on dst resolves us
          return;
        }
        if (!ok) {
          awaitingDrain = true;
          dst.once('drain', onDrain);
          return;
        }
      }
      pump();
    };

    function onDrain(): void {
      awaitingDrain = false;
      emitReady();
    }

    // Reads exactly [offset, offset+len) handling short reads via continuation.
    const readChunk = (offset: number, buf: Buffer, filled: number): void => {
      if (settled) return;
      sftp.read(handle!, buf, filled, buf.length - filled, offset + filled, (err, bytesRead) => {
        if (settled) return;
        if (err) return finish(err);
        if (bytesRead <= 0) return finish(new Error(`unexpected EOF at offset ${offset + filled} of ${remotePath}`));
        if (filled + bytesRead < buf.length) return readChunk(offset, buf, filled + bytesRead);
        inflight--;
        completed.set(offset, buf);
        emitReady();
      });
    };

    const pump = (): void => {
      while (!settled && !awaitingDrain && inflight < WINDOW && nextOffset <= end) {
        const len = Math.min(CHUNK_SIZE, end - nextOffset + 1);
        const buf = Buffer.allocUnsafe(len);
        inflight++;
        readChunk(nextOffset, buf, 0);
        nextOffset += len;
      }
    };

    dst.on('close', onDstClose);
    dst.on('error', onDstError);

    if (start > end) {
      dst.end();
      return;
    }
    sftp.open(remotePath, 'r', (err, h) => {
      if (err) return finish(err);
      if (settled) return sftp.close(h, () => undefined);
      handle = h;
      pump();
    });
  });
}
