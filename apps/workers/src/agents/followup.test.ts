/**
 * Testes do job de auto follow-up (F2-S21).
 *
 * `@hm/db` é mockado: `getDb().execute` serve a descoberta cross-tenant de
 * workspaces; dentro de `withWorkspace`, o `tx.execute` serve o SELECT de
 * elegibilidade. O Redis é um fake com semântica `SET NX` real (rastreia chaves
 * já gravadas) — é o coração da prova de idempotência e do lock de scheduler. O
 * `enqueueOutbox` mockado entrega as mensagens gravadas (F70-S25) à outbox fake do
 * teste, que as expõe como `{ queue, envelope }`.
 *
 * Cobre: seleção+publish de elegíveis, idempotência (2º tick na mesma janela não
 * duplica), guarda de lock (instância sem lock não toca no DB), e tolerância a
 * falha por-workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxMessage } from '@hm/shared/mq';
import type { SubscriptionGate } from '../lib/subscription-gate';
import type { FollowupDeps } from './followup';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

/** Fila de respostas para o `execute` cross-tenant (descoberta de workspaces). */
let discoverQueue: unknown[][] = [];
const discoverExecute = vi.fn(async () => discoverQueue.shift() ?? []);

/** Resposta do SELECT de elegibilidade por workspace (mesma para todos no teste). */
let eligibleRows: unknown[] = [];
const txExecute = vi.fn(async () => eligibleRows);

let withWorkspaceImpl: (id: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

/** Outbox fake corrente: recebe o que o SUT grava com `enqueueOutbox` (F70-S25). */
let currentOutbox: { record(msgs: readonly OutboxMessage[]): void } | null = null;

vi.mock('@hm/db', () => ({
  getDb: () => ({ execute: discoverExecute }),
  withWorkspace: (id: string, fn: (tx: unknown) => Promise<unknown>) => withWorkspaceImpl(id, fn),
  enqueueOutbox: async (_tx: unknown, msgs: OutboxMessage | readonly OutboxMessage[]) => {
    const list = Array.isArray(msgs) ? (msgs as readonly OutboxMessage[]) : [msgs as OutboxMessage];
    currentOutbox?.record(list);
    return list.length;
  },
}));

const followup = await import('./followup');
const { runFollowupTick, startFollowupScheduler, followupMarkKey, FOLLOWUP_LOCK_KEY } = followup;

// ─── Fakes ─────────────────────────────────────────────────────────────────────

/** Redis fake com `SET NX` real + `eval` (unlock) no-op observável. */
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
      // Honra o check-and-del do titular (KEYS[1]=args[0], ARGV[1]=args[1]).
      const [key, token] = args;
      // Só KEYS[1], sem token: é o DEL da marca desfeita (F70-S25).
      if (key !== undefined && args.length === 1) return store.delete(key) ? 1 : 0;
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

const WS = '00000000-0000-0000-0000-0000000000aa';
// F70-S25: o gatilho vai pela outbox, cujo envelope exige workspace uuid.
const WS_BAD = '00000000-0000-0000-0000-0000000000a1';
const WS_OK = '00000000-0000-0000-0000-0000000000a2';
const CONV = '00000000-0000-0000-0000-00000000c001';
const CONTACT = '00000000-0000-0000-0000-00000000d001';
const CHANNEL = '00000000-0000-0000-0000-00000000e001';
const BUCKET = 1_700_000_000;

const eligibleRow = {
  conversation_id: CONV,
  contact_id: CONTACT,
  channel_id: CHANNEL,
  provider: 'meta_whatsapp',
  last_message_epoch: BUCKET,
};

/** Tipos concretos dos fakes (preservados p/ asserções) + view tipada p/ o SUT. */
type Redis = ReturnType<typeof makeRedis>;
type Outbox = ReturnType<typeof makeOutbox>;
type Logger = ReturnType<typeof makeLogger>;

interface Deps {
  redis: Redis;
  outbox: Outbox;
  logger: Logger;
  subscription: SubscriptionGate;
}

/** Coerção dos fakes para `FollowupDeps` (as portas só usam um subconjunto). */
function asDeps(d: Deps): FollowupDeps {
  return d as unknown as FollowupDeps;
}

/** Portão de assinatura fake (F71-S06): ativo por padrão; o caso inativo tem teste próprio. */
function gate(active = true): SubscriptionGate & { check: ReturnType<typeof vi.fn> } {
  return {
    check: vi.fn(async () =>
      active
        ? { active: true as const, status: 'active' }
        : { active: false as const, status: 'expired' },
    ),
  };
}

function deps(): Deps {
  return { redis: makeRedis(), outbox: makeOutbox(), logger: makeLogger(), subscription: gate() };
}

beforeEach(() => {
  discoverQueue = [];
  eligibleRows = [];
  discoverExecute.mockClear();
  txExecute.mockClear();
  withWorkspaceImpl = (_id, fn) => fn({ execute: txExecute });
});

describe('runFollowupTick', () => {
  it('F71-S06: assinatura inativa → nenhum follow-up e a marca da janela fica livre', async () => {
    eligibleRows = [eligibleRow];
    const d = { ...deps(), subscription: gate(false) };

    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(true);
    expect(res.skippedSubscriptionInactive).toBe(1);
    expect(res.enqueued).toBe(0);
    expect(d.subscription.check).toHaveBeenCalledWith(WS);
    expect(txExecute).not.toHaveBeenCalled();
    expect(d.outbox.published).toHaveLength(0);
    expect(d.redis.store.has(followupMarkKey(CONV, BUCKET))).toBe(false);
  });

  it('seleciona elegíveis, marca idempotência e publica flow.run.requested', async () => {
    eligibleRows = [eligibleRow];
    const d = deps();

    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(1);
    expect(res.enqueued).toBe(1);
    expect(res.skippedDuplicate).toBe(0);

    // Publicou no hm.q.flows com o shape EXATO do worker de F2-S11.
    expect(d.outbox.published).toHaveLength(1);
    const pub = d.outbox.published[0];
    expect(pub?.queue).toBe('hm.q.flows');
    expect(pub?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(pub?.envelope['payload']).toEqual({
      conversationId: CONV,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
      // F70-S26: id estável do gatilho = conversa + janela.
      triggerId: `followup:${CONV}:${BUCKET}`,
    });

    // Gravou a marca de idempotência da janela.
    expect(d.redis.store.has(followupMarkKey(CONV, BUCKET))).toBe(true);
    // Liberou o lock (eval de unlock chamado, chave de lock removida).
    expect(d.redis.eval).toHaveBeenCalled();
    expect(d.redis.store.has(FOLLOWUP_LOCK_KEY)).toBe(false);
  });

  it('é idempotente: 2º tick na mesma janela não republica', async () => {
    eligibleRows = [eligibleRow];
    const redis = makeRedis();
    const outbox = makeOutbox();
    const logger = makeLogger();
    const d = { redis, outbox, logger, subscription: gate() };

    const first = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(first.enqueued).toBe(1);

    // Mesma janela (mesmo last_message_epoch) → a marca já existe → pula.
    const second = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(second.ran).toBe(true);
    expect(second.enqueued).toBe(0);
    expect(second.skippedDuplicate).toBe(1);

    // Só um envelope publicado no total (não duplicou).
    expect(outbox.published).toHaveLength(1);
  });

  it('nova janela (novo last_message_epoch) permite novo follow-up', async () => {
    const redis = makeRedis();
    const outbox = makeOutbox();
    const d = { redis, outbox, logger: makeLogger(), subscription: gate() };

    eligibleRows = [eligibleRow];
    await runFollowupTick(asDeps(d), { workspaceId: WS });

    // Contato mandou nova mensagem → last_message_at mudou → novo bucket.
    eligibleRows = [{ ...eligibleRow, last_message_epoch: BUCKET + 5000 }];
    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(1);
    expect(outbox.published).toHaveLength(2);
  });

  it('pula o tick sem tocar no DB quando o lock está detido por outra instância', async () => {
    const redis = makeRedis();
    // Outra instância já detém o lock.
    redis.store.set(FOLLOWUP_LOCK_KEY, 'other-instance-token');
    const outbox = makeOutbox();
    const d = { redis, outbox, logger: makeLogger(), subscription: gate() };

    eligibleRows = [eligibleRow];
    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(false);
    expect(res.enqueued).toBe(0);
    expect(outbox.published).toHaveLength(0);
    expect(txExecute).not.toHaveBeenCalled();
    expect(discoverExecute).not.toHaveBeenCalled();
    // Não liberou o lock de outra instância (token não bate).
    expect(redis.store.get(FOLLOWUP_LOCK_KEY)).toBe('other-instance-token');
  });

  it('descobre workspaces cross-tenant quando workspaceId não é dado', async () => {
    discoverQueue = [[{ workspace_id: WS }]];
    eligibleRows = [];
    const d = deps();

    const res = await runFollowupTick(asDeps(d));

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(1);
    expect(discoverExecute).toHaveBeenCalledTimes(1);
  });

  it('descarta linha com provider inválido (defensivo)', async () => {
    eligibleRows = [{ ...eligibleRow, provider: 'telegram' }];
    const d = deps();

    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(0);
    expect(d.outbox.published).toHaveLength(0);
  });

  it('falha de um workspace não derruba os demais e libera o lock', async () => {
    discoverQueue = [[{ workspace_id: WS_BAD }, { workspace_id: WS_OK }]];
    const d = deps();
    eligibleRows = [eligibleRow];
    withWorkspaceImpl = (id, fn) => {
      if (id === WS_BAD) return Promise.reject(new Error('boom'));
      return fn({ execute: txExecute });
    };

    const res = await runFollowupTick(asDeps(d));

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(2);
    expect(res.enqueued).toBe(1); // só ws-ok
    expect(d.logger.error).toHaveBeenCalledWith(
      'followup: tick de workspace falhou',
      expect.objectContaining({ workspaceId: WS_BAD }),
    );
    // Lock liberado mesmo com falha parcial.
    expect(d.redis.store.has(FOLLOWUP_LOCK_KEY)).toBe(false);
  });

  it('F70-S25: transação que não commita desfaz a marca e o próximo tick tenta de novo', async () => {
    eligibleRows = [eligibleRow];
    const d = deps();
    // Todo o trabalho acontece (marca + gravação na outbox) e o COMMIT falha.
    withWorkspaceImpl = async (_id, fn) => {
      await fn({ execute: txExecute });
      throw new Error('commit falhou');
    };

    const failed = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(failed.enqueued).toBe(0);
    expect(d.redis.store.has(followupMarkKey(CONV, BUCKET))).toBe(false);

    // Banco de volta: a mesma janela é seguida (a marca não ficou órfã).
    withWorkspaceImpl = (_id, fn) => fn({ execute: txExecute });
    d.outbox.published.length = 0;
    const retried = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(retried.enqueued).toBe(1);
    expect(d.outbox.published).toHaveLength(1);
    expect(d.redis.store.has(followupMarkKey(CONV, BUCKET))).toBe(true);
  });
});

describe('startFollowupScheduler', () => {
  it('dispara um tick no intervalo e para limpo', async () => {
    eligibleRows = [eligibleRow];
    // Scheduler não passa workspaceId → percorre o caminho de descoberta
    // cross-tenant. Faz a descoberta devolver o workspace em todo tick.
    discoverExecute.mockImplementation(async () => [{ workspace_id: WS }]);
    const d = deps();

    // Sem disparo imediato (primeiro tick é agendado, não roda no boot).
    const handle = startFollowupScheduler(asDeps(d), { intervalMs: 5 });
    expect(d.outbox.published).toHaveLength(0);

    // Aguarda o primeiro tick real concluir (publica em hm.q.flows).
    await vi.waitFor(() => {
      expect(d.outbox.enqueue).toHaveBeenCalled();
    });

    // Após stop, nenhum novo tick dispara.
    await handle.stop();
    const after = d.outbox.enqueue.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(d.outbox.enqueue.mock.calls.length).toBe(after);
  });
});
