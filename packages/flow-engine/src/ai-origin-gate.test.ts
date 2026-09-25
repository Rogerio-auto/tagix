/**
 * F70-S30 — trava de origem configurável por workspace: a fonte única.
 *
 * 1) Puro: `passesAiOriginGate` (só o booleano `false` desliga a trava).
 * 2) Banco (Postgres dev): o predicado SQL (`aiOriginGateSql`) e a decisão em memória
 *    concordam em toda a matriz trava × origem; e o port real de outbound (flow
 *    `ai_action` e, por ele, o handoff de campanha) liga a IA em conversa sem origem só
 *    com a trava desligada, lendo a configuração no próprio UPDATE.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { CONVERSATION_ORIGINS, type ConversationOriginValue } from '@hm/shared';
import {
  aiOriginGateSql,
  isConversationAiEligible,
  passesAiOriginGate,
  workspaceRequiresProvenOriginSql,
} from './ai-origin-gate';
import { createOutboundPort } from './ports/outbound.port';

const url = process.env['DATABASE_URL'];

describe('passesAiOriginGate (F70-S30)', () => {
  it('trava ligada: vale a origem', () => {
    expect(passesAiOriginGate({ requiresProvenOrigin: true, origin: 'origem:anuncio' })).toBe(true);
    expect(passesAiOriginGate({ requiresProvenOrigin: true, origin: 'sem-origem' })).toBe(false);
    expect(passesAiOriginGate({ requiresProvenOrigin: true, origin: null })).toBe(false);
  });

  it('trava desligada: qualquer origem passa, inclusive NULL e lixo', () => {
    for (const origin of [...CONVERSATION_ORIGINS, null, undefined, 'origem:qualquer']) {
      expect(passesAiOriginGate({ requiresProvenOrigin: false, origin })).toBe(true);
    }
  });

  it('fail-closed: só o booleano false desliga', () => {
    for (const requiresProvenOrigin of [null, undefined, 'false', 0, 'f', {}]) {
      expect(passesAiOriginGate({ requiresProvenOrigin, origin: 'sem-origem' })).toBe(false);
    }
  });
});

describe.skipIf(!url)('trava de origem por workspace — SQL e port (DB, F70-S30)', () => {
  const sfx = randomUUID().slice(0, 8);
  const LOCKED = randomUUID();
  const OPEN = randomUUID();
  const channels = new Map<string, string>();
  const contacts = new Map<string, string>();
  const port = createOutboundPort();
  const origins: readonly (ConversationOriginValue | null)[] = [...CONVERSATION_ORIGINS, null];

  async function conversation(
    workspaceId: string,
    origin: ConversationOriginValue | null,
  ): Promise<string> {
    const [row] = await getDb()
      .insert(schema.conversations)
      .values({
        workspaceId,
        channelId: channels.get(workspaceId) ?? '',
        contactId: contacts.get(workspaceId) ?? null,
        remoteId: `r-${origin ?? 'null'}-${randomUUID().slice(0, 8)}`,
        aiMode: 'off',
        origin,
      })
      .returning({ id: schema.conversations.id });
    if (!row) throw new Error('conversa não criada');
    return row.id;
  }

  async function aiModeOf(id: string): Promise<string | undefined> {
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    return row?.aiMode;
  }

  async function setLock(workspaceId: string, value: boolean): Promise<void> {
    await getDb()
      .update(schema.workspaces)
      .set({ aiRequiresProvenOrigin: value })
      .where(eq(schema.workspaces.id, workspaceId));
  }

  beforeAll(async () => {
    const db = getDb();
    await db.insert(schema.workspaces).values([
      { id: LOCKED, name: 'F70S30 travado', slug: `f70s30-lk-${sfx}` },
      { id: OPEN, name: 'F70S30 aberto', slug: `f70s30-op-${sfx}` },
    ]);
    await setLock(OPEN, false);
    for (const [i, ws] of [LOCKED, OPEN].entries()) {
      const [ch] = await db
        .insert(schema.channels)
        .values({
          workspaceId: ws,
          provider: 'meta_whatsapp',
          name: `WA F70S30 ${i}`,
          phoneNumberId: `PN_F70S30_${i}_${sfx}`,
          wabaId: `WABA_F70S30_${i}_${sfx}`,
        })
        .returning({ id: schema.channels.id });
      const [ct] = await db
        .insert(schema.contacts)
        .values({ workspaceId: ws, phone: `55119${i}${sfx.replace(/\D/g, '3').padEnd(6, '3').slice(0, 6)}` })
        .returning({ id: schema.contacts.id });
      if (!ch || !ct) throw new Error('seed');
      channels.set(ws, ch.id);
      contacts.set(ws, ct.id);
    }
  });

  afterAll(async () => {
    const db = getDb();
    for (const ws of [LOCKED, OPEN]) {
      await db.delete(schema.conversations).where(eq(schema.conversations.workspaceId, ws));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
    }
    await closeDb();
  });

  it('workspace novo nasce travado (coluna NOT NULL DEFAULT true)', async () => {
    const [row] = await getDb()
      .select({ v: schema.workspaces.aiRequiresProvenOrigin })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, LOCKED));
    expect(row?.v).toBe(true);
  });

  it('SQL e memória concordam em toda a matriz trava × origem (sob RLS)', async () => {
    for (const ws of [LOCKED, OPEN]) {
      for (const origin of origins) {
        const id = await conversation(ws, origin);
        const [row] = await withWorkspace(ws, (tx) =>
          tx
            .select({
              passes: aiOriginGateSql(),
              requiresProvenOrigin: workspaceRequiresProvenOriginSql(),
              origin: schema.conversations.origin,
            })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, id)),
        );
        if (!row) throw new Error('conversa invisível');
        expect(row.requiresProvenOrigin).toBe(ws === LOCKED);
        const expected = ws === OPEN || isConversationAiEligible(origin);
        expect(row.passes).toBe(expected);
        expect(passesAiOriginGate(row)).toBe(expected);
      }
    }
  });

  it.each([['sem-origem' as const], ['origem:prospeccao' as const], [null]])(
    'trava desligada: origin=%s → ACTIVATE liga a IA',
    async (origin) => {
      const id = await conversation(OPEN, origin);
      const r = await port.setConversationAi(OPEN, { conversationId: id, aiMode: 'on', agentId: null });
      expect(r).toEqual({ applied: true });
      expect(await aiModeOf(id)).toBe('on');
    },
  );

  it('trava ligada no mesmo cenário: recusa (a regra antiga continua)', async () => {
    const id = await conversation(LOCKED, 'sem-origem');
    const r = await port.setConversationAi(LOCKED, { conversationId: id, aiMode: 'on', agentId: null });
    expect(r).toEqual({ applied: false, reason: 'origin_not_eligible' });
    expect(await aiModeOf(id)).toBe('off');
  });

  it('a configuração vale no instante do UPDATE: religar a trava volta a barrar', async () => {
    const a = await conversation(OPEN, 'sem-origem');
    await setLock(OPEN, true);
    try {
      const r = await port.setConversationAi(OPEN, { conversationId: a, aiMode: 'on', agentId: null });
      expect(r).toEqual({ applied: false, reason: 'origin_not_eligible' });
      expect(await aiModeOf(a)).toBe('off');
    } finally {
      await setLock(OPEN, false);
    }
    const r2 = await port.setConversationAi(OPEN, { conversationId: a, aiMode: 'on', agentId: null });
    expect(r2).toEqual({ applied: true });
  });
});
