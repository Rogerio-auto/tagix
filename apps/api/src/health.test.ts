/**
 * F56-S21 — o `/health` reflete a saúde do RabbitMQ (backbone de mensageria).
 *
 * O que estes testes travam (regressão QA-10 / AUDITORIA_TECNICA §3.10): o
 * `/health` retornava 200 "ok" mesmo com o broker morto, enquanto mensagens
 * sumiam. Agora o broker caído degrada para 503.
 *
 * Tudo é mockado — sem DB, sem Redis, sem broker real. As dimensões db/redis
 * são forçadas a "connected" para ISOLAR o eixo RabbitMQ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { MqHealth, ResilientMqHandle } from '@hm/shared/mq';

// --- Estado controlável dos mocks (mutável por teste) ---------------------
let mqHealthValue: MqHealth = { healthy: true, connections: [] };
let connectMqImpl: () => Promise<ResilientMqHandle> = () =>
  Promise.reject(new Error('connectMq não configurado no teste'));

const dbExecute = vi.fn<() => Promise<unknown>>(() => Promise.resolve(undefined));
const redisPing = vi.fn<() => Promise<string>>(() => Promise.resolve('PONG'));
/** F61-S11: o probe de storage é um `put` de verdade — aqui é o único mock que decide. */
const storagePut = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock('./config', () => ({
  loadConfig: () => ({
    nodeEnv: 'test',
    port: 3001,
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    corsOrigin: 'http://localhost:3000',
  }),
}));

vi.mock('@hm/db', () => ({
  getDb: () => ({ execute: dbExecute }),
}));

vi.mock('ioredis', () => ({
  default: class {
    ping = redisPing;
    quit = (): Promise<void> => Promise.resolve();
  },
}));

vi.mock('@hm/storage', () => ({
  createStorage: () => ({ put: storagePut }),
}));

vi.mock('@hm/shared/mq', () => ({
  getMqHealth: (): MqHealth => mqHealthValue,
  connectMq: (): Promise<ResilientMqHandle> => connectMqImpl(),
}));

const { healthHandler, closeHealth } = await import('./health');

// --- Helpers ---------------------------------------------------------------
interface Captured {
  status: number;
  body: Record<string, unknown>;
}

async function callHealth(): Promise<Captured> {
  const captured: Captured = { status: 0, body: {} };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  await healthHandler({} as Request, res);
  return captured;
}

function fakeHandle(connected: boolean): ResilientMqHandle {
  return {
    // `connection`/`channel` não são tocados pelo /health — stubs mínimos.
    connection: {} as ResilientMqHandle['connection'],
    channel: {} as ResilientMqHandle['channel'],
    isConnected: () => connected,
    state: () => ({
      connected,
      reconnecting: !connected,
      consecutiveFailures: 0,
      lastError: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
    }),
    close: () => Promise.resolve(),
  };
}

beforeEach(() => {
  mqHealthValue = { healthy: true, connections: [] };
  connectMqImpl = () => Promise.reject(new Error('connectMq não configurado no teste'));
  dbExecute.mockClear().mockResolvedValue(undefined);
  redisPing.mockClear().mockResolvedValue('PONG');
  storagePut.mockClear().mockResolvedValue(undefined);
});

afterEach(async () => {
  await closeHealth();
  vi.useRealTimers();
});

describe('GET /health — RabbitMQ', () => {
  it('broker up (conexão gerenciada saudável) → 200 ok, rabbitmq connected', async () => {
    mqHealthValue = { healthy: true, connections: [fakeHandle(true).state()] };
    const res = await callHealth();
    expect(res.status).toBe(200);
    expect(res.body['status']).toBe('ok');
    expect(res.body['rabbitmq']).toBe('connected');
    expect(res.body['db']).toBe('connected');
    expect(res.body['redis']).toBe('connected');
  });

  it('broker down (conexão gerenciada em reconexão) → 503 degraded, rabbitmq down', async () => {
    mqHealthValue = { healthy: false, connections: [fakeHandle(false).state()] };
    const res = await callHealth();
    expect(res.status).toBe(503);
    expect(res.body['status']).toBe('degraded');
    expect(res.body['rabbitmq']).toBe('down');
    // db e redis seguem ok — o 503 veio SÓ do broker.
    expect(res.body['db']).toBe('connected');
    expect(res.body['redis']).toBe('connected');
  });

  it('sem conexão gerenciada + probe conecta → 200 ok, rabbitmq connected', async () => {
    mqHealthValue = { healthy: true, connections: [] };
    connectMqImpl = () => Promise.resolve(fakeHandle(true));
    const res = await callHealth();
    expect(res.status).toBe(200);
    expect(res.body['rabbitmq']).toBe('connected');
  });

  it('sem conexão gerenciada + probe falha (broker morto) → 503 down', async () => {
    mqHealthValue = { healthy: true, connections: [] };
    connectMqImpl = () => Promise.reject(new Error('ECONNREFUSED'));
    const res = await callHealth();
    expect(res.status).toBe(503);
    expect(res.body['rabbitmq']).toBe('down');
  });

  it('probe que pendura estoura o timeout → 503 down (não trava o handler)', async () => {
    vi.useFakeTimers();
    mqHealthValue = { healthy: true, connections: [] };
    // connect que nunca resolve → só o timeout interno pode destravar.
    connectMqImpl = () => new Promise<ResilientMqHandle>(() => undefined);
    const pending = callHealth();
    await vi.advanceTimersByTimeAsync(2_500);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.body['rabbitmq']).toBe('down');
  });

  it('só o broker cai (db+redis ok) mas db também cai → 503 (composição correta)', async () => {
    dbExecute.mockRejectedValue(new Error('db down'));
    mqHealthValue = { healthy: false, connections: [fakeHandle(false).state()] };
    const res = await callHealth();
    expect(res.status).toBe(503);
    expect(res.body['db']).toBe('down');
    expect(res.body['rabbitmq']).toBe('down');
  });
});

/**
 * F61-S11 — o `/health` sabe dizer que perdeu o storage.
 *
 * Regressão do incidente de 2026-09-09: o token do R2 foi revogado e a API seguiu
 * respondendo 200 "ok" por dias. Nenhuma mídia subia, nenhuma signed URL abria, e
 * a primeira notícia veio de um print de cliente.
 */
describe('GET /health — storage', () => {
  // Broker saudável em todos: isola o eixo storage (mesmo padrão do bloco acima).
  beforeEach(() => {
    mqHealthValue = { healthy: true, connections: [fakeHandle(true).state()] };
  });

  it('storage escrevendo → ok, storage connected', async () => {
    const res = await callHealth();
    expect(res.body['storage']).toBe('connected');
    expect(res.body['status']).toBe('ok');
  });

  it('credencial morta (put rejeita) → degraded, storage down', async () => {
    storagePut.mockRejectedValue(new Error('AccessDenied'));
    const res = await callHealth();
    expect(res.body['storage']).toBe('down');
    expect(res.body['status']).toBe('degraded');
  });

  it('storage caído NÃO derruba o /health para 503', async () => {
    // 503 tira a API de rotação. Uma plataforma inteira fora do ar é pior que
    // mídia que não carrega — o alarme informa sem causar um segundo incidente.
    storagePut.mockRejectedValue(new Error('AccessDenied'));
    const res = await callHealth();
    expect(res.status).toBe(200);
  });

  it('assinar URL não vale como probe — só um write prova a credencial', async () => {
    // `getSignedUrl` é operação local: passa com credencial revogada. Se um dia
    // alguém trocar o probe por ele, este teste cai.
    await callHealth();
    expect(storagePut).toHaveBeenCalledTimes(1);
  });

  it('o resultado é cacheado — /health a cada 5s não vira 1 write a cada 5s', async () => {
    await callHealth();
    await callHealth();
    await callHealth();
    expect(storagePut).toHaveBeenCalledTimes(1);
  });
});
