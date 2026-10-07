/**
 * F58-S12 — nenhuma mensagem da campanha se perde (Postgres dev, RLS real, trigger 0095).
 *
 * Caminho inteiro, com as peças reais: disparo (`enqueueDelivery`) -> outbox -> relay
 * (publisher fake no lugar do broker) -> worker outbound (portas reais de banco, adapter
 * fake) -> desfecho na delivery/campanha.
 *
 *  - disparo grava delivery, mensagem, avanço do recipient e job juntos, com as variáveis
 *    DAQUELE contato;
 *  - queda no meio do disparo não deixa nada; re-tick não duplica;
 *  - relay que cai depois de publicar (antes de marcar) republica — e o outbound não envia
 *    duas vezes (duplicata lógica zero);
 *  - restart do relay não republica o que já saiu;
 *  - desfecho do outbound (sucesso e falha permanente) chega à delivery sem webhook;
 *  - modelo recusado (no envio ou já no catálogo) pausa a campanha com orientação;
 *  - pausa retém o que não saiu (broker fora), retomar libera, cancelar descarta e marca
 *    `failed`; o que já estava no broker fica quantificado;
 *  - pausa concorrente com disparos: nenhum job publicável de campanha pausada.
 *
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import { createLogger, type Logger } from '@hm/logger';
import type { ConfirmPublisher, Envelope } from '@hm/shared/mq';
import type { CampaignDbDeps } from './db-ports';
import type { DispatchOutcome, RunningCampaign } from './tick';

const FORCED = 'F58-S12: queda simulada antes do COMMIT';
const crash = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (crash.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema, withWorkspace } = await import('@hm/db');
const { envelopeSchema } = await import('@hm/shared/mq');
const { createCampaignTickPorts } = await import('./db-ports');
const { OutboxRelay } = await import('../outbox/relay');
const { handleOutboundEnvelope } = await import('../outbound/worker');
const { DbOutboundPersistence } = await import('../outbound/db-ports');
const { allowAllConsentGate } = await import('../outbound/consent-gate');
const { allowAllSubscriptionGate } = await import('../lib/subscription-gate');

const url = process.env['DATABASE_URL'];
const OUTBOUND = 'hm.q.outbound';

function quietLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

async function waitFor<T>(
  probe: () => Promise<T> | T,
  done: (v: T) => boolean,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (done(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Modelo sincronizado da Meta (formato do catálogo). */
const CATALOG = [
  { type: 'HEADER', format: 'TEXT', text: 'Olá, {{1}}!' },
  { type: 'BODY', text: 'Seu pedido {{1}} saiu.' },
  {
    type: 'BUTTONS',
    buttons: [{ type: 'URL', text: 'Acompanhar', url: 'https://exemplo.com/p/{{1}}' }],
  },
];
/** O que o criador guiado grava no passo. */
const STEP_BINDINGS = [
  {
    type: 'binding_contract',
    version: 1,
    bindings: [
      {
        component: 'header',
        index: 1,
        source: { kind: 'contact', field: 'displayName', fallback: 'cliente' },
      },
      {
        component: 'body',
        index: 1,
        source: { kind: 'customField', key: 'pedido', fallback: 'seu pedido' },
      },
      {
        component: 'button',
        index: 1,
        source: { kind: 'customField', key: 'pedido', fallback: 'x' },
      },
    ],
  },
];

describe.skipIf(!url)(
  'F58-S12 entrega confiável da campanha (Postgres)',
  { timeout: 60_000 },
  () => {
    const sfx = randomUUID().slice(0, 8);
    const channelStub = {
      sendToQueue: vi.fn(() => true),
      publish: vi.fn(() => true),
    } as unknown as CampaignDbDeps['channel'];
    const ports = createCampaignTickPorts({ channel: channelStub, logger: quietLogger() });

    let workspaceId = '';
    let channelId = '';
    let seq = 0;
    const TEMPLATE = `pedido_${sfx}`;

    async function novaCampanha(
      opts: { steps?: number; template?: string } = {},
    ): Promise<{ id: string; stepIds: string[] }> {
      const [camp] = await getDb()
        .insert(schema.campaigns)
        .values({
          workspaceId,
          channelId,
          name: `F58S12 ${(seq += 1)}`,
          type: (opts.steps ?? 1) > 1 ? 'drip' : 'broadcast',
          status: 'running',
          dailyLimit: null,
        })
        .returning({ id: schema.campaigns.id });
      if (!camp) throw new Error('campanha nao criada');
      const stepIds: string[] = [];
      for (let i = 0; i < (opts.steps ?? 1); i++) {
        const [step] = await getDb()
          .insert(schema.campaignSteps)
          .values({
            campaignId: camp.id,
            position: i,
            templateName: opts.template ?? TEMPLATE,
            languageCode: 'pt_BR',
            templateComponents: STEP_BINDINGS,
            delaySeconds: i === 0 ? 0 : 3600,
          })
          .returning({ id: schema.campaignSteps.id });
        if (!step) throw new Error('step nao criado');
        stepIds.push(step.id);
      }
      return { id: camp.id, stepIds };
    }

    async function destinatarios(
      campaignId: string,
      people: ReadonlyArray<{ name: string | null; pedido?: string }>,
    ) {
      const out: Array<{ recipientId: string; contactId: string }> = [];
      for (const p of people) {
        const [c] = await getDb()
          .insert(schema.contacts)
          .values({
            workspaceId,
            displayName: p.name,
            phone: `55119${String((seq += 1)).padStart(4, '0')}${sfx.replace(/\D/g, '7').padEnd(4, '7').slice(0, 4)}`,
            customFields: p.pedido === undefined ? {} : { pedido: p.pedido },
          })
          .returning({ id: schema.contacts.id });
        if (!c) throw new Error('contato nao criado');
        const [r] = await getDb()
          .insert(schema.campaignRecipients)
          .values({ workspaceId, campaignId, contactId: c.id })
          .returning({ id: schema.campaignRecipients.id });
        if (!r) throw new Error('recipient nao criado');
        out.push({ recipientId: r.id, contactId: c.id });
      }
      return out;
    }

    const snapshot = (id: string): RunningCampaign => ({
      id,
      workspaceId,
      channelId,
      sendWindows: null,
      rateLimitPerMinute: 6000,
      deliveryRate: null,
      endAt: null,
      nextTickAt: null,
    });

    const dispatch = (
      campaignId: string,
      stepId: string,
      r: { recipientId: string; contactId: string },
      stepIndex = 0,
    ): Promise<DispatchOutcome> =>
      ports.enqueueDelivery(
        snapshot(campaignId),
        { ...r, stepId, stepIndex },
        `f58s12:${r.recipientId}:${stepId}`,
        new Date(),
        { ratePerMinute: 6000, windowMs: 60_000 },
      );

    /** Jobs de outbound da outbox deste workspace (lidos por outra conexão = commitados). */
    async function jobs() {
      const rows = await getDb()
        .select({
          id: schema.outbox.id,
          kind: schema.outbox.kind,
          status: schema.outbox.status,
          envelope: schema.outbox.envelope,
          // Retido pela pausa (trigger 0095): available_at = infinity.
          held: sql<boolean>`${schema.outbox.availableAt} = 'infinity'::timestamptz`,
        })
        .from(schema.outbox)
        .where(
          and(eq(schema.outbox.workspaceId, workspaceId), eq(schema.outbox.routingKey, OUTBOUND)),
        );
      return rows.map((r) => ({ ...r, envelope: envelopeSchema.parse(r.envelope) }));
    }
    const jobsOf = async (messageIds: readonly string[]) =>
      (await jobs()).filter((j) => messageIds.includes(String(payloadOf(j.envelope)['messageId'])));
    function payloadOf(envelope: Envelope): Record<string, unknown> {
      return envelope.payload as Record<string, unknown>;
    }

    async function deliveriesOf(campaignId: string) {
      return getDb()
        .select()
        .from(schema.campaignDeliveries)
        .where(eq(schema.campaignDeliveries.campaignId, campaignId));
    }
    async function recipient(id: string) {
      const [row] = await getDb()
        .select()
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.id, id));
      return row;
    }
    async function campanha(id: string) {
      const [row] = await getDb()
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id));
      return row;
    }
    async function auditoria(id: string, action: string) {
      return getDb()
        .select({ metadata: schema.auditLogs.metadata, createdAt: schema.auditLogs.createdAt })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.resourceType, 'campaign'),
            eq(schema.auditLogs.resourceId, id),
            eq(schema.auditLogs.action, action),
          ),
        )
        .orderBy(schema.auditLogs.createdAt);
    }

    /** Muda o status como a API faz: transação do tenant (hm_app, RLS). */
    async function setStatus(campaignId: string, status: string): Promise<void> {
      await withWorkspace(workspaceId, (tx) =>
        tx
          .update(schema.campaigns)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.campaigns.id, campaignId)),
      );
    }

    /** "O relay publicou": marca a linha como a F70-S16 marca depois do confirm. */
    async function markPublished(ids: readonly number[]): Promise<void> {
      await getDb()
        .update(schema.outbox)
        .set({ status: 'sent', sentAt: new Date() })
        .where(inArray(schema.outbox.id, [...ids]));
    }

    // ─── outbound com portas reais de banco ─────────────────────────────────────────

    function adapter(
      result: () => SendResult,
    ): IChannelAdapter & { sendTemplate: ReturnType<typeof vi.fn> } {
      const sendTemplate = vi.fn(async () => result());
      const unused = vi.fn(
        async () => ({ ok: false, errorCode: 'unused', errorMessage: 'unused' }) as SendResult,
      );
      return {
        provider: 'meta_whatsapp',
        capabilities: {
          templatesHSM: true,
          storyMentions: false,
          storyReplies: false,
          publicComments: false,
          messageTags: false,
          voicePtt: true,
          sticker: true,
          location: true,
        },
        parseInbound: vi.fn(async () => []),
        sendText: unused,
        sendMedia: unused,
        sendTemplate,
        sendInteractive: unused,
        downloadMedia: vi.fn(async () => Buffer.alloc(0)),
        markAsRead: vi.fn(async () => undefined),
        sendTypingIndicator: vi.fn(async () => undefined),
      } as unknown as IChannelAdapter & { sendTemplate: ReturnType<typeof vi.fn> };
    }

    async function outbound(envelope: Envelope, a: IChannelAdapter): Promise<void> {
      const snap: Channel = {
        id: channelId,
        workspaceId,
        provider: 'meta_whatsapp',
        accessToken: 'tok',
        phoneNumberId: 'pn',
      };
      await handleOutboundEnvelope(envelope, {
        deps: {
          channels: { resolve: async () => ({ channel: snap, adapter: a }) },
          persistence: new DbOutboundPersistence(),
          socket: {
            emitStatusChanged: async () => undefined,
            emitMessageNew: async () => undefined,
          },
        },
        logger: createLogger('error'),
        consentGate: allowAllConsentGate,
        subscriptionGate: allowAllSubscriptionGate,
      });
    }

    // ─── relay com o broker substituído por um publisher fake ───────────────────────

    function fakeBroker(opts: { failFirstAfterPublish?: boolean } = {}) {
      const published: Envelope[] = [];
      let calls = 0;
      const connect = async (): Promise<ConfirmPublisher> => ({
        async publishBatch(items) {
          calls += 1;
          for (const item of items) published.push(item.envelope);
          // Publicou e "caiu" antes de o relay marcar: a transação do lote não commita.
          if (opts.failFirstAfterPublish === true && calls === 1)
            throw new Error('queda depois do publish');
          return new Map(items.map((i) => [i.key, null]));
        },
        isOpen: () => true,
        close: async () => undefined,
      });
      return { published, connect };
    }

    function relayFor(connect: () => Promise<ConfirmPublisher>) {
      return new OutboxRelay({
        logger: quietLogger(),
        connectPublisher: connect,
        workspaceId,
        listen: false,
        cleanup: false,
        pollIntervalMs: 20,
        jitter: false,
        reconnectBackoff: { baseMs: 20, maxMs: 50 },
      });
    }

    beforeAll(async () => {
      const [ws] = await getDb()
        .insert(schema.workspaces)
        .values({ name: 'F58S12', slug: `f58s12-${sfx}`, planId: null })
        .returning();
      if (!ws) throw new Error('workspace nao criado');
      workspaceId = ws.id;
      const [canal] = await getDb()
        .insert(schema.channels)
        .values({
          workspaceId,
          provider: 'meta_whatsapp',
          name: 'WA',
          phoneNumberId: `PN_F58S12_${sfx}`,
          wabaId: `WABA_F58S12_${sfx}`,
        })
        .returning();
      if (!canal) throw new Error('canal nao criado');
      channelId = canal.id;
      await getDb()
        .insert(schema.channelMessageTemplates)
        .values({
          workspaceId,
          channelId,
          externalId: `tpl_${sfx}`,
          name: TEMPLATE,
          language: 'pt_BR',
          category: 'MARKETING',
          status: 'APPROVED',
          components: CATALOG,
        });
    });

    afterAll(async () => {
      crash.armed = false;
      if (workspaceId !== '') {
        await getDb().delete(schema.outbox).where(eq(schema.outbox.workspaceId, workspaceId));
        await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      }
      await closeDb();
    });

    it('disparo grava delivery, mensagem, avanço e job JUNTOS, com as variáveis de cada contato', async () => {
      const camp = await novaCampanha();
      const [ana, bruno, semDados] = await destinatarios(camp.id, [
        { name: 'Ana', pedido: 'A-1' },
        { name: 'Bruno', pedido: 'B-2' },
        { name: null },
      ]);
      if (!ana || !bruno || !semDados) throw new Error('fixtures');
      const stepId = camp.stepIds[0] ?? '';
      for (const r of [ana, bruno, semDados])
        expect((await dispatch(camp.id, stepId, r)).kind).toBe('enqueued');

      const deliveries = await deliveriesOf(camp.id);
      expect(deliveries).toHaveLength(3);
      expect(deliveries.every((d) => d.status === 'queued' && d.messageId !== null)).toBe(true);
      const js = await jobsOf(deliveries.map((d) => d.messageId ?? ''));
      expect(js).toHaveLength(3);
      expect(js.every((j) => j.status === 'pending' && j.kind === 'job')).toBe(true);
      expect((await recipient(ana.recipientId))?.status).toBe('completed');

      const byChat = new Map(
        js.map((j) => [String(payloadOf(j.envelope)['messageId']), payloadOf(j.envelope)]),
      );
      const compsOf = (recipientId: string) => {
        const d = deliveries.find((x) => x.recipientId === recipientId);
        return JSON.stringify(byChat.get(d?.messageId ?? '')?.['components']);
      };
      expect(compsOf(ana.recipientId)).toContain('"Ana"');
      expect(compsOf(ana.recipientId)).toContain('"A-1"');
      expect(compsOf(ana.recipientId)).not.toContain('Bruno');
      expect(compsOf(bruno.recipientId)).toContain('"B-2"');
      expect(compsOf(bruno.recipientId)).not.toContain('A-1');
      // Fallback obrigatório: contato sem dados recebe o texto padrão, nunca buraco.
      expect(compsOf(semDados.recipientId)).toContain('"cliente"');
      expect(compsOf(semDados.recipientId)).toContain('"seu pedido"');
      // O botão chega ao job com sub_type/index.
      const anaJob = byChat.get(
        deliveries.find((x) => x.recipientId === ana.recipientId)?.messageId ?? '',
      );
      expect(anaJob?.['components']).toContainEqual({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'A-1' }],
      });
    });

    it('queda antes do COMMIT não deixa nada; re-tick e reenvio do mesmo passo não duplicam', async () => {
      const camp = await novaCampanha();
      const [r] = await destinatarios(camp.id, [{ name: 'Caio', pedido: 'C-3' }]);
      if (!r) throw new Error('fixtures');
      const stepId = camp.stepIds[0] ?? '';

      crash.armed = true;
      await expect(dispatch(camp.id, stepId, r)).rejects.toThrow(FORCED);
      crash.armed = false;
      expect(await deliveriesOf(camp.id)).toHaveLength(0);
      expect(await recipient(r.recipientId)).toMatchObject({ status: 'pending', attempts: 0 });
      expect((await campanha(camp.id))?.messagesSentToday).toBe(0);

      expect((await dispatch(camp.id, stepId, r)).kind).toBe('enqueued');
      // Re-tick com o recipient já avançado: o claim não pega nada.
      expect((await dispatch(camp.id, stepId, r)).kind).toBe('skipped');
      // Recipient devolvido a `pending` (reaper/estado estranho): a UNIQUE da delivery decide.
      await getDb()
        .update(schema.campaignRecipients)
        .set({ status: 'pending', nextStepAt: null })
        .where(eq(schema.campaignRecipients.id, r.recipientId));
      expect((await dispatch(camp.id, stepId, r)).kind).toBe('duplicate');

      const deliveries = await deliveriesOf(camp.id);
      expect(deliveries).toHaveLength(1);
      expect(await jobsOf([deliveries[0]?.messageId ?? ''])).toHaveLength(1);
    });

    it('relay cai depois de publicar: republica, e o outbound NÃO envia duas vezes; restart não republica', async () => {
      const camp = await novaCampanha();
      const [r] = await destinatarios(camp.id, [{ name: 'Duda', pedido: 'D-4' }]);
      if (!r) throw new Error('fixtures');
      expect((await dispatch(camp.id, camp.stepIds[0] ?? '', r)).kind).toBe('enqueued');
      const [delivery] = await deliveriesOf(camp.id);
      const messageId = delivery?.messageId ?? '';

      const broker = fakeBroker({ failFirstAfterPublish: true });
      const relay = relayFor(broker.connect);
      await relay.start();
      const sent = await waitFor(
        () => jobsOf([messageId]),
        (rows) => rows[0]?.status === 'sent',
      );
      await relay.stop();
      expect(sent[0]?.status).toBe('sent');
      const copies = broker.published.filter((e) => payloadOf(e)['messageId'] === messageId);
      expect(copies).toHaveLength(2); // at-least-once no transporte

      // O worker outbound recebe as duas cópias: o provider vê UMA.
      const wamid = `wamid.f58s12.${randomUUID()}`;
      const a = adapter(() => ({ ok: true, externalId: wamid }));
      for (const copy of copies) await outbound(copy, a);
      expect(a.sendTemplate).toHaveBeenCalledTimes(1);

      // Desfecho direto na delivery, sem webhook.
      const [after] = await deliveriesOf(camp.id);
      expect(after).toMatchObject({ status: 'sent', externalId: wamid });
      expect(after?.sentAt).not.toBeNull();

      // Restart do relay: nada a republicar.
      const broker2 = fakeBroker();
      const relay2 = relayFor(broker2.connect);
      await relay2.start();
      await new Promise((res) => setTimeout(res, 200));
      await relay2.stop();
      expect(broker2.published.filter((e) => payloadOf(e)['messageId'] === messageId)).toHaveLength(
        0,
      );
    });

    it('falha permanente do outbound: delivery failed com o código, recipient sai da sequência', async () => {
      const camp = await novaCampanha({ steps: 2 });
      const [r] = await destinatarios(camp.id, [{ name: 'Eva', pedido: 'E-5' }]);
      if (!r) throw new Error('fixtures');
      expect((await dispatch(camp.id, camp.stepIds[0] ?? '', r)).kind).toBe('enqueued');
      expect((await recipient(r.recipientId))?.status).toBe('pending'); // tem passo 2
      const [delivery] = await deliveriesOf(camp.id);
      const [job] = await jobsOf([delivery?.messageId ?? '']);
      if (!job) throw new Error('job');
      await markPublished([job.id]);

      const a = adapter(() => ({
        ok: false,
        errorCode: 'WA_131026',
        errorMessage: 'Fora da janela',
      }));
      await outbound(job.envelope, a);

      const [after] = await deliveriesOf(camp.id);
      expect(after).toMatchObject({
        status: 'failed',
        errorCode: 'WA_131026',
        errorMessage: 'Fora da janela',
      });
      expect(after?.failedAt).not.toBeNull();
      expect(await recipient(r.recipientId)).toMatchObject({
        status: 'failed',
        failedReason: 'delivery_WA_131026',
        nextStepAt: null,
      });
      expect((await campanha(camp.id))?.status).toBe('running'); // falha do contato não pausa
    });

    it('Meta recusa o MODELO no envio: campanha pausa com orientação e o que não saiu fica retido', async () => {
      const camp = await novaCampanha();
      const rs = await destinatarios(camp.id, [
        { name: 'F1', pedido: '1' },
        { name: 'F2', pedido: '2' },
        { name: 'F3', pedido: '3' },
      ]);
      for (const r of rs)
        expect((await dispatch(camp.id, camp.stepIds[0] ?? '', r)).kind).toBe('enqueued');
      const deliveries = await deliveriesOf(camp.id);
      const all = await jobsOf(deliveries.map((d) => d.messageId ?? ''));
      const first = all[0];
      if (!first) throw new Error('job');
      await markPublished([first.id]); // só o primeiro chegou ao broker; os outros: broker fora

      const a = adapter(() => ({
        ok: false,
        errorCode: 'WA_132015',
        errorMessage: 'Template paused',
      }));
      await outbound(first.envelope, a);

      const firstMsg = String(payloadOf(first.envelope)['messageId']);
      const failed = (await deliveriesOf(camp.id)).find((d) => d.messageId === firstMsg);
      expect(failed).toMatchObject({ status: 'failed', errorCode: 'WA_132015' });
      expect((await campanha(camp.id))?.status).toBe('paused');
      const paused = await auditoria(camp.id, 'campaign.paused');
      expect(paused.at(-1)?.metadata).toMatchObject({
        reason: 'template_paused',
        errorCode: 'WA_132015',
      });
      expect(String(paused.at(-1)?.metadata['message'])).toContain('pausou este modelo');

      const rest = (await jobsOf(deliveries.map((d) => d.messageId ?? ''))).filter(
        (j) => j.id !== first.id,
      );
      expect(rest).toHaveLength(2);
      expect(rest.every((j) => j.status === 'pending' && j.held)).toBe(true);
      expect((await auditoria(camp.id, 'campaign.outbox_gated')).at(-1)?.metadata).toMatchObject({
        transition: 'running->paused',
        held: 2,
        inFlight: 0,
      });

      // Broker volta: o relay não leva nada de campanha pausada.
      const broker = fakeBroker();
      const relay = relayFor(broker.connect);
      await relay.start();
      await new Promise((res) => setTimeout(res, 200));
      expect(broker.published.filter((e) => rest.some((j) => j.envelope.id === e.id))).toHaveLength(
        0,
      );

      // Retomar libera os retidos, e eles saem.
      await setStatus(camp.id, 'running');
      const out = await waitFor(
        () => broker.published.filter((e) => rest.some((j) => j.envelope.id === e.id)),
        (v) => v.length === 2,
      );
      await relay.stop();
      expect(out).toHaveLength(2);
      expect((await auditoria(camp.id, 'campaign.outbox_gated')).at(-1)?.metadata).toMatchObject({
        transition: 'paused->running',
        released: 2,
      });
    });

    it('catálogo diz que o modelo está pausado: nenhum job sai e a campanha pausa com orientação', async () => {
      const tpl = `pausado_${sfx}`;
      await getDb()
        .insert(schema.channelMessageTemplates)
        .values({
          workspaceId,
          channelId,
          externalId: `tplp_${sfx}`,
          name: tpl,
          language: 'pt_BR',
          category: 'MARKETING',
          status: 'PAUSED',
          components: CATALOG,
        });
      const camp = await novaCampanha({ template: tpl });
      const [r] = await destinatarios(camp.id, [{ name: 'Gil', pedido: 'G' }]);
      if (!r) throw new Error('fixtures');

      expect(await dispatch(camp.id, camp.stepIds[0] ?? '', r)).toEqual({
        kind: 'gate_closed',
        reason: 'not_running',
        retryAt: null,
      });
      expect(await deliveriesOf(camp.id)).toHaveLength(0);
      expect(await recipient(r.recipientId)).toMatchObject({ status: 'pending', attempts: 0 });
      expect((await campanha(camp.id))?.status).toBe('paused');
      expect((await auditoria(camp.id, 'campaign.paused')).at(-1)?.metadata).toMatchObject({
        reason: 'template_paused',
        templateName: tpl,
      });
    });

    it('pausa com broker fora retém; cancelar descarta e marca failed; o que já estava no broker é quantificado', async () => {
      const camp = await novaCampanha();
      const rs = await destinatarios(camp.id, [
        { name: 'H1', pedido: '1' },
        { name: 'H2', pedido: '2' },
        { name: 'H3', pedido: '3' },
      ]);
      for (const r of rs)
        expect((await dispatch(camp.id, camp.stepIds[0] ?? '', r)).kind).toBe('enqueued');
      const deliveries = await deliveriesOf(camp.id);
      const all = await jobsOf(deliveries.map((d) => d.messageId ?? ''));
      const inBroker = all[0];
      if (!inBroker) throw new Error('job');
      await markPublished([inBroker.id]);

      await setStatus(camp.id, 'paused');
      expect((await auditoria(camp.id, 'campaign.outbox_gated')).at(-1)?.metadata).toMatchObject({
        transition: 'running->paused',
        held: 2,
        inFlight: 1,
      });

      await setStatus(camp.id, 'cancelled');
      expect((await auditoria(camp.id, 'campaign.outbox_gated')).at(-1)?.metadata).toMatchObject({
        transition: 'paused->cancelled',
        dropped: 2,
        inFlight: 1,
      });
      const left = await jobsOf(deliveries.map((d) => d.messageId ?? ''));
      expect(left.map((j) => j.id)).toEqual([inBroker.id]); // os não publicados sumiram

      const inBrokerMsg = String(payloadOf(inBroker.envelope)['messageId']);
      const after = await deliveriesOf(camp.id);
      const dropped = after.filter((d) => d.messageId !== inBrokerMsg);
      expect(
        dropped.every((d) => d.status === 'failed' && d.errorCode === 'campaign_cancelled'),
      ).toBe(true);
      expect(after.find((d) => d.messageId === inBrokerMsg)?.status).toBe('queued');
      const msgs = await getDb()
        .select({
          id: schema.messages.id,
          viewStatus: schema.messages.viewStatus,
          failedReason: schema.messages.failedReason,
        })
        .from(schema.messages)
        .where(
          inArray(
            schema.messages.id,
            dropped.map((d) => d.messageId ?? ''),
          ),
        );
      expect(msgs).toHaveLength(2);
      expect(
        msgs.every((m) => m.viewStatus === 'failed' && m.failedReason === 'campaign_cancelled'),
      ).toBe(true);
    });

    it('pausa concorrente com disparos: nenhum job publicável de campanha pausada', async () => {
      const camp = await novaCampanha();
      const people = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, pedido: String(i) }));
      const rs = await destinatarios(camp.id, people);
      const stepId = camp.stepIds[0] ?? '';

      // Os 12 disparam juntos; a pausa entra quando o PRIMEIRO commitou — os demais
      // disputam o lock da campanha com ela: uns commitam antes (e são retidos), os
      // outros encontram a campanha pausada (gate_closed, nada gravado).
      const inFlight = rs.map((r) => dispatch(camp.id, stepId, r));
      const firstDone = Promise.race(inFlight);
      const pausing = firstDone.then(() => setStatus(camp.id, 'paused'));
      const [outcomes] = await Promise.all([Promise.all(inFlight), pausing]);
      const enqueued = outcomes.filter((o) => o.kind === 'enqueued').length;
      const closed = outcomes.filter((o) => o.kind === 'gate_closed');
      expect(enqueued + closed.length).toBe(rs.length);
      expect(enqueued).toBeGreaterThanOrEqual(1);
      expect(closed.every((o) => o.kind === 'gate_closed' && o.reason === 'not_running')).toBe(
        true,
      );

      expect((await campanha(camp.id))?.status).toBe('paused');
      const deliveries = await deliveriesOf(camp.id);
      expect(deliveries).toHaveLength(enqueued);
      const js = await jobsOf(deliveries.map((d) => d.messageId ?? ''));
      expect(js).toHaveLength(enqueued);
      // Tudo o que commitou antes da pausa está retido; nada depois dela foi gravado.
      expect(js.filter((j) => !j.held)).toHaveLength(0);
    });
  },
);
