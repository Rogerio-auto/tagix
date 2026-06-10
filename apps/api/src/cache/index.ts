/**
 * Cache Redis versionado (LIVECHAT.md §8). `cached()` lê/grava com TTL; a
 * invalidação é por bump de uma chave de versão incluída na key da query.
 */
import Redis from 'ioredis';
import { loadConfig } from '../config';

let redis: Redis | null = null;
function client(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

export async function closeCache(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/** Lê do cache; em miss, roda o loader e grava (TTL em segundos). Tolerante a Redis off. */
export async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  try {
    const hit = await client().get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    // Redis indisponível — segue direto para o loader
  }
  const value = await loader();
  try {
    await client().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // gravação best-effort
  }
  return value;
}

/** Incrementa (e cria) a versão — chamado em writes para invalidar listas. */
export async function bumpVersion(versionKey: string): Promise<void> {
  try {
    await client().incr(versionKey);
  } catch {
    // best-effort
  }
}

export async function getVersion(versionKey: string): Promise<number> {
  try {
    const v = await client().get(versionKey);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}
