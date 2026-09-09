import type { Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { getDb } from '@hm/db';
import { connectMq, getMqHealth, type ResilientMqHandle } from '@hm/shared/mq';
import { createStorage } from '@hm/storage';
import { createLogger } from '@hm/logger';
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

// ─── Storage (F61-S11) ────────────────────────────────────────────────────────
//
// Por que existe: em 2026-09-09 o token do R2 foi revogado e a plataforma seguiu
// respondendo 200 por dias. Nenhuma mídia subia, nenhuma signed URL abria, e a
// primeira notícia veio de um print de cliente. Um serviço que não sabe dizer que
// perdeu o storage não está saudável — está calado.
//
// Só um `put` prova de verdade: assinar URL é operação local (nem toca a rede) e
// passa com credencial morta. Sempre a MESMA chave, sobrescrita, para o probe não
// virar lixo acumulado no bucket.
const STORAGE_PROBE_KEY = '_health/probe' as const;
const storageLogger = createLogger('info', { svc: '@hm/api' });
/** Teto de tempo do probe — o `/health` tem deadline de orquestrador. */
const STORAGE_PROBE_TIMEOUT_MS = 3_000;
/**
 * O resultado vale por um minuto. `/health` é chamado a cada poucos segundos pelo
 * Swarm; um round-trip a cada chamada seria desperdício de rede e de cota — e a
 * credencial não muda de estado entre dois segundos.
 */
const STORAGE_PROBE_TTL_MS = 60_000;

type StorageState = 'connected' | 'down';

let storageProbe: { at: number; state: StorageState } | null = null;
/** Só loga na TRANSIÇÃO — alarme que repete a cada minuto vira ruído e é ignorado. */
let storageLastLogged: StorageState | null = null;

async function checkStorage(): Promise<StorageState> {
  const agora = Date.now();
  if (storageProbe !== null && agora - storageProbe.at < STORAGE_PROBE_TTL_MS) {
    return storageProbe.state;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const state: StorageState = await Promise.race([
    createStorage()
      .put({
        key: STORAGE_PROBE_KEY,
        body: Buffer.from('ok'),
        contentType: 'text/plain',
      })
      .then((): StorageState => 'connected'),
    new Promise<StorageState>((resolve) => {
      timer = setTimeout(() => resolve('down'), STORAGE_PROBE_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]).catch((): StorageState => 'down');
  if (timer) clearTimeout(timer);

  storageProbe = { at: agora, state };
  if (state !== storageLastLogged) {
    storageLastLogged = state;
    if (state === 'down') {
      storageLogger.error(
        'storage inacessível: mídia não sobe e signed URL não abre — confira a credencial do bucket',
        { probeKey: STORAGE_PROBE_KEY },
      );
    } else {
      storageLogger.info('storage acessível novamente');
    }
  }
  return state;
}

/** Zera o cache do probe de storage (testes). */
export function resetStorageProbe(): void {
  storageProbe = null;
  storageLastLogged = null;
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
  resetStorageProbe();
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
  let storage: StorageState = 'down';
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
  try {
    storage = await checkStorage();
  } catch {
    // storage indisponível
  }
  // Storage NÃO derruba o `/health` de propósito: 503 tira a API de rotação, e
  // uma plataforma inteira fora do ar é pior que mídia que não carrega. O texto e
  // o alarme dizem a verdade; a decisão de reciclar o container não muda.
  const healthy = db === 'connected' && cache === 'connected' && mq === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? (storage === 'connected' ? 'ok' : 'degraded') : 'degraded',
    db,
    redis: cache,
    rabbitmq: mq,
    storage,
  });
}
