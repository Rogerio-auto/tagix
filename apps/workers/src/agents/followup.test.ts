/**
 * Testes do job de auto follow-up (F2-S21).
 *
 * `@hm/db` é mockado: `getDb().execute` serve a descoberta cross-tenant de
 * workspaces; dentro de `withWorkspace`, o `tx.execute` serve o SELECT de
 * elegibilidade. O Redis é um fake com semântica `SET NX` real (rastreia chaves
 * já gravadas) — é o coração da prova de idempotência e do lock de scheduler. O
 * `channel` AMQP é um spy que captura os envelopes publicados em `hm.q.flows`.
 *
 * Cobre: seleção+publish de elegíveis, idempotência (2º tick na mesma janela não
 * duplica), guarda de lock (instância sem lock não toca no DB), e tolerância a
 * falha por-workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FollowupDeps } from './followup';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

/** Fila de respostas para o `execute` cross-tenant (descoberta de workspaces). */
let discoverQueue: unknown[][] = [];
const discoverExecute = vi.fn(async () => discoverQueue.shift() ?? []);

/** Resposta do SELECT de elegibilidade por workspace (mesma para todos no teste). */
let eligibleRows: unknown[] = [];
const txExecute = vi.fn(async () => eligibleRows);

let withWorkspaceImpl: (id: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

vi.mock('@hm/db', () => ({
  getDb: () => ({ execute: discoverExecute }),
  withWorkspace: (id: string, fn: (tx: unknown) => Promise<unknown>) => withWorkspaceImpl(id, fn),
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
      if (key !== undefined && store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
}

/** Canal AMQP fake: captura os envelopes publicados em cada fila. */
function makeChannel() {
  const published: { queue: string; envelope: Record<string, unknown> }[] = [];
  return {
    published,
    sendToQueue: vi.fn((queue: string, buf: Buffer) => {
      published.push({ queue, envelope: JSON.parse(buf.toString()) as Record<string, unknown> });
      return true;
    }),
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
}

const WS = '00000000-0000-0000-0000-0000000000aa';
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
type Channel = ReturnType<typeof makeChannel>;
type Logger = ReturnType<typeof makeLogger>;

interface Deps {
  redis: Redis;
  channel: Channel;
  logger: Logger;
}

/** Coerção dos fakes para `FollowupDeps` (as portas só usam um subconjunto). */
function asDeps(d: Deps): FollowupDeps {
  return d as unknown as FollowupDeps;
}

function deps(): Deps {
  return { redis: makeRedis(), channel: makeChannel(), logger: makeLogger() };
}

beforeEach(() => {
  discoverQueue = [];
  eligibleRows = [];
  discoverExecute.mockClear();
  txExecute.mockClear();
  withWorkspaceImpl = (_id, fn) => fn({ execute: txExecute });
});

describe('runFollowupTick', () => {
  it('seleciona elegíveis, marca idempotência e publica flow.run.requested', async () => {
    eligibleRows = [eligibleRow];
    const d = deps();

    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(1);
    expect(res.enqueued).toBe(1);
    expect(res.skippedDuplicate).toBe(0);

    // Publicou no hm.q.flows com o shape EXATO do worker de F2-S11.
    expect(d.channel.published).toHaveLength(1);
    const pub = d.channel.published[0];
    expect(pub?.queue).toBe('hm.q.flows');
    expect(pub?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(pub?.envelope['payload']).toEqual({
      conversationId: CONV,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
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
    const channel = makeChannel();
    const logger = makeLogger();
    const d = { redis, channel, logger };

    const first = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(first.enqueued).toBe(1);

    // Mesma janela (mesmo last_message_epoch) → a marca já existe → pula.
    const second = await runFollowupTick(asDeps(d), { workspaceId: WS });
    expect(second.ran).toBe(true);
    expect(second.enqueued).toBe(0);
    expect(second.skippedDuplicate).toBe(1);

    // Só um envelope publicado no total (não duplicou).
    expect(channel.published).toHaveLength(1);
  });

  it('nova janela (novo last_message_epoch) permite novo follow-up', async () => {
    const redis = makeRedis();
    const channel = makeChannel();
    const d = { redis, channel, logger: makeLogger() };

    eligibleRows = [eligibleRow];
    await runFollowupTick(asDeps(d), { workspaceId: WS });

    // Contato mandou nova mensagem → last_message_at mudou → novo bucket.
    eligibleRows = [{ ...eligibleRow, last_message_epoch: BUCKET + 5000 }];
    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.enqueued).toBe(1);
    expect(channel.published).toHaveLength(2);
  });

  it('pula o tick sem tocar no DB quando o lock está detido por outra instância', async () => {
    const redis = makeRedis();
    // Outra instância já detém o lock.
    redis.store.set(FOLLOWUP_LOCK_KEY, 'other-instance-token');
    const channel = makeChannel();
    const d = { redis, channel, logger: makeLogger() };

    eligibleRows = [eligibleRow];
    const res = await runFollowupTick(asDeps(d), { workspaceId: WS });

    expect(res.ran).toBe(false);
    expect(res.enqueued).toBe(0);
    expect(channel.published).toHaveLength(0);
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
    expect(d.channel.published).toHaveLength(0);
  });

  it('falha de um workspace não derruba os demais e libera o lock', async () => {
    discoverQueue = [[{ workspace_id: 'ws-bad' }, { workspace_id: 'ws-ok' }]];
    const d = deps();
    eligibleRows = [eligibleRow];
    withWorkspaceImpl = (id, fn) => {
      if (id === 'ws-bad') return Promise.reject(new Error('boom'));
      return fn({ execute: txExecute });
    };

    const res = await runFollowupTick(asDeps(d));

    expect(res.ran).toBe(true);
    expect(res.workspaces).toBe(2);
    expect(res.enqueued).toBe(1); // só ws-ok
    expect(d.logger.error).toHaveBeenCalledWith(
      'followup: tick de workspace falhou',
      expect.objectContaining({ workspaceId: 'ws-bad' }),
    );
    // Lock liberado mesmo com falha parcial.
    expect(d.redis.store.has(FOLLOWUP_LOCK_KEY)).toBe(false);
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
    expect(d.channel.published).toHaveLength(0);

    // Aguarda o primeiro tick real concluir (publica em hm.q.flows).
    await vi.waitFor(() => {
      expect(d.channel.sendToQueue).toHaveBeenCalled();
    });

    // Após stop, nenhum novo tick dispara.
    await handle.stop();
    const after = d.channel.sendToQueue.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(d.channel.sendToQueue.mock.calls.length).toBe(after);
  });
});
