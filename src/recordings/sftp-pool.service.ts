import { createHash } from 'node:crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool } from 'generic-pool';
import SftpClient from 'ssh2-sftp-client';

export interface SftpConnConfig { host: string; port: number; user: string; pass: string }

const MAX_PER_BOX = 4;
const IDLE_MS = 30_000;

@Injectable()
export class SftpPoolService implements OnModuleDestroy {
  private readonly pools = new Map<string, Pool<SftpClient>>();
  private readonly cfgs = new Map<string, SftpConnConfig>();

  // The password hash is part of the key: host/user of a Hetzner box are guessable, so a
  // credential-less key would let one tenant's (wrong) config poison another tenant's pool.
  private key(c: SftpConnConfig): string {
    const passTag = createHash('sha256').update(c.pass).digest('hex').slice(0, 16);
    return `${c.host}:${c.port}:${c.user}:${passTag}`;
  }

  private poolFor(cfg: SftpConnConfig): Pool<SftpClient> {
    const k = this.key(cfg);
    let pool = this.pools.get(k);
    if (!pool) {
      this.cfgs.set(k, cfg);
      pool = createPool<SftpClient>(
        {
          create: async () => {
            const cur = this.cfgs.get(k)!;
            const client = new SftpClient();
            await client.connect({ host: cur.host, port: cur.port, username: cur.user, password: cur.pass });
            return client;
          },
          destroy: async (client) => { await client.end().catch(() => undefined); },
          validate: async (client) => {
            try { await client.exists('.'); return true; } catch { return false; }
          },
        },
        {
          max: MAX_PER_BOX,
          min: 0,
          idleTimeoutMillis: IDLE_MS,
          evictionRunIntervalMillis: IDLE_MS,
          testOnBorrow: true,
          acquireTimeoutMillis: 20_000,
        },
      );
      this.pools.set(k, pool);
    }
    return pool;
  }

  async withConnection<T>(cfg: SftpConnConfig, fn: (client: SftpClient) => Promise<T>): Promise<T> {
    const pool = this.poolFor(cfg);
    const client = await pool.acquire();
    try {
      return await fn(client);
    } finally {
      await pool.release(client);
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.drain();
      await pool.clear();
    }
    this.pools.clear();
    this.cfgs.clear();
  }
}
