/**
 * F70-S13 — disparo de campanha que ABRE a conversa publica `conversation.opened`
 * contra o Postgres dev (RLS real).
 *
 * Protege: publica uma vez e só depois do commit (outra conexão já enxerga a
 * conversa no instante da publicação); conversa existente não é "aberta" de novo;
 * rollback da transação de disparo não publica nada.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import type { DomainEventDraft } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { createCampaignTickPorts, type CampaignDbDeps } from './db-ports';
import type { RunningCampaign } from './tick';

const url = process.env['DATABASE_URL'];

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

describe.skipIf(!url)('F70-S13 campanha abre conversa → conversation.opened', () => {
  const sfx = randomUUID().slice(0, 8);
  let workspaceId = '';
  let channelId = '';
  let campaignId = '';
  let stepId = '';

  const sendToQueue = vi.fn((): boolean => true);
  const channel = { sendToQueue } as unknown as CampaignDbDeps['channel'];

  /** Cada publicação + se a conversa já estava commitada (visível por outra conexão). */
  const publicados: Array<{ draft: DomainEventDraft; commitada: boolean }> = [];
  const ports = createCampaignTickPorts({
    channel,
    logger: makeLogger(),
    emitEvent: async (draft) => {
      const id = draft.event === 'conversation.opened' ? draft.data.conversationId : '';
      const visiveis = await getDb()
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, id));
      publicados.push({ draft, commitada: visiveis.length === 1 });
      return true;
    },
  });

  const campanha = (): RunningCampaign => ({
    id: campaignId,
    workspaceId,
    channelId,
    sendWindows: null,
    rateLimitPerMinute: 60,
    deliveryRate: null,
  });

  /** Contato + recipient pendente. Telefone único por teste. */
  async function destinatario(telefone: string) {
    const db = getDb();
    const [contato] = await db
      .insert(schema.contacts)
      .values({ workspaceId, phone: telefone })
      .returning({ id: schema.contacts.id });
    if (!contato) throw new Error('contato não criado');
    const [recipient] = await db
      .insert(schema.campaignRecipients)
      .values({ workspaceId, campaignId, contactId: contato.id })
      .returning({ id: schema.campaignRecipients.id });
    if (!recipient) throw new Error('recipient não criado');
    return { contactId: contato.id, recipientId: recipient.id };
  }

  function disparar(d: { contactId: string; recipientId: string }) {
    return ports.enqueueDelivery(
      campanha(),
      { recipientId: d.recipientId, contactId: d.contactId, stepId, stepIndex: 0 },
      `f70s13:${d.recipientId}:0`,
      new Date(),
    );
  }

  const conversasDo = (telefone: string) =>
    getDb()
      .select({ id: schema.conversations.id, contactId: schema.conversations.contactId })
      .from(schema.conversations)
      .where(eq(schema.conversations.remoteId, telefone));

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S13 camp', slug: `f70s13-camp-${sfx}`, planId: null })
      .returning();
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;
    const [canal] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA',
        phoneNumberId: `PN_F70S13C_${sfx}`,
        wabaId: `WABA_F70S13C_${sfx}`,
      })
      .returning();
    if (!canal) throw new Error('canal não criado');
    channelId = canal.id;
    const [camp] = await db
      .insert(schema.campaigns)
      .values({ workspaceId, channelId, name: 'F70S13', type: 'broadcast', status: 'running' })
      .returning();
    if (!camp) throw new Error('campanha não criada');
    campaignId = camp.id;
    const [step] = await db
      .insert(schema.campaignSteps)
      .values({ campaignId, position: 0, templateName: 'boas_vindas' })
      .returning();
    if (!step) throw new Error('step não criado');
    stepId = step.id;
  });

  afterAll(async () => {
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await closeDb();
  });

  it('conversa criada pelo disparo → um evento, depois do commit, eventId canônico', async () => {
    const telefone = `551190${sfx.replace(/\D/g, '1').padEnd(5, '1').slice(0, 5)}1`;
    const d = await destinatario(telefone);
    const antes = publicados.length;

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });

    const [conversa] = await conversasDo(telefone);
    expect(conversa).toBeDefined();
    const novos = publicados.slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]?.commitada).toBe(true);
    expect(novos[0]?.draft).toMatchObject({
      event: 'conversation.opened',
      workspaceId,
      eventId: `${conversa!.id}:opened`,
      data: { conversationId: conversa!.id, contactId: d.contactId, channelId, trigger: 'inbound' },
    });
  });

  it('conversa já existente (o contato escreveu antes) → nenhum evento', async () => {
    const telefone = `551190${sfx.replace(/\D/g, '2').padEnd(5, '2').slice(0, 5)}2`;
    const d = await destinatario(telefone);
    await getDb()
      .insert(schema.conversations)
      .values({ workspaceId, channelId, contactId: d.contactId, remoteId: telefone });
    const antes = publicados.length;

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });

    expect(publicados.length).toBe(antes);
    expect(await conversasDo(telefone)).toHaveLength(1);
  });

  it('rollback do disparo → nenhum evento, nenhuma conversa', async () => {
    const telefone = `551190${sfx.replace(/\D/g, '3').padEnd(5, '3').slice(0, 5)}3`;
    const d = await destinatario(telefone);
    const antes = publicados.length;
    sendToQueue.mockImplementationOnce(() => {
      throw new Error('broker caiu');
    });

    await expect(disparar(d)).rejects.toThrow('broker caiu');

    expect(publicados.length).toBe(antes);
    expect(await conversasDo(telefone)).toHaveLength(0);
    const [recipient] = await getDb()
      .select({ status: schema.campaignRecipients.status })
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.id, d.recipientId));
    expect(recipient?.status).toBe('pending');
  });
});
