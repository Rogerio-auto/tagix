/**
 * F70-S25 — a retomada da IA pelo reengajamento grava o gatilho (`flow.run.requested` →
 * `hm.q.flows`) na outbox, na MESMA transação do UPDATE que religa a IA (Postgres dev, RLS
 * real do `withWorkspace`):
 *  - commit: IA `on` e UM job, com o contrato do worker de agentes;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: a IA segue `paused`,
 *    nenhum job fica, e a marca de idempotência é desfeita — o tick seguinte retoma.
 *
 * A trava de origem tem teste próprio (`reengagement-origin-gate.test.ts`). Redis é fake.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';

const FORCED = 'F70-S25: rollback forçado pelo teste';
const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (rollback.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { agentRunRequestedPayloadSchema } = await import('@hm/shared/mq');
const { outboxRowsOf } = await import('../outbox/testing');
const { runReengagementTick } = await import('./reengagement');
type Deps = Parameters<typeof runReengagementTick>[0];

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const sfx = WS.slice(0, 8);
const now = new Date();
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string, _mode: string, _ttl: number, cond?: string) {
      if (cond === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK' as const;
    },
    async eval(_script: string, _n: number, ...args: string[]) {
      const [key, token] = args;
      if (key === undefined) return 0;
      // Só KEYS[1]: DEL da marca desfeita. Com token: unlock do titular.
      if (args.length === 1) return store.delete(key) ? 1 : 0;
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };

async function pausedConversation(): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.conversations)
    .values({
      id,
      workspaceId: WS,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: `r-${id.slice(0, 12)}`,
      origin: 'origem:anuncio',
      aiMode: 'paused',
      aiPausedReason: 'human_takeover',
      aiPausedAt: twoHoursAgo,
      aiLastHumanAt: twoHoursAgo,
    });
  return id;
}

async function aiModeOf(id: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ aiMode: schema.conversations.aiMode })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id));
  return row?.aiMode;
}

async function jobsOf(conversationId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.routingKey === 'hm.q.flows' &&
      (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
  );
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70S25 reeng', slug: `f70s25-re-${sfx}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70S25 reeng',
    phoneNumberId: `PN_F70S25_RE_${sfx}`,
    wabaId: `WABA_F70S25_RE_${sfx}`,
  });
  await db.insert(schema.contacts).values({
    id: CONTACT,
    workspaceId: WS,
    phone: '+55116' + sfx.replace(/\D/g, '2').padEnd(8, '2').slice(0, 8),
  });
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('reengajamento → gatilho da IA na outbox (F70-S25)', () => {
  it('commit: IA on e UM job em hm.q.flows', async () => {
    const conv = await pausedConversation();
    const deps = { redis: makeRedis(), logger } as unknown as Deps;
    const res = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });
    expect(res).toMatchObject({ ran: true, enqueued: 1 });

    expect(await aiModeOf(conv)).toBe('on');
    const jobs = await jobsOf(conv);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '' });
    expect(jobs[0]?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(agentRunRequestedPayloadSchema.parse(jobs[0]?.envelope.payload)).toEqual({
      conversationId: conv,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
    });
  });

  it('rollback: IA segue pausada, nenhum job, marca desfeita; o próximo tick retoma', async () => {
    const conv = await pausedConversation();
    const redis = makeRedis();
    const deps = { redis, logger } as unknown as Deps;

    rollback.armed = true;
    const failed = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });
    rollback.armed = false;
    expect(failed.enqueued).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      'reengajamento: tick de workspace falhou',
      expect.objectContaining({ workspaceId: WS, error: FORCED }),
    );
    expect(await aiModeOf(conv)).toBe('paused');
    expect(await jobsOf(conv)).toHaveLength(0);
    expect([...redis.store.keys()].filter((k) => k.includes(conv))).toEqual([]);

    const retried = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });
    expect(retried.enqueued).toBe(1);
    expect(await aiModeOf(conv)).toBe('on');
    expect(await jobsOf(conv)).toHaveLength(1);
  });
});
