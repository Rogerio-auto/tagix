/**
 * F70-S34 — respostas rápidas da cadência, ponta a ponta contra o Postgres dev (RLS real):
 * parser real do WhatsApp → pipeline inbound real (`DbInboundPersistence`) → engine de
 * flows real (port de banco + ponto de envio real do worker) → outbox.
 *
 *  1. "Agora não" (clique): o lembrete que JÁ estava agendado e vencido não sai — a
 *     execução é cancelada no ponto de envio, nenhum job de envio entra na outbox; uma
 *     cadência nova disparada pela própria recusa também não fala; a recusa não gera
 *     turno do agente. Idempotente. Quando o contato volta a escrever, o flow fala de novo.
 *  2. "Quero seguir" / "Quero retomar" / "Quero a prévia": com origem comprovada a IA
 *     reabre (e o turno entra na outbox); sem origem não reabre (a conversa volta para a
 *     fila do humano); IA pausada por humano fica pausada; trava do workspace desligada
 *     (F70-S30) deixa reabrir; texto digitado só conta em resposta a um modelo.
 *  3. "SAIR": supressão registrada (F59) e o portão de envio recusa modelo de Marketing.
 *
 * Pula sem `DATABASE_URL`. O vitest dos workers não carrega o `.env`: rode com
 * `node --env-file=.env …`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import { parseInstagramWebhook, parseWahaWebhook, parseWhatsAppWebhook } from '@hm/channels';
import { createFlowEngine, createOutboundPort } from '@hm/flow-engine';
import { AGENT_RUN_REQUESTED_TYPE } from '@hm/shared/mq';
import type { IStorageDriver, SignedUrl } from '@hm/storage';
import { runInboundPipeline } from './pipeline';
import { ChannelInboundParser } from './parse';
import { DbInboundChannelResolver, DbInboundPersistence, type InboundSocketPort } from './db-ports';
import { createRevocationStep } from './revocation';
import type { StatusDeps } from './status';
import type { InboundDeps } from './ports';
import { createDbOutboundPersistence, createOutboundPublisher } from '../flows/outbound-publisher';
import { createConsentGate } from '../outbound/consent-gate';
import { outboxRowsOf } from '../outbox/testing';

const url = process.env['DATABASE_URL'];

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};
const noopStatusDeps: StatusDeps = {
  channels: {
    async resolve() {
      return null;
    },
  },
  persistence: {
    async applyStatus() {
      return { outcome: 'not_found' as const };
    },
  },
  socket: { async emitStatusChanged() {} },
  orphan: {
    async record() {},
    async drain() {
      return null;
    },
  },
};

class FakeStorage implements IStorageDriver {
  async put(): Promise<void> {}
  async getSignedUrl(key: string): Promise<SignedUrl> {
    return { url: `https://cdn.test/${key}`, expiresAt: new Date(Date.now() + 3_600_000) };
  }
  async delete(): Promise<void> {}
}

/** Cadência mínima com a mesma forma da Arcada: espera → modelo → espera → modelo. */
const CADENCE_NODES = [
  { id: 'trigger', type: 'trigger', data: { triggerType: 'new_message', triggerConfig: {} } },
  { id: 'wait_d3', type: 'wait_for_response', data: { timeoutMinutes: 60 } },
  {
    id: 'template_d3',
    type: 'template',
    data: { templateName: 'arcada_lembrete_dia_3', languageCode: 'pt_BR' },
  },
  { id: 'wait_d7', type: 'wait_for_response', data: { timeoutMinutes: 60 } },
  {
    id: 'template_d7',
    type: 'template',
    data: { templateName: 'arcada_lembrete_dia_7', languageCode: 'pt_BR' },
  },
];
const CADENCE_EDGES = [
  { id: 'e1', source: 'trigger', target: 'wait_d3' },
  { id: 'e2', source: 'wait_d3', target: 'template_d3', sourceHandle: 'timeout' },
  { id: 'e3', source: 'template_d3', target: 'wait_d7' },
  { id: 'e4', source: 'wait_d7', target: 'template_d7', sourceHandle: 'timeout' },
];

describe.skipIf(!url)('F70-S34 respostas rápidas da cadência (DB)', () => {
  const logger: Logger = createLogger('error');
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
  const digits = sfx.replace(/\D/g, '7').padEnd(8, '7').slice(0, 8);
  const phoneNumberId = 'PN_F70S34_' + sfx;
  let workspaceId = '';
  let channelId = '';
  let agentId = '';
  let flowId = '';
  let phoneSeq = 0;

  const deps: InboundDeps = {
    parser: new ChannelInboundParser(
      {
        metaWhatsApp: parseWhatsAppWebhook,
        waha: parseWahaWebhook,
        metaInstagram: parseInstagramWebhook,
      },
      logger,
    ),
    persistence: new DbInboundPersistence(noopSocket, noopStatusDeps, logger),
    revocation: createRevocationStep(new DbInboundChannelResolver()),
  };

  const engine = createFlowEngine({
    outbound: createOutboundPort(
      createOutboundPublisher({
        logger,
        storage: new FakeStorage(),
        persistence: createDbOutboundPersistence(),
        publishPresenceJob: async () => true,
        emitMessageNew: async () => {},
      }),
    ),
  });

  // ─── helpers ────────────────────────────────────────────────────────────────

  function waMessage(from: string, message: Record<string, unknown>): Record<string, unknown> {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_' + sfx,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511900000000', phone_number_id: phoneNumberId },
                contacts: [{ profile: { name: 'Lead' }, wa_id: from }],
                messages: [
                  {
                    from,
                    id: `wamid.${randomUUID()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...message,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  /** Clique numa resposta rápida de modelo (payload = texto, como a Meta manda). */
  const click = (from: string, text: string) =>
    runInboundPipeline(
      'meta_whatsapp',
      waMessage(from, {
        context: { from: '5511900000000', id: 'wamid.TEMPLATE' },
        type: 'button',
        button: { payload: text, text },
      }),
      deps,
      logger,
    );

  const says = (from: string, body: string) =>
    runInboundPipeline(
      'meta_whatsapp',
      waMessage(from, { type: 'text', text: { body } }),
      deps,
      logger,
    );

  interface ConvSetup {
    readonly origin: 'origem:anuncio' | 'sem-origem';
    readonly aiMode: 'on' | 'off' | 'paused';
    readonly status?: string;
    readonly withAgent?: boolean;
  }

  /** Contato + conversa já existentes (a cadência só fala com quem já conversou). */
  async function conversation(
    setup: ConvSetup,
  ): Promise<{ from: string; id: string; contactId: string }> {
    phoneSeq += 1;
    const from = '5511' + digits.slice(0, 6) + String(phoneSeq).padStart(3, '0');
    const [contact] = await getDb()
      .insert(schema.contacts)
      .values({ workspaceId, phone: from, source: 'whatsapp' })
      .returning({ id: schema.contacts.id });
    if (!contact) throw new Error('contato não criado');
    const [conv] = await getDb()
      .insert(schema.conversations)
      .values({
        workspaceId,
        channelId,
        contactId: contact.id,
        remoteId: from,
        status: setup.status ?? 'open',
        aiMode: setup.aiMode,
        origin: setup.origin,
        ...(setup.withAgent === false ? {} : { agentId }),
      })
      .returning({ id: schema.conversations.id });
    if (!conv) throw new Error('conversa não criada');
    return { from, id: conv.id, contactId: contact.id };
  }

  async function sentTemplate(conversationId: string, name: string): Promise<void> {
    await getDb()
      .insert(schema.messages)
      .values({
        workspaceId,
        conversationId,
        direction: 'outbound',
        senderType: 'system',
        type: 'template',
        content: name,
        createdAt: new Date(Date.now() - 60_000),
      });
  }

  async function conv(id: string) {
    const [row] = await getDb()
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id));
    if (!row) throw new Error('conversa sumiu');
    return row;
  }

  async function jobsFor(conversationId: string, type: string) {
    return (await outboxRowsOf(workspaceId)).filter(
      (r) =>
        r.envelope.type === type &&
        (r.envelope.payload as Record<string, unknown>)['conversationId'] === conversationId,
    );
  }

  const agentRuns = (conversationId: string) => jobsFor(conversationId, AGENT_RUN_REQUESTED_TYPE);
  const outboundJobs = (conversationId: string) => jobsFor(conversationId, 'outbound.job');

  async function execution(executionId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.flowExecutions)
      .where(eq(schema.flowExecutions.id, executionId));
    if (!row) throw new Error('execução sumiu');
    return row;
  }

  /** Vence a espera: o scheduler acordaria a execução agora. */
  async function makeDue(executionId: string): Promise<void> {
    await getDb()
      .update(schema.flowExecutions)
      .set({ nextStepAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.flowExecutions.id, executionId));
  }

  const step = (executionId: string) => engine.processFlowStepScoped(workspaceId, executionId);

  /** Dispara a cadência e a leva até a 1ª espera (`waiting`). */
  async function startCadence(conversationId: string, contactId: string): Promise<string> {
    const { executionId } = await engine.triggerFlow({
      workspaceId,
      flowId,
      conversationId,
      contactId,
      triggeredBy: 'automatic',
    });
    await step(executionId); // trigger → wait_d3
    await step(executionId); // wait_d3 → waiting
    expect((await execution(executionId)).status).toBe('waiting');
    return executionId;
  }

  // ─── setup ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F70S34', slug: 'f70s34-' + sfx })
      .returning({ id: schema.workspaces.id });
    if (!ws) throw new Error('workspace não criado');
    workspaceId = ws.id;

    const [ch] = await db
      .insert(schema.channels)
      .values({
        workspaceId,
        provider: 'meta_whatsapp',
        name: 'WA F70S34',
        phoneNumberId,
        wabaId: 'WABA_' + sfx,
        isActive: true,
      })
      .returning({ id: schema.channels.id });
    if (!ch) throw new Error('canal não criado');
    channelId = ch.id;

    const [agent] = await db
      .insert(schema.agents)
      .values({ workspaceId, name: 'Agente F70S34', systemPrompt: 'Teste F70-S34.' })
      .returning({ id: schema.agents.id });
    if (!agent) throw new Error('agente não criado');
    agentId = agent.id;

    const [flow] = await db
      .insert(schema.flows)
      .values({
        workspaceId,
        name: 'Cadência F70S34',
        triggerType: 'new_message',
        status: 'active',
      })
      .returning({ id: schema.flows.id });
    if (!flow) throw new Error('flow não criado');
    flowId = flow.id;
    await db.insert(schema.flowVersions).values({
      flowId,
      version: 1,
      nodes: CADENCE_NODES,
      edges: CADENCE_EDGES,
      triggerConfig: {},
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      const db = getDb();
      await db.delete(schema.messages).where(eq(schema.messages.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  // ─── 1. "Agora não" ───────────────────────────────────────────────────────

  it('"Agora não": o lembrete agendado não sai, a cadência é cancelada e a IA não é chamada', async () => {
    const c = await conversation({ origin: 'origem:anuncio', aiMode: 'on' });
    await sentTemplate(c.id, 'arcada_lembrete_dia_3');

    // Lembrete do 3º dia agendado e JÁ vencido quando a recusa chega (o scheduler está
    // prestes a acordá-lo): o caso em que parar só pela aresta `response` não basta.
    const e1 = await startCadence(c.id, c.contactId);
    await makeDue(e1);

    await click(c.from, 'Agora não');

    // O clique ficou gravado com o significado.
    const [msg] = await getDb()
      .select({ type: schema.messages.type, metadata: schema.messages.metadata })
      .from(schema.messages)
      .where(
        and(eq(schema.messages.conversationId, c.id), eq(schema.messages.direction, 'inbound')),
      );
    expect(msg?.type).toBe('text');
    expect(msg?.metadata).toMatchObject({ quickReply: { source: 'button', intent: 'decline' } });

    // IA ligada, mas a recusa não gera turno do agente.
    expect(await agentRuns(c.id)).toHaveLength(0);

    await step(e1); // timeout → template_d3
    await step(e1); // template_d3 → ponto de envio recusa
    const after = await execution(e1);
    expect(after.status).toBe('cancelled');
    expect(after.lastError).toBe('contact_declined');
    expect(await outboundJobs(c.id)).toHaveLength(0);

    // A execução está encerrada: um passo atrasado é absorvido, nada sai.
    await step(e1);
    expect((await execution(e1)).status).toBe('cancelled');

    // Cadência nova disparada pela própria recusa (o flow real dispara a cada mensagem):
    // quando o relógio dela vence, também não fala.
    const e2 = await startCadence(c.id, c.contactId);
    await makeDue(e2);
    await step(e2);
    await step(e2);
    expect((await execution(e2)).status).toBe('cancelled');
    expect(await outboundJobs(c.id)).toHaveLength(0);

    // Idempotente: clicar de novo mantém tudo parado, sem turno do agente.
    await click(c.from, 'Agora não');
    expect(await agentRuns(c.id)).toHaveLength(0);
    expect((await conv(c.id)).aiMode).toBe('on');

    // O contato volta a escrever: a recusa deixa de valer e o flow fala de novo.
    await says(c.from, 'oi, voltei');
    expect(await agentRuns(c.id)).toHaveLength(1);
    const e3 = await startCadence(c.id, c.contactId);
    await makeDue(e3);
    await step(e3);
    await step(e3);
    expect((await execution(e3)).status).not.toBe('cancelled');
    expect(await outboundJobs(c.id)).toHaveLength(1);
  });

  it('"Agora não": nenhuma automação liga a IA depois da recusa (flow ai_action / campanha)', async () => {
    const c = await conversation({ origin: 'origem:anuncio', aiMode: 'off' });
    await click(c.from, 'Agora não');
    await expect(
      createOutboundPort().setConversationAi(workspaceId, {
        conversationId: c.id,
        aiMode: 'on',
        agentId,
      }),
    ).resolves.toEqual({ applied: false, reason: 'contact_declined' });
    expect((await conv(c.id)).aiMode).toBe('off');
  });

  // ─── 2. "Quero…" ──────────────────────────────────────────────────────────

  it('"Quero seguir" com origem comprovada: IA reabre, conversa volta para open, turno na outbox', async () => {
    const c = await conversation({ origin: 'origem:anuncio', aiMode: 'off', status: 'resolved' });
    await click(c.from, 'Quero seguir');
    const row = await conv(c.id);
    expect(row.aiMode).toBe('on');
    expect(row.status).toBe('open');
    expect(row.agentId).toBe(agentId);
    // O `on` automático é carimbado pelo trigger da F70-S19: nunca vira marca humana.
    expect(row.aiAutoEnabledAt).not.toBeNull();
    expect(await agentRuns(c.id)).toHaveLength(1);
  });

  it('"Quero retomar" sem origem comprovada: IA não reabre, conversa fica para o humano', async () => {
    const c = await conversation({ origin: 'sem-origem', aiMode: 'off', status: 'resolved' });
    await click(c.from, 'Quero retomar');
    const row = await conv(c.id);
    expect(row.aiMode).toBe('off');
    expect(row.status).toBe('open'); // volta para a fila de quem vai atender
    expect(await agentRuns(c.id)).toHaveLength(0);
  });

  it('"Quero a prévia" com IA pausada por humano: continua pausada', async () => {
    const c = await conversation({ origin: 'origem:anuncio', aiMode: 'paused' });
    await click(c.from, 'Quero a prévia');
    expect((await conv(c.id)).aiMode).toBe('paused');
    expect(await agentRuns(c.id)).toHaveLength(0);
  });

  it('"Quero seguir" transferida para humano (pending) ou sem agente: não reabre', async () => {
    const pending = await conversation({
      origin: 'origem:anuncio',
      aiMode: 'off',
      status: 'pending',
    });
    await click(pending.from, 'Quero seguir');
    expect((await conv(pending.id)).aiMode).toBe('off');

    const noAgent = await conversation({
      origin: 'origem:anuncio',
      aiMode: 'off',
      withAgent: false,
    });
    await click(noAgent.from, 'Quero seguir');
    expect((await conv(noAgent.id)).aiMode).toBe('off');
    expect(await agentRuns(noAgent.id)).toHaveLength(0);
  });

  it('trava do workspace desligada (F70-S30): sem origem também reabre — mesma fonte única', async () => {
    await getDb()
      .update(schema.workspaces)
      .set({ aiRequiresProvenOrigin: false })
      .where(eq(schema.workspaces.id, workspaceId));
    try {
      const c = await conversation({ origin: 'sem-origem', aiMode: 'off' });
      await click(c.from, 'Quero seguir');
      expect((await conv(c.id)).aiMode).toBe('on');
      expect(await agentRuns(c.id)).toHaveLength(1);
    } finally {
      await getDb()
        .update(schema.workspaces)
        .set({ aiRequiresProvenOrigin: true })
        .where(eq(schema.workspaces.id, workspaceId));
    }
  });

  it('texto digitado igual ao botão: só conta em resposta a um modelo', async () => {
    const semModelo = await conversation({ origin: 'origem:anuncio', aiMode: 'off' });
    await says(semModelo.from, 'quero seguir');
    expect((await conv(semModelo.id)).aiMode).toBe('off');

    const comModelo = await conversation({ origin: 'origem:anuncio', aiMode: 'off' });
    await sentTemplate(comModelo.id, 'arcada_lembrete_dia_3');
    await says(comModelo.from, 'Quero seguir!');
    expect((await conv(comModelo.id)).aiMode).toBe('on');
  });

  // ─── 3. "SAIR" ────────────────────────────────────────────────────────────

  it('"SAIR": supressão registrada (F59) e modelo de Marketing recusado no portão de envio', async () => {
    const c = await conversation({ origin: 'origem:anuncio', aiMode: 'on' });
    await sentTemplate(c.id, 'arcada_lembrete_dia_7');
    await says(c.from, 'SAIR');

    const suppressions = await getDb()
      .select()
      .from(schema.contactSuppressions)
      .where(eq(schema.contactSuppressions.contactId, c.contactId));
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.reason).toBe('keyword');

    const decision = await createConsentGate().check({
      workspaceId,
      conversationId: c.id,
      provider: 'meta_whatsapp',
      purpose: 'marketing',
    });
    expect(decision).toMatchObject({ allowed: false, reason: 'suppressed' });
  });
});
