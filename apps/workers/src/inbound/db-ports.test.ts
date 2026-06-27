/**
 * Integração F52-S08 do pipeline inbound (DbInboundPersistence + messagesRepo):
 *
 *  1. `provider_timestamp` é persistido a partir do `rawTimestamp` do provider.
 *  2. Dedup de DISPARO de flow: reentrega de um envelope cuja mensagem já existe
 *     NÃO re-dispara o hook de flows (1 execução, não 2). Caminho feliz: nova
 *     mensagem dispara o hook normalmente.
 *  3. Ordenação fiel: `messagesRepo.listByConversation` ordena por
 *     `coalesce(provider_timestamp, created_at)` — mensagem com horário de provider
 *     anterior não "pula para o fim" só por ter sido inserida depois.
 *
 * Toca o Postgres dev (RLS) — pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, messagesRepo, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { Logger } from '@hm/logger';
import { DbInboundPersistence, type InboundFlowEnqueuePort, type InboundSocketPort } from './db-ports';
import type { StatusDeps } from './status';
import type { PersistInboundRequest } from './ports';
import type { InboundEvent } from '@hm/channels';

const url = process.env['DATABASE_URL'];

// ─── Fakes (sem IO) ───────────────────────────────────────────────────────────

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};

const noopFlow: InboundFlowEnqueuePort = {
  async enqueue() {},
};

const noopStatusDeps: StatusDeps = {
  channels: { async resolve() { return null; } },
  persistence: { async applyStatus() { return null; } },
  socket: { async emitStatusChanged() {} },
};

/** Hook de flows que apenas conta quantas vezes foi acionado (por mensagem). */
class CountingHook {
  count = 0;
  async onContactMessage(): Promise<void> {
    this.count += 1;
  }
}

function textEvent(externalId: string, contactRemoteId: string, rawTimestamp: string): InboundEvent {
  return {
    type: 'message',
    provider: 'meta_whatsapp',
    contactRemoteId,
    externalId,
    messageType: 'text',
    content: 'oi ' + externalId,
    rawTimestamp,
  };
}

describe.skipIf(!url)('F52-S08 inbound: provider_timestamp + dedup de flow + ordenação', () => {
  const logger: Logger = createLogger('error');
  const sfx = randomUUID().slice(0, 8);
  const phoneNumberId = 'PN_' + sfx;
  const contactPhone = '5511' + sfx.replace(/\D/g, '0').slice(0, 6);
  let workspaceId = '';
  let channelId = '';

  beforeAll(async () => {
    const db = getDb(); // owner → bypassa RLS no setup
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F52S08', slug: 'f52s08-' + sfx, planId: null })
      .returning();
    if (!ws) throw new Error('workspace de teste não criado');
    workspaceId = ws.id;

    const [ch] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA test',
        phoneNumberId,
        wabaId: 'WABA_' + sfx,
        isActive: true,
      })
      .returning();
    if (!ch) throw new Error('channel de teste não criado');
    channelId = ch.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (workspaceId) {
      // FK: messages → conversations → contacts/channels → workspace.
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      for (const c of convs) {
        await db.delete(schema.messages).where(eq(schema.messages.conversationId, c.id));
      }
      await db.delete(schema.conversations).where(eq(schema.conversations.workspaceId, workspaceId));
      await db.delete(schema.contacts).where(eq(schema.contacts.workspaceId, workspaceId));
      await db.delete(schema.channels).where(eq(schema.channels.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  it('persiste provider_timestamp e dispara o hook só na inserção efetiva (dedup de reentrega)', async () => {
    const hook = new CountingHook();
    const persistence = new DbInboundPersistence(
      noopSocket,
      noopFlow,
      noopStatusDeps,
      logger,
      undefined,
      hook,
    );

    const providerTs = '2024-03-10T12:00:00.000Z';
    const ext = 'wamid.' + sfx + '.A';
    const req: PersistInboundRequest = {
      provider: 'meta_whatsapp',
      routing: { phoneNumberId },
      events: [textEvent(ext, contactPhone, providerTs)],
    };

    // 1ª entrega: insere 1 mensagem e dispara o hook 1×.
    const first = await persistence.persist(req);
    expect(first.inserted).toBe(1);
    expect(first.resolved).toBe(true);
    expect(hook.count).toBe(1);

    // provider_timestamp persistido = horário do provider.
    const db = getDb();
    const [row] = await db
      .select({ providerTimestamp: schema.messages.providerTimestamp })
      .from(schema.messages)
      .where(eq(schema.messages.externalId, ext))
      .limit(1);
    expect(row?.providerTimestamp?.toISOString()).toBe(providerTs);

    // 2ª entrega (reentrega): mensagem já existe → dedup → hook NÃO roda de novo.
    const second = await persistence.persist(req);
    expect(second.inserted).toBe(0);
    expect(second.deduped).toBe(1);
    expect(hook.count).toBe(1); // continua 1: flow não disparado 2×
  });

  it('listByConversation ordena por provider_timestamp, não por hora de inserção', async () => {
    const db = getDb();
    // Conversa dedicada para o teste de ordenação.
    const contactId = (
      await db
        .insert(schema.contacts)
        .values({ workspaceId, phone: 'order-' + sfx, source: 'whatsapp' })
        .returning({ id: schema.contacts.id })
    )[0]?.id;
    if (!contactId) throw new Error('contato de teste não criado');
    const conversationId = (
      await db
        .insert(schema.conversations)
        .values({
          workspaceId,
          channelId,
          contactId,
          remoteId: 'order-' + sfx,
          kind: 'direct',
          status: 'open',
          aiMode: 'off',
        })
        .returning({ id: schema.conversations.id })
    )[0]?.id;
    if (!conversationId) throw new Error('conversa de teste não criada');

    // created_at e provider_timestamp DIVERGEM de propósito:
    //  - msgEarly: inserida por ÚLTIMO (created_at maior) mas provider 09:00.
    //  - msgLate : inserida primeiro (created_at menor) mas provider 10:00.
    // Ordenação correta (provider desc): [msgLate, msgEarly].
    // Ordenação por created_at desc daria o inverso → o teste distingue.
    const createdEarly = new Date('2024-03-01T00:00:00.000Z');
    const createdLate = new Date('2024-03-02T00:00:00.000Z');
    await db.insert(schema.messages).values({
      workspaceId,
      conversationId,
      externalId: 'ord.late.' + sfx,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'late-provider',
      createdAt: createdEarly,
      providerTimestamp: new Date('2024-03-01T10:00:00.000Z'),
    });
    await db.insert(schema.messages).values({
      workspaceId,
      conversationId,
      externalId: 'ord.early.' + sfx,
      direction: 'inbound',
      senderType: 'contact',
      type: 'text',
      content: 'early-provider',
      createdAt: createdLate,
      providerTimestamp: new Date('2024-03-01T09:00:00.000Z'),
    });

    const page = await messagesRepo.listByConversation(conversationId);
    expect(page.map((m) => m.content)).toEqual(['late-provider', 'early-provider']);
  });
});
