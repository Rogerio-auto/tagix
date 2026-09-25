/**
 * F70-S25 — o follow-up automático grava o gatilho (`flow.run.requested` → `hm.q.flows`)
 * na outbox, na transação que lê as elegíveis (Postgres dev, RLS real do `withWorkspace`):
 *  - commit: UM job por conversa elegível; o segundo tick na mesma janela não grava outro;
 *  - rollback forçado antes do COMMIT: nenhum job, e a marca é desfeita — o tick seguinte
 *    segue a mesma janela.
 *
 * Usa o template global `follow_up` (seed) e um agente ativo do workspace. Redis é fake.
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
const { outboxRowsOf } = await import('../outbox/testing');
const { runFollowupTick } = await import('./followup');
type Deps = Parameters<typeof runFollowupTick>[0];

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONTACT = randomUUID();
const sfx = WS.slice(0, 8);
const now = new Date();

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

/** Conversa com IA on, contato falou por último há 2h (dentro da janela de 24h). */
async function idleConversation(): Promise<string> {
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
      aiMode: 'on',
      lastMessageFrom: 'contact',
      lastMessageAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    });
  return id;
}

async function jobsOf(conversationId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.routingKey === 'hm.q.flows' &&
      (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
  );
}

async function closeConversation(id: string): Promise<void> {
  await getDb()
    .update(schema.conversations)
    .set({ status: 'resolved' })
    .where(eq(schema.conversations.id, id));
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  const [template] = await db
    .select({ id: schema.agentTemplates.id })
    .from(schema.agentTemplates)
    .where(eq(schema.agentTemplates.key, 'follow_up'))
    .limit(1);
  if (template === undefined) throw new Error('fixture: template global follow_up ausente (seed)');
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70S25 followup', slug: `f70s25-fu-${sfx}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70S25 followup',
    phoneNumberId: `PN_F70S25_FU_${sfx}`,
    wabaId: `WABA_F70S25_FU_${sfx}`,
  });
  await db.insert(schema.contacts).values({
    id: CONTACT,
    workspaceId: WS,
    phone: '+55115' + sfx.replace(/\D/g, '1').padEnd(8, '1').slice(0, 8),
  });
  await db.insert(schema.agents).values({
    workspaceId: WS,
    name: 'Follow-up F70-S25',
    systemPrompt: 'x',
    templateId: template.id,
    replyIfIdleSec: 3600,
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

describe.skipIf(!ready)('follow-up → gatilho da IA na outbox (F70-S25)', () => {
  it('commit: UM job; o segundo tick na mesma janela não grava outro', async () => {
    const conv = await idleConversation();
    const deps = { redis: makeRedis(), logger } as unknown as Deps;

    const first = await runFollowupTick(deps, { workspaceId: WS, now });
    expect(first).toMatchObject({ ran: true, enqueued: 1 });
    const jobs = await jobsOf(conv);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '' });
    expect(jobs[0]?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(jobs[0]?.envelope.payload).toEqual({
      conversationId: conv,
      contactId: CONTACT,
      channelId: CHANNEL,
      provider: 'meta_whatsapp',
    });

    const second = await runFollowupTick(deps, { workspaceId: WS, now });
    expect(second).toMatchObject({ enqueued: 0, skippedDuplicate: 1 });
    expect(await jobsOf(conv)).toHaveLength(1);
    await closeConversation(conv);
  });

  it('rollback: nenhum job e a marca é desfeita; o tick seguinte segue a janela', async () => {
    const conv = await idleConversation();
    const redis = makeRedis();
    const deps = { redis, logger } as unknown as Deps;

    rollback.armed = true;
    const failed = await runFollowupTick(deps, { workspaceId: WS, now });
    rollback.armed = false;
    expect(failed.enqueued).toBe(0);
    expect(await jobsOf(conv)).toHaveLength(0);
    expect([...redis.store.keys()].filter((k) => k.includes(conv))).toEqual([]);

    const retried = await runFollowupTick(deps, { workspaceId: WS, now });
    expect(retried.enqueued).toBe(1);
    expect(await jobsOf(conv)).toHaveLength(1);
  });
});
