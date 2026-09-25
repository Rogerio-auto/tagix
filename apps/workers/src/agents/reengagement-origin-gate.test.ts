/**
 * F70-S08 — trava de origem na retomada da IA por reengajamento, contra o Postgres dev.
 *
 * O teste unitário (`reengagement.test.ts`) mocka o `@hm/db`; aqui o tick roda o
 * SELECT de elegíveis e o UPDATE condicional de verdade (RLS via `withWorkspace`).
 * Três conversas pausadas por `human_takeover` com a janela ociosa vencida:
 *  - `origem:anuncio` → retoma (`on`) e publica o run;
 *  - `sem-origem` → continua `paused`, nada publicado;
 *  - origem NULL (legado) → continua `paused` (fail-closed).
 * F70-S30: com a trava do workspace desligada, as duas últimas também retomam.
 *
 * Redis é fake em memória; o gatilho é lido da outbox (F70-S25), gravado na transação da
 * retomada. Skip automático sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { ConversationOriginValue } from '@hm/shared';
import { outboxRowsOf } from '../outbox/testing';
import { runReengagementTick, type ReengagementDeps } from './reengagement';

const url = process.env['DATABASE_URL'];

function makeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, _mode: string, _ttl: number, cond?: string) {
      if (cond === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK' as const;
    },
    async eval(_script: string, _n: number, ...args: string[]) {
      const [key, token] = args;
      if (key !== undefined && store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

describe.skipIf(!url)('reengajamento — trava de origem (DB, F70-S08)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const CONTACT = randomUUID();
  const sfx = WS.slice(0, 8);
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const convs: Record<'anuncio' | 'semOrigem' | 'legado', string> = {
    anuncio: randomUUID(),
    semOrigem: randomUUID(),
    legado: randomUUID(),
  };

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values({ id: WS, name: 'F70S08 reeng', slug: `f70s08-re-${sfx}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'meta_whatsapp',
      name: 'WA F70S08',
      phoneNumberId: `PN_F70S08_RE_${sfx}`,
      wabaId: `WABA_F70S08_RE_${sfx}`,
    });
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      phone: '+55117' + sfx.replace(/\D/g, '5').padEnd(8, '5').slice(0, 8),
    });
    const origins: Record<keyof typeof convs, ConversationOriginValue | null> = {
      anuncio: 'origem:anuncio',
      semOrigem: 'sem-origem',
      legado: null,
    };
    for (const key of Object.keys(convs) as (keyof typeof convs)[]) {
      const id = convs[key];
      await db.insert(schema.conversations).values({
        id,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId: CONTACT,
        remoteId: `r-${id.slice(0, 12)}`,
        origin: origins[key],
        aiMode: 'paused',
        aiPausedReason: 'human_takeover',
        aiPausedAt: twoHoursAgo,
        aiLastHumanAt: twoHoursAgo,
      });
    }
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  it('só a conversa com origem comprovada retoma; as demais seguem pausadas', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps = { redis: makeRedis(), logger } as unknown as ReengagementDeps;

    const res = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });

    expect(res).toMatchObject({ ran: true, enqueued: 1, blockedByOrigin: 2, skippedDuplicate: 0 });
    // F70-S25: o gatilho entrou na outbox (commitado), um só, e só para a conversa elegível.
    const published = (await outboxRowsOf(WS)).filter((r) => r.routingKey === 'hm.q.flows');
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ kind: 'job', exchange: '' });
    expect(published[0]?.envelope).toMatchObject({ type: 'flow.run.requested', workspaceId: WS });
    expect(published[0]?.envelope.payload).toMatchObject({ conversationId: convs.anuncio });

    const rows = await getDb()
      .select({
        id: schema.conversations.id,
        aiMode: schema.conversations.aiMode,
        aiPausedReason: schema.conversations.aiPausedReason,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.workspaceId, WS));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(convs.anuncio)).toMatchObject({ aiMode: 'on', aiPausedReason: null });
    expect(byId.get(convs.semOrigem)).toMatchObject({ aiMode: 'paused', aiPausedReason: 'human_takeover' });
    expect(byId.get(convs.legado)).toMatchObject({ aiMode: 'paused', aiPausedReason: 'human_takeover' });

    const warned = logger.warn.mock.calls.map((c) => (c[1] as { conversationId?: string }).conversationId);
    expect(warned.sort()).toEqual([convs.semOrigem, convs.legado].sort());
  });

  it('F70-S30: com a trava do workspace desligada, as pausadas sem origem também retomam', async () => {
    await getDb()
      .update(schema.workspaces)
      .set({ aiRequiresProvenOrigin: false })
      .where(eq(schema.workspaces.id, WS));
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    const deps = { redis: makeRedis(), logger } as unknown as ReengagementDeps;

    const res = await runReengagementTick(deps, { workspaceId: WS, now, idleMinutes: 60 });

    expect(res).toMatchObject({ ran: true, enqueued: 2, blockedByOrigin: 0 });
    const published = (await outboxRowsOf(WS)).filter((r) => r.routingKey === 'hm.q.flows');
    const resumed = published.map((r) => (r.envelope.payload as { conversationId?: string }).conversationId);
    expect(resumed.sort()).toEqual([convs.anuncio, convs.semOrigem, convs.legado].sort());

    const rows = await getDb()
      .select({ id: schema.conversations.id, aiMode: schema.conversations.aiMode })
      .from(schema.conversations)
      .where(eq(schema.conversations.workspaceId, WS));
    expect(rows.every((r) => r.aiMode === 'on')).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
