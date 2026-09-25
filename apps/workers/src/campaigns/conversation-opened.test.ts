/**
 * F70-S13 — disparo de campanha que ABRE a conversa anuncia `conversation.opened`
 * contra o Postgres dev (RLS real).
 *
 * F70-S14: origem `campaign`; a conversa é anunciada antes do job da mensagem dela.
 *
 * F70-S16: o anúncio e o job de outbound são linhas da OUTBOX gravadas NA transação
 * do disparo — o disparo não publica nada no RabbitMQ (o relay publica depois do
 * commit, com confirms). Protege:
 *  - commit → `conversation.opened` e depois o job, na ordem; o job aponta para a
 *    mensagem que a mesma transação gravou (visível por outra conexão);
 *  - conversa já existente → só o job;
 *  - rollback → nada na outbox, nada gravado (nenhum job fantasma);
 *  - não existe mais delivery `queued` sem job: toda delivery tem o seu job na outbox,
 *    e a retentativa com a mesma idempotencyKey não grava um segundo.
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
import { QUEUES } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { eventOf, outboxRowsOf } from '../outbox/testing';
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

describe.skipIf(!url)('F70-S13/S16 campanha: conversa aberta e job pela outbox', () => {
  const sfx = randomUUID().slice(0, 8);
  let workspaceId = '';
  let channelId = '';
  let campaignId = '';
  let stepId = '';

  // O disparo não pode mais publicar direto: qualquer chamada ao canal é defeito.
  const sendToQueue = vi.fn((): boolean => true);
  const publish = vi.fn((): boolean => true);
  const channel = { sendToQueue, publish } as unknown as CampaignDbDeps['channel'];
  const ports = createCampaignTickPorts({ channel, logger: makeLogger() });

  const recipientDe = async (recipientId: string) => {
    const [r] = await getDb()
      .select()
      .from(schema.campaignRecipients)
      .where(eq(schema.campaignRecipients.id, recipientId));
    return r;
  };
  const deliveriesDe = (recipientId: string) =>
    getDb()
      .select({ id: schema.campaignDeliveries.id, messageId: schema.campaignDeliveries.messageId })
      .from(schema.campaignDeliveries)
      .where(eq(schema.campaignDeliveries.recipientId, recipientId));
  const mensagensDa = (conversationId: string) =>
    getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId));

  /** Linhas novas da outbox do workspace, desde `antes`. */
  const novasLinhas = async (antes: number) => (await outboxRowsOf(workspaceId)).slice(antes);
  const jobsDe = async (messageId: string) =>
    (await outboxRowsOf(workspaceId)).filter(
      (r) => r.kind === 'job' && jobSchema.parse(r.envelope.payload).messageId === messageId,
    );

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

  const telefone = (n: string) => `551190${sfx.replace(/\D/g, n).padEnd(5, n).slice(0, 5)}${n}`;

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
    // A outbox do workspace cai junto (FK em cascata).
    await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await closeDb();
  });

  it('conversa criada pelo disparo → conversation.opened e depois o job, na mesma transação', async () => {
    const tel = telefone('1');
    const d = await destinatario(tel);
    const antes = (await outboxRowsOf(workspaceId)).length;

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });

    const [conversa] = await conversasDo(tel);
    expect(conversa).toBeDefined();
    const novas = await novasLinhas(antes);
    expect(novas.map((r) => r.kind)).toEqual(['event', 'job']);

    const [evento, job] = novas;
    expect(evento).toMatchObject({
      exchange: 'hm.events',
      routingKey: 'domain.conversation.opened',
      eventId: `${conversa!.id}:opened`,
      status: 'pending',
    });
    expect(eventOf(evento!)).toMatchObject({
      event: 'conversation.opened',
      workspaceId,
      eventId: `${conversa!.id}:opened`,
      data: {
        conversationId: conversa!.id,
        contactId: d.contactId,
        channelId,
        trigger: 'campaign',
      },
    });

    // O job vai direto à fila de outbound; o eventId é o id do envelope.
    expect(job).toMatchObject({ exchange: '', routingKey: QUEUES.outbound, status: 'pending' });
    expect(job!.eventId).toBe(job!.envelope.id);
    expect(job!.envelope.type).toBe('outbound.request');
    const payload = jobSchema.parse(job!.envelope.payload);
    expect(payload.conversationId).toBe(conversa!.id);
    // A mensagem para onde o job aponta foi gravada pela MESMA transação (e está
    // commitada: esta leitura é de outra conexão).
    expect((await mensagensDa(conversa!.id)).map((m) => m.id)).toEqual([payload.messageId]);
    const [delivery] = await deliveriesDe(d.recipientId);
    expect(delivery?.messageId).toBe(payload.messageId);

    // Nada publicado direto no broker: só o relay publica.
    expect(sendToQueue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('conversa já existente (o contato escreveu antes) → só o job', async () => {
    const tel = telefone('2');
    const d = await destinatario(tel);
    await getDb()
      .insert(schema.conversations)
      .values({ workspaceId, channelId, contactId: d.contactId, remoteId: tel });
    const antes = (await outboxRowsOf(workspaceId)).length;

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });

    expect((await novasLinhas(antes)).map((r) => r.kind)).toEqual(['job']);
    expect(await conversasDo(tel)).toHaveLength(1);
  });

  it('rollback do disparo → nada na outbox (nem job, nem evento), nada gravado', async () => {
    const tel = telefone('3');
    const d = await destinatario(tel);
    const antes = (await outboxRowsOf(workspaceId)).length;
    drip.falhar = true;

    await expect(disparar(d)).rejects.toThrow('falha simulada no drip');

    expect(await novasLinhas(antes)).toHaveLength(0);
    expect(await conversasDo(tel)).toHaveLength(0);
    expect(await deliveriesDe(d.recipientId)).toHaveLength(0);
    const recipient = await recipientDe(d.recipientId);
    expect(recipient?.status).toBe('pending');
    expect(recipient?.attempts).toBe(0);
    expect(sendToQueue).not.toHaveBeenCalled();
  });

  it('delivery nunca fica sem job: cada uma tem o seu na outbox; retentativa não duplica', async () => {
    const tel = telefone('4');
    const d = await destinatario(tel);

    await expect(disparar(d)).resolves.toEqual({ kind: 'enqueued' });
    const [delivery] = await deliveriesDe(d.recipientId);
    expect(delivery?.messageId).toBeTruthy();
    // "Processo caiu depois do commit": o job está durável na outbox, esperando o relay.
    const jobs = await jobsDe(delivery!.messageId!);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('pending');

    // Retentativa do mesmo passo (recipient de volta a devido): a idempotencyKey já
    // existe → `duplicate`, sem mensagem nem job novos.
    await getDb()
      .update(schema.campaignRecipients)
      .set({ status: 'pending', nextStepAt: null })
      .where(eq(schema.campaignRecipients.id, d.recipientId));
    await expect(disparar(d)).resolves.toEqual({ kind: 'duplicate' });
    expect(await deliveriesDe(d.recipientId)).toHaveLength(1);
    expect(await jobsDe(delivery!.messageId!)).toHaveLength(1);
    // Em toda a campanha: um job por delivery, nem mais nem menos.
    const todasDeliveries = await getDb()
      .select({ id: schema.campaignDeliveries.id })
      .from(schema.campaignDeliveries)
      .where(eq(schema.campaignDeliveries.campaignId, campaignId));
    const todosJobs = (await outboxRowsOf(workspaceId)).filter((r) => r.kind === 'job');
    expect(todosJobs).toHaveLength(todasDeliveries.length);
  });
});
