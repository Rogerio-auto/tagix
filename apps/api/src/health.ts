import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { getDb } from '@hm/db';
import { loadConfig } from './config';

let redis: Redis | null = null;
function getRedis(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/** Encerra o cliente Redis (testes / shutdown). */
export async function closeHealth(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/** GET /health — verifica dependências de verdade (não só 200). */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  let db = 'down';
  let cache = 'down';
  try {
    await getDb().execute(sql`select 1`);
    db = 'connected';
  } catch {
    // db indisponível
  }
  try {
    if ((await getRedis().ping()) === 'PONG') cache = 'connected';
  } catch {
    // redis indisponível
  }
  const healthy = db === 'connected' && cache === 'connected';
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', db, redis: cache });
}
