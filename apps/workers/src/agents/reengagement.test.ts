/**
 * Testes do cron de reengajamento de IA (F30-S06).
 *
 * Cobre:
 * - Gatilho idle: conversa parada por mais de N min reengaja.
 * - Gatilho de horário comercial: quando o cron roda dentro do horário e há
 *   mensagem pendente do contato, a IA retoma.
 * - Idempotência: 2º tick na mesma janela (mesmo bucket) não duplica.
 * - Lock de scheduler: instância sem lock não toca no DB.
 * - Falha por workspace não derruba os demais.
 * - `isWithinBusinessHours`: validação unitária.
 *
 * `@hm/db` é mockado (getDb().execute, withWorkspace).
 * Redis é um fake com semântica `SET NX` real.
 * `enqueueOutbox` é mockado: o gatilho gravado na outbox (F70-S25) chega à outbox fake
 * do teste como `{ queue, envelope }`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxMessage } from '@hm/shared/mq';
import type { ReengagementDeps } from './reengagement';
import { isWithinBusinessHours } from './reengagement';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

/** Fila de respostas para o execute cross-tenant (descoberta de workspaces). */
let discoverQueue: unknown[][] = [];
const discoverExecute = vi.fn(async () => discoverQueue.shift() ?? []);

/** Linhas devolvidas pelo SELECT de elegibilidade (mesmas para todos os workspace no teste). */
let eligibleRows: unknown[] = [];
/** Linha devolvida pelo SELECT de settings do workspace. */
let workspaceSettings: unknown[] = [{ settings: {} }];

const txExecute = vi.fn(async () => eligibleRows);
const txSelect = vi.fn();
/** Linhas que o UPDATE condicional (trava de origem, F70-S08) devolve. */
let resumedRows: unknown[] = [{ id: 'conv' }];
const txUpdate = vi.fn(() => ({
  set: () => ({ where: () => ({ returning: async () => resumedRows }) }),
}));

let withWorkspaceImpl: (id: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

/** Outbox fake corrente: recebe o que o SUT grava com `enqueueOutbox` (F70-S25). */
let currentOutbox: { record(msgs: readonly OutboxMessage[]): void } | null = null;

vi.mock('@hm/db', () => ({
  getDb: () => ({ execute: discoverExecute }),
  withWorkspace: (id: string, fn: (tx: unknown) => Promise<unknown>) =>
    withWorkspaceImpl(id, fn),
  enqueueOutbox: async (_tx: unknown, msgs: OutboxMessage | readonly OutboxMessage[]) => {
    const list = Array.isArray(msgs) ? (msgs as readonly OutboxMessage[]) : [msgs as OutboxMessage];
    currentOutbox?.record(list);
    return list.length;
  },
  schema: {
    workspaces: { id: 'id', settings: 'settings' },
    conversations: {
      id: 'id',
      aiMode: 'ai_mode',
      aiPausedReason: 'ai_paused_reason',
      aiPausedAt: 'ai_paused_at',
      aiPausedBy: 'ai_paused_by',
      aiResumeAt: 'ai_resume_at',
      updatedAt: 'updated_at',
      origin: 'origin',
      aiEnabledAt: 'ai_enabled_at',
      aiAutoEnabledAt: 'ai_auto_enabled_at',
    },
  },
}));

// Lazy import depois dos mocks.
const reengagement = await import('./reengagement');
const {
  runReengagementTick,
  startReengagementScheduler,
  reengagementMarkKey,
  REENGAGEMENT_LOCK_KEY,
  idleMinutesFromEnv,
  reengagementTickMsFromEnv,
} = reengagement;

// ─── Fakes ────────────────────────────────────────────────────────────────────

/** Redis fake com semântica `SET NX` real e `eval` unlock verificável. */
function makeRedis() {
  const store = new Map<string, string>();
  const evalCalls: string[][] = [];
  return {
    store,
    evalCalls,
    set: vi.fn(
      async (key: string, value: string, _mode: string, _ttl: number, cond?: string) => {
        if (cond === 'NX' && store.has(key)) return null;
        store.set(key, value);
        return 'OK' as const;
      },
    ),
    eval: vi.fn(async (_script: string, _n: number, ...args: string[]) => {
      evalCalls.push(args);
      const [key, token] = args;
      if (key !== undefined && store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
}

/** Outbox fake: captura o que foi gravado (fila de destino + envelope). Vira a corrente. */
function makeOutbox() {
  const published: { queue: string; envelope: Record<string, unknown> }[] = [];
  const outbox = {
    published,
    enqueue: vi.fn(),
    record(msgs: readonly OutboxMessage[]): void {
      for (const m of msgs) {
        outbox.enqueue(m);
        published.push({
          queue: m.routingKey,
          envelope: m.envelope as unknown as Record<string, unknown>,
        });
      }
    },
  };
  currentOutbox = outbox;
  return outbox;
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
}

// ─── Constantes de teste ──────────────────────────────────────────────────────

const WS = '00000000-0000-0000-0000-0000000000bb';
// F70-S25: o gatilho vai pela outbox, cujo envelope exige workspace uuid.
const WS_BAD = '00000000-0000-0000-0000-0000000000b1';
const WS_OK = '00000000-0000-0000-0000-0000000000b2';
const CONV = '00000000-0000-0000-0000-00000000c002';
const CONTACT = '00000000-0000-0000-0000-00000000d002';
const CHANNEL_ID = '00000000-0000-0000-0000-00000000e002';
const BUCKET = 1_710_000_000;

function makeEligibleRow(overrides: Partial<{
  reason: string;
  bucket_epoch: number;
  provider: string;
}> = {}) {
  return {
    conversation_id: CONV,
    contact_id: CONTACT,
    channel_id: CHANNEL_ID,
    provider: 'meta_whatsapp',
    bucket_epoch: BUCKET,
    reason: 'idle',
    ...overrides,
  };
}

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

type Redis = ReturnType<typeof makeRedis>;
type Outbox = ReturnType<typeof makeOutbox>;
type Logger = ReturnType<typeof makeLogger>;
interface Deps { redis: Redis; outbox: Outbox; logger: Logger }

function asDeps(d: Deps): ReengagementDeps {
  return d as unknown as ReengagementDeps;
}
function deps(): Deps {
  return { redis: makeRedis(), outbox: makeOutbox(), logger: makeLogger() };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  discoverQueue = [];
  eligibleRows = [];
  workspaceSettings = [{ settings: {} }];
  discoverExecute.mockClear();
  txExecute.mockClear();
  txSelect.mockClear();
  txUpdate.mockClear();
  resumedRows = [{ id: 'conv' }];

  // Implementação padrão: retorna settings do workspace e depois os elegíveis.
  withWorkspaceImpl = (_id, fn) => {
    let wsSettingsCall = true;
    const tx = {
      execute: txExecute,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              if (wsSettingsCall) {
                wsSettingsCall = false;
                return Promise.resolve(workspaceSettings);
              }
              return Promise.resolve([]);
            },
          }),
        }),
      }),
      update: txUpdate,
    };
    return fn(tx);
  };
});

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('runReengagementTick — gatilho idle', () => {
  it('reengaja conversa ociosa: grava mark, update ai_mode, publica flow.run.requested', async () => {
    eligibleRows = [makeEligibleRow({ reason: 'idle' })];
    const d = deps();

    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(1);
    expect(res.enqueued).toBe(1);
    expect(res.skippedDuplicate).toBe(0);

    // Publicou no hm.q.flows com shape correto.
    expect(d.outbox.published).toHaveLength(1);
    const pub = d.outbox.published[0];
    expect(pub?.queue).toBe('hm.q.flows');
    expect(pub?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(pub?.envelope['payload']).toEqual({
      conversationId: CONV,
      contactId: CONTACT,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      // F70-S26: id estável do gatilho = conversa + janela.
      triggerId: `reengagement:${CONV}:${BUCKET}`,
    });

    // Gravou a marca de idempotência.
    expect(d.redis.store.has(reengagementMarkKey(CONV, BUCKET))).toBe(true);
    // Liberou o lock de scheduler.
    expect(d.redis.eval).toHaveBeenCalled();
    expect(d.redis.store.has(REENGAGEMENT_LOCK_KEY)).toBe(false);
  });

  it('é idempotente: 2º tick no mesmo bucket não republica', async () => {
    eligibleRows = [makeEligibleRow()];
    const redis = makeRedis();
    const outbox = makeOutbox();
    const logger = makeLogger();
    const d = { redis, outbox, logger };

    const first = await runReengagementTick(asDeps(d), { workspaceId: WS });
    expect(first.enqueued).toBe(1);

    const second = await runReengagementTick(asDeps(d), { workspaceId: WS });
    expect(second.ran).toBe(true);
    expect(second.enqueued).toBe(0);
    expect(second.skippedDuplicate).toBe(1);

    // Só um envelope publicado no total.
    expect(outbox.published).toHaveLength(1);
  });

  it('novo bucket permite novo reengajamento (ai_last_human_at resetou)', async () => {
    const redis = makeRedis();
    const outbox = makeOutbox();
    const d = { redis, outbox, logger: makeLogger() };

    eligibleRows = [makeEligibleRow({ bucket_epoch: BUCKET })];
    await runReengagementTick(asDeps(d), { workspaceId: WS });

    // Bucket diferente (a IA pausou de novo após nova atividade humana).
    eligibleRows = [makeEligibleRow({ bucket_epoch: BUCKET + 10000 })];
    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(1);
    expect(outbox.published).toHaveLength(2);
  });
});

describe('runReengagementTick — gatilho business_hours', () => {
  it('reengaja conversa pendente de contato quando reason=business_hours', async () => {
    eligibleRows = [makeEligibleRow({ reason: 'business_hours' })];
    const d = deps();

    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(1);
    expect(d.outbox.published).toHaveLength(1);
  });
});

describe('runReengagementTick — lock de scheduler', () => {
  it('pula tick sem tocar no DB quando o lock está detido por outra instância', async () => {
    const redis = makeRedis();
    redis.store.set(REENGAGEMENT_LOCK_KEY, 'other-instance-token');
    const outbox = makeOutbox();
    const d = { redis, outbox, logger: makeLogger() };

    eligibleRows = [makeEligibleRow()];
    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(false);
    expect(res.enqueued).toBe(0);
    expect(outbox.published).toHaveLength(0);
    expect(txExecute).not.toHaveBeenCalled();
    // Não removeu o lock da outra instância.
    expect(redis.store.get(REENGAGEMENT_LOCK_KEY)).toBe('other-instance-token');
  });
});

describe('runReengagementTick — descoberta cross-tenant', () => {
  it('descobre workspaces via getDb quando workspaceId não é fornecido', async () => {
    discoverQueue = [[{ workspace_id: WS }]];
    eligibleRows = [];
    const d = deps();

    const res = await runReengagementTick(asDeps(d));

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(1);
    expect(discoverExecute).toHaveBeenCalledTimes(1);
  });

  it('descarta linha com provider inválido (defensivo)', async () => {
    eligibleRows = [makeEligibleRow({ provider: 'telegram' })];
    const d = deps();

    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(0);
    expect(d.outbox.published).toHaveLength(0);
  });

  it('falha de workspace não derruba os demais e libera o lock', async () => {
    discoverQueue = [[{ workspace_id: WS_BAD }, { workspace_id: WS_OK }]];
    const d = deps();
    eligibleRows = [makeEligibleRow()];

    withWorkspaceImpl = (id, fn) => {
      if (id === WS_BAD) return Promise.reject(new Error('boom'));
      // ws-ok: implementação padrão simplificada.
      const tx = {
        execute: async () => eligibleRows,
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ settings: {} }]),
            }),
          }),
        }),
        update: txUpdate,
      };
      return fn(tx);
    };

    const res = await runReengagementTick(asDeps(d));

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(2);
    expect(res.enqueued).toBe(1); // só ws-ok
    expect(d.logger.error).toHaveBeenCalledWith(
      'reengajamento: tick de workspace falhou',
      expect.objectContaining({ workspaceId: WS_BAD }),
    );
    // Lock liberado mesmo com falha parcial.
    expect(d.redis.store.has(REENGAGEMENT_LOCK_KEY)).toBe(false);
  });
});

describe('startReengagementScheduler', () => {
  it('dispara tick no intervalo e para limpo', async () => {
    eligibleRows = [makeEligibleRow()];
    discoverExecute.mockImplementation(async () => [{ workspace_id: WS }]);
    const d = deps();

    const handle = startReengagementScheduler(asDeps(d), { intervalMs: 5 });
    // Sem disparo imediato.
    expect(d.outbox.published).toHaveLength(0);

    // Aguarda o primeiro tick.
    await vi.waitFor(() => {
      expect(d.outbox.enqueue).toHaveBeenCalled();
    });

    await handle.stop();
    const after = d.outbox.enqueue.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(d.outbox.enqueue.mock.calls.length).toBe(after);
  });
});

describe('isWithinBusinessHours', () => {
  function bh(days: { open: boolean; from?: string; to?: string }[]) {
    return { business_hours: { enabled: true, days } };
  }

  it('retorna true quando dentro do horário (UTC, segunda-feira 10h)', () => {
    // 2024-01-15 (segunda = UTC day 1) 10:00 UTC
    const now = new Date('2024-01-15T10:00:00Z');
    const settings = bh([
      { open: false }, // dom
      { open: true, from: '09:00', to: '18:00' }, // seg
      { open: false }, // ter
      { open: false }, // qua
      { open: false }, // qui
      { open: false }, // sex
      { open: false }, // sab
    ]);
    expect(isWithinBusinessHours(settings, now)).toBe(true);
  });

  it('retorna false quando fora do horário (antes das 09:00)', () => {
    const now = new Date('2024-01-15T08:00:00Z'); // segunda 08:00 UTC
    const settings = bh([
      { open: false },
      { open: true, from: '09:00', to: '18:00' },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
    ]);
    expect(isWithinBusinessHours(settings, now)).toBe(false);
  });

  it('retorna false quando dia está fechado', () => {
    // 2024-01-14 = domingo (0)
    const now = new Date('2024-01-14T10:00:00Z');
    const settings = bh([
      { open: false }, // dom fechado
      { open: true, from: '09:00', to: '18:00' },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
    ]);
    expect(isWithinBusinessHours(settings, now)).toBe(false);
  });

  it('retorna false quando enabled=false', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    const settings = { business_hours: { enabled: false, days: [{ open: true, from: '00:00', to: '23:59' }] } };
    expect(isWithinBusinessHours(settings, now)).toBe(false);
  });

  it('retorna false quando business_hours não configurado', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    expect(isWithinBusinessHours({}, now)).toBe(false);
  });

  it('avalia corretamente com timezone (America/Sao_Paulo, UTC-3)', () => {
    // 2024-01-15T12:00:00Z = 09:00 BRT (segunda)
    const now = new Date('2024-01-15T12:00:00Z');
    const settings = {
      business_hours: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        days: [
          { open: false }, // dom
          { open: true, from: '09:00', to: '18:00' }, // seg
          { open: false },
          { open: false },
          { open: false },
          { open: false },
          { open: false },
        ],
      },
    };
    // 09:00 BRT está dentro de 09:00–18:00.
    expect(isWithinBusinessHours(settings, now)).toBe(true);
  });
});

describe('env helpers', () => {
  it('idleMinutesFromEnv usa default 60 quando env ausente', () => {
    expect(idleMinutesFromEnv({})).toBe(60);
  });

  it('idleMinutesFromEnv lê REENGAGEMENT_IDLE_MINUTES', () => {
    expect(idleMinutesFromEnv({ REENGAGEMENT_IDLE_MINUTES: '30' })).toBe(30);
  });

  it('idleMinutesFromEnv usa default quando valor inválido', () => {
    expect(idleMinutesFromEnv({ REENGAGEMENT_IDLE_MINUTES: 'abc' })).toBe(60);
  });

  it('reengagementTickMsFromEnv usa default 60000 quando env ausente', () => {
    expect(reengagementTickMsFromEnv({})).toBe(60_000);
  });

  it('reengagementTickMsFromEnv lê REENGAGEMENT_TICK_MS', () => {
    expect(reengagementTickMsFromEnv({ REENGAGEMENT_TICK_MS: '30000' })).toBe(30_000);
  });
});

describe('runReengagementTick — trava de origem (F70-S08)', () => {
  it('UPDATE barrado (origem não elegível) → não publica, conta blockedByOrigin, loga warn', async () => {
    eligibleRows = [makeEligibleRow({ reason: 'idle' })];
    resumedRows = [];
    const d = deps();

    const res = await runReengagementTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(true);
    expect(res.enqueued).toBe(0);
    expect(res.blockedByOrigin).toBe(1);
    expect(d.outbox.published).toHaveLength(0);
    expect(d.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('trava de origem'),
      expect.objectContaining({ conversationId: CONV, workspaceId: WS }),
    );
    // A marca fica gravada: o próximo tick na mesma janela não repete o log.
    expect(d.redis.store.has(reengagementMarkKey(CONV, BUCKET))).toBe(true);
  });
});
