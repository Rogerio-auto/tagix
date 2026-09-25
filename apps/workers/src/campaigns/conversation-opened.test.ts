/**
 * F70-S13 — disparo de campanha que ABRE a conversa publica `conversation.opened`
 * contra o Postgres dev (RLS real).
 *
 * Protege: publica uma vez e só depois do commit (outra conexão já enxerga a
 * conversa no instante da publicação); conversa existente não é "aberta" de novo;
 * rollback da transação de disparo não publica nada.
 *
 * F70-S14: origem `campaign`; o job de outbound sai só depois do commit e depois
 * do `conversation.opened` — rollback não deixa job; falha ao publicar o job
 * depois do commit compensa (delivery e mensagem somem, recipient volta ao passo
 * anterior com backoff) e a retentativa despacha de novo.
 *
 * O rollback é forçado pela transição do drip (`advanceAfterDispatch`), que roda
 * DENTRO da transação depois da mensagem inserida — o mock delega ao real fora do
 * teste de falha.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { z } from 'zod';
import { envelopeSchema, type DomainEventDraft } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { createCampaignTickPorts, type CampaignDbDeps } from './db-ports';
import type { RunningCampaign } from './tick';
import type * as StateModule from './steps/state';

const drip = vi.hoisted(() => ({ falhar: false }));
vi.mock('./steps/state', async (importOriginal) => {
  const real = await importOriginal<typeof StateModule>();
  return {
    ...real,
    advanceAfterDispatch: (...args: Parameters<typeof real.advanceAfterDispatch>) => {
      if (drip.falhar) {
        drip.falhar = false;
        throw new Error('falha simulada no drip');
      }
      return real.advanceAfterDispatch(...args);
    },
  };
});

const jobSchema = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid() });

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

  /**
   * Cada publicação + se a conversa já estava commitada (visível por outra conexão)
   * + quantos jobs de outbound já tinham saído naquele instante (ordem).
   */
  const publicados: Array<{ draft: DomainEventDraft; commitada: boolean; jobsAntes: number }> = [];
  const ports = createCampaignTickPorts({
    channel,
    logger: makeLogger(),
    emitEvent: async (draft) => {
      const jobsAntes = sendToQueue.mock.calls.length;
      const id = draft.event === 'conversation.opened' ? draft.data.conversationId : '';
      const visiveis = await getDb()
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, id));
      publicados.push({ draft, commitada: visiveis.length === 1, jobsAntes });
      return true;
    },
  });

  /** O último job de outbound publicado, lido do envelope que foi à fila. */
  function ultimoJob(): z.infer<typeof jobSchema> {
    const call: unknown[] | undefined = sendToQueue.mock.calls.at(-1);
    const body = call?.[1];
    if (!Buffer.isBuffer(body)) throw new Error('nenhum job publicado');
    const env = envelopeSchema.parse(JSON.parse(body.toString('utf8')));
    return jobSchema.parse(env.payload);
  }

  const recipientDe = async (recipientId: string) => {
    const [r] = await getDb()
      .select()
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.id, recipientId));
    return r;
  };
  const deliveriesDe = (recipientId: string) =>
    getDb()
      .select({ id: schema.campaignDeliveries.id })
      .from(schema.campaignDeliveries)
      .where(eq(schema.campaignDeliveries.recipientId, recipientId));
  const mensagensDa = (conversationId: string) =>
    getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));

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
    const jobs = sendToQueue.mock.calls.length;
    // No instante da publicação, a mensagem do job já está commitada (outra conexão
    // a enxerga): o job nunca aponta para uma linha que um rollback pode desfazer.
    let sonda: Promise<number> | null = null;
    sendToQueue.mockImplementationOnce((...args: unknown[]) => {
      const body = args[1];
      if (!Buffer.isBuffer(body)) throw new Error('corpo do job ausente');
      const { messageId } = jobSchema.parse(
        envelopeSchema.parse(JSON.parse(body.toString('utf8'))).payload,
      );
      sonda = getDb()
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId))
        .then((rows) => rows.length);
      return true;
    });

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });
    expect(await sonda).toBe(1);

    const [conversa] = await conversasDo(telefone);
    expect(conversa).toBeDefined();
    const novos = publicados.slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]?.commitada).toBe(true);
    expect(novos[0]?.draft).toMatchObject({
      event: 'conversation.opened',
      workspaceId,
      eventId: `${conversa!.id}:opened`,
      data: { conversationId: conversa!.id, contactId: d.contactId, channelId, trigger: 'campaign' },
    });
    // F70-S14: a conversa é anunciada antes do job da mensagem dela sair; um job só.
    expect(novos[0]?.jobsAntes).toBe(jobs);
    expect(sendToQueue.mock.calls.length).toBe(jobs + 1);
    const job = ultimoJob();
    expect(job.conversationId).toBe(conversa!.id);
    expect((await mensagensDa(conversa!.id)).map((m) => m.id)).toEqual([job.messageId]);
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

  it('rollback do disparo → nenhum job de outbound, nenhum evento, nada gravado', async () => {
    const telefone = `551190${sfx.replace(/\D/g, '3').padEnd(5, '3').slice(0, 5)}3`;
    const d = await destinatario(telefone);
    const antes = publicados.length;
    const jobs = sendToQueue.mock.calls.length;
    drip.falhar = true;

    await expect(disparar(d)).rejects.toThrow('falha simulada no drip');

    // F70-S14: a mensagem foi inserida e desfeita — nenhum job aponta para ela.
    expect(sendToQueue.mock.calls.length).toBe(jobs);
    expect(publicados.length).toBe(antes);
    expect(await conversasDo(telefone)).toHaveLength(0);
    expect(await deliveriesDe(d.recipientId)).toHaveLength(0);
    const recipient = await recipientDe(d.recipientId);
    expect(recipient?.status).toBe('pending');
    expect(recipient?.attempts).toBe(0);
  });

  it('job não publicado depois do commit → compensa; a retentativa despacha de novo', async () => {
    const telefone = `551190${sfx.replace(/\D/g, '4').padEnd(5, '4').slice(0, 5)}4`;
    const d = await destinatario(telefone);
    const antes = publicados.length;
    const jobs = sendToQueue.mock.calls.length;
    sendToQueue.mockImplementationOnce(() => {
      throw new Error('broker caiu');
    });

    await expect(disparar(d)).rejects.toThrow('broker caiu');

    // O commit aconteceu: a conversa existe e foi anunciada (origem campaign).
    const [conversa] = await conversasDo(telefone);
    expect(conversa).toBeDefined();
    expect(publicados.slice(antes).map((p) => p.draft.data)).toEqual([
      { conversationId: conversa!.id, contactId: d.contactId, channelId, trigger: 'campaign' },
    ]);
    // Compensado: nenhuma mensagem fantasma, delivery liberada, recipient no passo
    // anterior com backoff de falha.
    expect(await mensagensDa(conversa!.id)).toHaveLength(0);
    expect(await deliveriesDe(d.recipientId)).toHaveLength(0);
    const recipient = await recipientDe(d.recipientId);
    expect(recipient).toMatchObject({
      status: 'pending',
      lastStepIndex: -1,
      lastStepAt: null,
      completedAt: null,
      attempts: 1,
    });
    expect(recipient?.nextStepAt?.getTime()).toBeGreaterThan(Date.now());

    // Retentativa (backoff vencido): mesma idempotencyKey, despacha — não é `duplicate`.
    await getDb()
      .update(schema.campaignRecipients)
      .set({ nextStepAt: null })
      .where(eq(schema.campaignRecipients.id, d.recipientId));
    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });
    expect(sendToQueue.mock.calls.length).toBe(jobs + 2);
    expect((await mensagensDa(conversa!.id)).map((m) => m.id)).toEqual([ultimoJob().messageId]);
    expect(await deliveriesDe(d.recipientId)).toHaveLength(1);
    // A conversa já existia: a retentativa não a anuncia de novo.
    expect(publicados.length).toBe(antes + 1);
    expect(await recipientDe(d.recipientId)).toMatchObject({
      status: 'completed',
      lastStepIndex: 0,
    });
  });
});
