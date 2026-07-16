import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
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

  async openRead(profileId: string, relPath: string, range?: RangeSpec, size?: number): Promise<{ stream: Readable; size: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abs = resolveSafe(base, relPath);
    return this.pool.withConnection(cfg, async (c) => {
      const fileSize = size ?? (await c.stat(abs).catch(() => { throw new NotFoundException('file not found'); })).size;
      const opts = range ? { readStreamOptions: { start: range.start, end: range.end } } : undefined;
      const buf = (await c.get(abs, undefined, opts as never)) as Buffer;
      return { stream: Readable.from(buf), size: fileSize };
    });
  }

  async deleteFiles(profileId: string, relPaths: string[]): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const abses = relPaths.map((r) => resolveSafe(base, r));
    const result = await this.pool.withConnection(cfg, async (c) => {
      let deleted = 0;
      for (const abs of abses) {
        try { await c.delete(abs); deleted++; } catch (err) { this.logger.warn(`failed to delete ${abs}: ${err instanceof Error ? err.message : err}`); }
      }
      return { deleted };
    });
    this.listCache.invalidate(`${profileId}:`);
    return result;
  }

  async prune(profileId: string, olderThanDays: number): Promise<{ deleted: number }> {
    const { cfg, base } = await this.conn(profileId);
    const cutoff = daysAgoEpoch(olderThanDays);
    const result = await this.pool.withConnection(cfg, async (c) => {
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
    this.listCache.invalidate(`${profileId}:`);
    return result;
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
