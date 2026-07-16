import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, Pool } from 'generic-pool';
import SftpClient from 'ssh2-sftp-client';

export interface SftpConnConfig { host: string; port: number; user: string; pass: string }

const MAX_PER_BOX = 4;
const IDLE_MS = 30_000;

@Injectable()
export class SftpPoolService implements OnModuleDestroy {
  private readonly pools = new Map<string, Pool<SftpClient>>();

  private key(c: SftpConnConfig): string { return `${c.host}:${c.port}:${c.user}`; }

  private poolFor(cfg: SftpConnConfig): Pool<SftpClient> {
    const k = this.key(cfg);
    let pool = this.pools.get(k);
    if (!pool) {
      pool = createPool<SftpClient>(
        {
          create: async () => {
            const client = new SftpClient();
            await client.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.pass });
            return client;
          },
          destroy: async (client) => { await client.end().catch(() => undefined); },
          validate: async (client) => {
            try { await client.exists('.'); return true; } catch { return false; }
          },
        },
        { max: MAX_PER_BOX, min: 0, idleTimeoutMillis: IDLE_MS, testOnBorrow: true, acquireTimeoutMillis: 20_000 },
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
  }
}
