/**
 * Trava de origem da IA (F70-S07) no port real de outbound — Postgres dev + RLS.
 *
 * O UPDATE de `ai_mode='on'` é condicional na `origin` da conversa: prova-se aqui,
 * contra o banco, que conversa `sem-origem`/`prospeccao`/NULL continua `off` e que
 * conversa de anúncio liga. Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { ConversationOriginValue } from '@hm/shared';
import { createOutboundPort } from './outbound.port';
import { AI_ELIGIBLE_CONVERSATION_ORIGINS, isConversationAiEligible } from '../ai-origin-gate';

const url = process.env['DATABASE_URL'];

describe('AI_ELIGIBLE_CONVERSATION_ORIGINS', () => {
  it('só anúncio, site e instagram', () => {
    expect([...AI_ELIGIBLE_CONVERSATION_ORIGINS].sort()).toEqual([
      'origem:anuncio',
      'origem:instagram',
      'origem:site',
    ]);
  });
  it('NULL/desconhecido é inelegível (fail-closed)', () => {
    expect(isConversationAiEligible(null)).toBe(false);
    expect(isConversationAiEligible(undefined)).toBe(false);
    expect(isConversationAiEligible('origem:qualquer')).toBe(false);
    expect(isConversationAiEligible('sem-origem')).toBe(false);
    expect(isConversationAiEligible('origem:prospeccao')).toBe(false);
    expect(isConversationAiEligible('origem:anuncio')).toBe(true);
  });
});

describe.skipIf(!url)('F70-S07 setConversationAi — trava de origem (DB)', () => {
  const sfx = randomUUID().slice(0, 8);
  const port = createOutboundPort();
  let workspaceId = '';
  let channelId = '';
  let contactId = '';

  async function conversation(origin: ConversationOriginValue | null): Promise<string> {
    const [row] = await getDb()
      .insert(schema.conversations)
      .values({
        workspaceId,
        channelId,
        contactId,
        remoteId: `r-${origin ?? 'null'}-${randomUUID().slice(0, 6)}`,
        aiMode: 'off',
        origin,
      })
      .returning({ id: schema.conversations.id });
    if (!row) throw new Error('conversa de teste não criada');
    return row.id;
  }

  async function aiModeOf(id: string): Promise<string | undefined> {
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    return row?.aiMode;
  }

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S07 gate', slug: 'f70s07-gate-' + sfx })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;
    const [ch] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA gate',
        phoneNumberId: 'PN_GATE_' + sfx,
        wabaId: 'WABA_GATE_' + sfx,
        isActive: true,
      })
      .returning();
    if (!ch) throw new Error('canal não criado');
    channelId = ch.id;
    const [ct] = await db
      .insert(schema.contacts)
      .values({ workspaceId, phone: '5511' + sfx.replace(/\D/g, '1').slice(0, 7) })
      .returning();
    if (!ct) throw new Error('contato não criado');
    contactId = ct.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      await db.delete(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  it.each([['sem-origem' as const], ['origem:prospeccao' as const], [null]])(
    'origin=%s → ACTIVATE recusado, IA continua off',
    async (origin) => {
      const id = await conversation(origin);
      const r = await port.setConversationAi(workspaceId, {
        conversationId: id,
        aiMode: 'on',
        agentId: null,
      });
      expect(r).toEqual({ applied: false, reason: 'origin_not_eligible' });
      expect(await aiModeOf(id)).toBe('off');
    },
  );

  it.each([['origem:anuncio' as const], ['origem:site' as const], ['origem:instagram' as const]])(
    'origin=%s → ACTIVATE liga a IA',
    async (origin) => {
      const id = await conversation(origin);
      const r = await port.setConversationAi(workspaceId, {
        conversationId: id,
        aiMode: 'on',
        agentId: null,
      });
      expect(r).toEqual({ applied: true });
      expect(await aiModeOf(id)).toBe('on');
    },
  );

  it('desligar/pausar não tem trava', async () => {
    const id = await conversation('sem-origem');
    await getDb()
      .update(schema.conversations)
      .set({ aiMode: 'on' }) // ligada à mão (humano) antes
      .where(eq(schema.conversations.id, id));
    const r = await port.setConversationAi(workspaceId, { conversationId: id, aiMode: 'off' });
    expect(r).toEqual({ applied: true });
    expect(await aiModeOf(id)).toBe('off');
  });

  it('conversa inexistente → conversation_not_found', async () => {
    const r = await port.setConversationAi(workspaceId, {
      conversationId: randomUUID(),
      aiMode: 'on',
      agentId: null,
    });
    expect(r).toEqual({ applied: false, reason: 'conversation_not_found' });
  });
});
