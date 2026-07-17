import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { getDb } from '@hm/db';
import { connectMq, getMqHealth, type ResilientMqHandle } from '@hm/shared/mq';
import { loadConfig } from './config';

let redis: Redis | null = null;
function getRedis(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/**
 * Timeout curto do probe AMQP. O `/health` é chamado por orquestradores
 * (Docker/Swarm) com deadline apertado — um broker que aceita o TCP mas não
 * completa o handshake não pode PENDURAR o handler. `connect()` do amqplib não
 * tem timeout próprio, então corremos contra este relógio.
 */
const MQ_PROBE_TIMEOUT_MS = 2_000;

/** Probe dedicado, aberto no máximo uma vez (fallback quando o processo ainda
 *  não tem nenhuma conexão AMQP gerenciada própria). */
let mqProbe: ResilientMqHandle | null = null;
/** Deduplica probes concorrentes durante o bootstrap. */
let mqProbePromise: Promise<ResilientMqHandle> | null = null;

/** Conecta ao broker com teto de tempo; fecha o socket órfão se resolver tarde. */
function connectMqWithTimeout(ms: number): Promise<ResilientMqHandle> {
  const probe = connectMq(undefined, {
    // Probe leve: reconecta em background sem afogar o broker durante uma queda.
    reconnect: { initialDelayMs: 1_000, maxDelayMs: 30_000 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('mq health probe timeout')), ms);
    timer.unref?.();
  });
  return Promise.race([probe, timeout])
    .catch((err: unknown) => {
      // Se a conexão resolver DEPOIS do timeout, fecha para não vazar socket.
      void probe.then((h) => h.close()).catch(() => undefined);
      throw err;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

/**
 * Estado do RabbitMQ para o `/health`.
 *
 * Reusa PRIMEIRO as conexões AMQP já gerenciadas pelo processo (o relay
 * consumer e o publisher outbound abrem `connectMq`, que se registra no
 * `getMqHealth()` agregado) — checagem gratuita, sem abrir socket novo, e que
 * reflete a mesma conexão que carrega as mensagens de verdade. Só quando o
 * processo ainda não tem NENHUMA conexão gerenciada é que abrimos um probe
 * dedicado e leve (com timeout curto, sem publicar nada).
 */
async function checkMq(): Promise<'connected' | 'down'> {
  const health = getMqHealth();
  if (health.connections.length > 0) {
    return health.healthy ? 'connected' : 'down';
  }
  // Sem conexão gerenciada própria → abre (uma vez) um probe dedicado.
  if (!mqProbe) {
    try {
      mqProbePromise ??= connectMqWithTimeout(MQ_PROBE_TIMEOUT_MS);
      mqProbe = await mqProbePromise;
    } catch {
      return 'down';
    } finally {
      mqProbePromise = null;
    }
  }
  return mqProbe.isConnected() ? 'connected' : 'down';
}

/** Encerra os clientes de saúde (testes / shutdown). */
export async function closeHealth(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
  if (mqProbe) {
    try {
      await mqProbe.close();
    } catch {
      // já caiu — nada a fazer
    }
    mqProbe = null;
  }
  mqProbePromise = null;
}

/** GET /health — verifica dependências de verdade (não só 200). */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  let db = 'down';
  let cache = 'down';
  let mq = 'down';
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
  try {
    mq = await checkMq();
  } catch {
    // broker indisponível
  }
  const healthy = db === 'connected' && cache === 'connected' && mq === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db,
    redis: cache,
    rabbitmq: mq,
  });
}
