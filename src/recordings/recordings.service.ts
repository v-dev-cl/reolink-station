import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Writable } from 'node:stream';
import { SftpConnConfig, SftpPoolService } from './sftp-pool.service';
import { CameraProfilesService } from '../camera-profiles/camera-profiles.service';
import { resolveSafe } from './path-safety';
import { RangeSpec, RecordingEntry } from './types';
import { TtlCache } from './recordings.cache';

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly listCache = new TtlCache<RecordingEntry[]>(10_000);

  constructor(
    private readonly pool: SftpPoolService,
    private readonly profiles: CameraProfilesService,
  ) {}

  private async conn(profileId: string): Promise<{ cfg: SftpConnConfig; base: string }> {
    const p = await this.profiles.findOneDecryptedForConnection(profileId);
    const s = p.storage;
    return { cfg: { host: s.host, port: s.port, user: s.user, pass: s.pass }, base: s.basePath };
  }

  async listDir(profileId: string, relDir: string): Promise<RecordingEntry[]> {
    const cacheKey = `${profileId}:${relDir}`;
    const cached = this.listCache.get(cacheKey);
    if (cached) return cached;
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relDir);
    const entries = await this.pool.withConnection<RecordingEntry[]>(cfg, async (c) => {
      const items = await c.list(abs);
      return items.map((i) => ({
        name: i.name,
        path: relJoin(relDir, i.name),
        type: i.type === 'd' ? 'dir' : 'file',
        size: i.size,
        mtime: i.modifyTime,
      }));
    });
    this.listCache.set(cacheKey, entries);
    return entries;
  }

  async stat(profileId: string, relPath: string): Promise<{ size: number; mtime: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relPath);
    return this.pool.withConnection(cfg, async (c) => {
      const st = await c.stat(abs).catch(() => { throw new NotFoundException('file not found'); });
      return { size: st.size, mtime: st.modifyTime };
    });
  }

  // Pipes the file (or byte range) from SFTP straight into dst chunk-by-chunk.
  // Never buffers the file in memory — time-to-first-byte stays flat regardless of clip size.
  // The pooled connection is released as soon as EITHER side terminates (source end,
  // client disconnect, or error) — release must never depend on the client's cooperation.
  async streamTo(profileId: string, relPath: string, dst: Writable, range?: RangeSpec): Promise<void> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relPath);
    await this.pool.withConnection(cfg, async (c) => {
      const rs = c.createReadStream(
        abs,
        range ? { start: range.start, end: range.end, autoClose: true } : { autoClose: true },
      );
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error | null): void => {
          if (settled) return;
          settled = true;
          rs.destroy();
          if (err) reject(err);
          else resolve();
        };
        rs.on('error', (e: Error) => done(e));
        rs.on('end', () => done());
        dst.on('error', (e: Error) => done(e));
        dst.on('close', () => done()); // fires after normal finish AND on client abort
        rs.pipe(dst);
      });
    });
  }

  async deleteFiles(profileId: string, relPaths: string[]): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abses = relPaths.map((r) => resolveSafe(base, r));
    try {
      return await this.pool.withConnection(cfg, async (c) => {
        let deleted = 0;
        for (const abs of abses) {
          try { await c.delete(abs); deleted++; } catch (err) { this.logger.warn(`failed to delete ${abs}: ${err instanceof Error ? err.message : err}`); }
        }
        return { deleted };
      });
    } finally {
      // in finally: a connection drop mid-way may still have deleted files — never serve them stale
      this.listCache.invalidate(`${profileId}:`);
    }
  }

  async prune(profileId: string, olderThanDays: number): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const cutoff = daysAgoEpoch(olderThanDays);
    try {
      return await this.pool.withConnection(cfg, async (c) => {
        let deleted = 0;
        const walk = async (dir: string): Promise<void> => {
          const items = await c.list(dir);
          for (const i of items) {
            const full = `${dir}/${i.name}`;
            if (i.type === 'd') await walk(full);
            else if (i.modifyTime < cutoff) { try { await c.delete(full); deleted++; } catch (err) { this.logger.warn(`prune: failed to delete ${full}: ${err instanceof Error ? err.message : err}`); } }
          }
        };
        await walk(resolveSafe(base, ''));
        return { deleted };
      });
    } finally {
      this.listCache.invalidate(`${profileId}:`);
    }
  }
}

function relJoin(dir: string, name: string): string {
  const d = (dir ?? '').replace(/^\/+|\/+$/g, '');
  return d ? `${d}/${name}` : name;
}
function daysAgoEpoch(days: number): number {
  // pure arithmetic; app code may use Date.now() (the no-Date.now rule is workflow-script-only).
  return Date.now() - days * 24 * 60 * 60 * 1000;
}
