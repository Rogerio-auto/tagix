/**
 * F73-S09 — ações externas do Copiloto (nível 4) contra o Postgres de dev, pelo callback REAL
 * (`createCopilotToolsRouter`: grant, turno) e pelo motor de propostas (confirmar, ajustar,
 * desfazer). Nenhuma mensagem real sai: o limite é a outbox.
 *
 * Prova o DoD do slot:
 * - todas as propostas desta área nascem no nível 4;
 * - política por linha (fora da janela; sem consentimento → pulado; conversa fechada há mais de
 *   24 h com texto livre → block; com modelo aprovado → ok) e recalculada no confirmar
 *   (consentimento revogado entre propor e confirmar → item pulado);
 * - a mensagem enviada aparece na outbox com o membro como remetente e `metadata.via='copilot'`;
 * - prévia de `send_messages` com 3 textos renderizados reais e nenhum dado de um destinatário na
 *   mensagem de outro;
 * - campanha: cancelar com "Pausar em vez disso", números, papel; flow: disparo e desfazer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, consentRepo, getDb, schema, withWorkspace } from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  CopilotToolEnvelopeSchema,
  PolicyCheckSchema,
  ProposalPreviewSchema,
  type CopilotToolEnvelope,
  type PolicyCheck,
  type Role,
} from '@hm/shared';
import { seedCopilotTurn, type SeededTurn } from '../../../services/copilot/identity/test-fixtures';
import { resolveCopilotPrincipal } from '../../../services/copilot/identity/principal';
import {
  adjustProposal,
  confirmProposal,
  createExecutorRegistry,
  createProposalEngineDeps,
  drainProposalExecutions,
  executorContext,
  makeProposeTool,
  undoProposal,
  type ProposalEngineDeps,
} from '../../../services/copilot/proposals';
import { COPILOT_EXECUTORS, COPILOT_TOOLS } from '../index';
import { createCopilotToolsRouter } from '../core/router';
import { createCopilotToolRegistry } from '../core/registry';
import {
  CAMPAIGN_STATUS_TOOL_KEY,
  SEND_MESSAGES_TOOL_KEY,
  TRIGGER_FLOW_TOOL_KEY,
  executors,
  makeCampaignStatusTool,
  sendMessagesExecutor,
  tools,
  triggerFlowExecutor,
} from './index';
import { SEND_MESSAGES_TOOL_DESCRIPTION } from './send-messages';
import { TRIGGER_FLOW_TOOL_DESCRIPTION } from './trigger-flow';
import {
  addCampaign,
  addEvent,
  addFlow,
  addRecipient,
  addTemplate,
  campaignStatus,
  outboxPayloadsFor,
  seedExternalWorkspace,
  type ExternalSeed,
} from './test-seed';

const TOKEN = `test-${randomUUID()}`;
const SECRET = randomBytes(32);

let a: ExternalSeed;
let us: ExternalSeed;
let b: ExternalSeed;
let deps: ProposalEngineDeps;
let app: Express;

beforeAll(async () => {
  a = await seedExternalWorkspace({ label: 'S09A' });
  us = await seedExternalWorkspace({ label: 'S09US', market: 'US' });
  b = await seedExternalWorkspace({ label: 'S09B' });
  deps = createProposalEngineDeps({
    executors: createExecutorRegistry(executors),
    emit: async () => undefined,
    notify: async () => undefined,
    progressThrottleMs: 0,
    logger: createLogger('error', { svc: 'test' }),
  });
  // As ferramentas de produção (mesmos executores), com o motor sem MQ.
  const testTools = [
    makeProposeTool(sendMessagesExecutor, {
      key: SEND_MESSAGES_TOOL_KEY,
      description: SEND_MESSAGES_TOOL_DESCRIPTION,
      deps: () => deps,
    }),
    makeCampaignStatusTool({ deps: () => deps }),
    makeProposeTool(triggerFlowExecutor, {
      key: TRIGGER_FLOW_TOOL_KEY,
      description: TRIGGER_FLOW_TOOL_DESCRIPTION,
      deps: () => deps,
    }),
  ];
  app = express();
  app.use(express.json());
  app.use(
    createCopilotToolsRouter({
      tools: testTools,
      token: TOKEN,
      grantSecret: SECRET,
      logger: createLogger('error', { svc: 'test' }),
    }),
  );
});

afterAll(async () => {
  await drainProposalExecutions();
  await a?.cleanup();
  await us?.cleanup();
  await b?.cleanup();
  await closeDb();
});

// ─── helpers ────────────────────────────────────────────────────────────────────

function turnFor(role: Role, s: ExternalSeed = a): Promise<SeededTurn> {
  return seedCopilotTurn({
    workspaceId: s.workspaceId,
    memberId: s.ws.members[role].id,
    secret: SECRET,
  });
}

async function call(
  key: string,
  role: Role,
  args: Record<string, unknown>,
  s: ExternalSeed = a,
): Promise<CopilotToolEnvelope> {
  const turn = await turnFor(role, s);
  const res = await request(app)
    .post(`/internal/copilot/tools/${key}`)
    .set('Authorization', `Bearer ${TOKEN}`)
    .set('X-Copilot-Grant', turn.grant)
    .send({ turn_id: turn.turnId, call_id: `call_${randomUUID().slice(0, 8)}`, args });
  expect(res.status).toBe(200);
  return CopilotToolEnvelopeSchema.parse(res.body);
}

function proposalIdOf(env: CopilotToolEnvelope): string {
  const mv = env.model_view;
  if (typeof mv === 'object' && mv !== null && 'proposal_id' in mv) {
    const id = (mv as { proposal_id: unknown }).proposal_id;
    if (typeof id === 'string') return id;
  }
  throw new Error(`sem proposal_id: ${JSON.stringify(env)}`);
}

const proposalOf = (id: string, s: ExternalSeed = a) =>
  withWorkspace(s.workspaceId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.copilotActionProposals)
      .where(eq(schema.copilotActionProposals.id, id));
    const items = await tx
      .select()
      .from(schema.copilotActionItems)
      .where(eq(schema.copilotActionItems.proposalId, id));
    if (!row) throw new Error('proposta sumiu');
    const policyChecks = row.policyChecks
      ? row.policyChecks.map((c) => PolicyCheckSchema.parse(c))
      : null;
    return {
      row: { ...row, policyChecks },
      items,
      preview: ProposalPreviewSchema.parse(row.preview),
    };
  });

function principalOf(role: Role, s: ExternalSeed = a) {
  return withWorkspace(s.workspaceId, async (tx) => {
    const p = await resolveCopilotPrincipal(tx, {
      workspaceId: s.workspaceId,
      memberId: s.ws.members[role].id,
    });
    if (!p) throw new Error('principal');
    return p;
  });
}

async function confirm(
  id: string,
  role: Role,
  options: { readonly acknowledged?: boolean; readonly s?: ExternalSeed } = {},
) {
  const s = options.s ?? a;
  const principal = await principalOf(role, s);
  const { row } = await proposalOf(id, s);
  const out = await withWorkspace(s.workspaceId, (tx) =>
    confirmProposal(deps, tx, principal, id, {
      version: row.version,
      idempotencyKey: randomUUID(),
      ...(options.acknowledged === false ? {} : { acknowledged: true }),
    }),
  );
  if (out.ok && out.start) await out.start();
  return out;
}

function check(checks: readonly PolicyCheck[] | null | undefined, key: string): PolicyCheck {
  const found = (checks ?? []).find((c) => c.key === key);
  if (!found) throw new Error(`sem linha ${key}: ${JSON.stringify(checks)}`);
  return found;
}

/** Data em São Paulo (UTC-3, sem horário de verão) daqui a `days` dias, em hh:mm. */
function spAt(days: number, hh: number, mm: number): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, hh + 3, mm));
}

/** Fuso IANA fixo onde agora são 3h da manhã (fora da janela legal 8h–21h). */
function zoneAtThreeAm(): string {
  const h = new Date().getUTCHours();
  let n = (((3 - h) % 24) + 24) % 24;
  if (n > 14) n -= 24;
  if (n === 0) return 'Etc/GMT';
  return n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`;
}

const outbound = (conversationId: string) =>
  getDb()
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, 'outbound'),
      ),
    );

// ─── registro ───────────────────────────────────────────────────────────────────

describe('registro de produção', () => {
  it('três ferramentas do motor, cinco executores, todos na composição de produção', () => {
    expect(tools.map((t) => t.key)).toEqual([
      SEND_MESSAGES_TOOL_KEY,
      CAMPAIGN_STATUS_TOOL_KEY,
      TRIGGER_FLOW_TOOL_KEY,
    ]);
    for (const t of tools) {
      expect(t.authorization).toBe('engine');
      expect(t.taintsTurn).toBe(false);
    }
    expect(executors.map((e) => e.capability).sort()).toEqual([
      'campaign.cancel',
      'campaign.pause',
      'campaign.resume',
      'flow.trigger',
      'message.send',
    ]);
    expect(() => createCopilotToolRegistry([...tools])).not.toThrow();
    for (const key of [SEND_MESSAGES_TOOL_KEY, CAMPAIGN_STATUS_TOOL_KEY, TRIGGER_FLOW_TOOL_KEY]) {
      expect(COPILOT_TOOLS.some((t) => t.key === key)).toBe(true);
    }
    const prod = new Set(COPILOT_EXECUTORS.map((e) => e.capability));
    for (const e of executors) expect(prod.has(e.capability)).toBe(true);
  });

  it('args estritos: identidade, campo extra e variável fora da allowlist são invalid_args', async () => {
    const r = await addRecipient(a, { name: 'Args' });
    const bad = [
      {
        contact_ids: [r.contactId],
        content: { kind: 'text', text: 'Oi' },
        workspace_id: b.workspaceId,
      },
      { contact_ids: [r.contactId], content: { kind: 'text', text: 'Seu telefone é {telefone}' } },
      { contact_ids: [r.contactId], content: { kind: 'text', text: 'Olá {{1}}' } },
      { content: { kind: 'text', text: 'Sem destinatários' } },
    ];
    for (const args of bad) {
      const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', args);
      expect(env.decision).toBe('invalid_args');
    }
    const extra = await call(CAMPAIGN_STATUS_TOOL_KEY, 'OWNER', {
      campaign_id: randomUUID(),
      action: 'delete',
    });
    expect(extra.decision).toBe('invalid_args');
  });
});

// ─── mensagens ──────────────────────────────────────────────────────────────────

describe('propose_send_messages', () => {
  it('prévia com 3 textos reais, cada um só com os dados do próprio destinatário; executa pela outbox', async () => {
    const people = [
      { name: 'Juliana Prado', h: 9, m: 0, hour: '09:00' },
      { name: 'Marcos Vieira', h: 10, m: 30, hour: '10:30' },
      { name: 'Beatriz Lopes', h: 14, m: 0, hour: '14:00' },
      { name: 'Gustavo Freitas', h: 15, m: 15, hour: '15:15' },
    ];
    const seeded = [];
    for (const p of people) {
      const r = await addRecipient(a, { name: p.name });
      await addEvent(a, {
        contactId: r.contactId,
        startAt: spAt(1, p.h, p.m),
        title: 'Avaliação de alinhadores',
        conversationId: r.conversationId,
      });
      seeded.push({ ...p, ...r });
    }
    const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      filter: {
        source: 'events',
        from: spAt(1, 0, 0).toISOString(),
        to: spAt(2, 0, 0).toISOString(),
      },
      content: {
        kind: 'text',
        text: 'Olá, {primeiro_nome}! Sua {procedimento} é amanhã às {hora}. Responda 1 para confirmar.',
      },
    });
    expect(env.decision).toBe('proposed');
    expect(env.model_view).toMatchObject({ status: 'awaiting_confirmation', risk_level: 4 });
    const id = proposalIdOf(env);
    const { row, items, preview } = await proposalOf(id);
    expect(row).toMatchObject({ capability: 'message.send', riskLevel: 4, status: 'proposed' });
    expect(items).toHaveLength(4);

    // Resumo (Atividade/CSV) sem nenhum dado de contato.
    for (const p of people) expect(row.summary).not.toContain(p.name.split(' ')[0]!);
    expect(row.summary).toBe('Enviar mensagem a 4 contatos');

    const mp = preview.message_preview;
    expect(mp?.body).toContain('{primeiro_nome}');
    expect(mp?.variables).toEqual(['primeiro_nome', 'procedimento', 'hora']);
    expect(mp?.samples).toHaveLength(3);
    for (const sample of mp?.samples ?? []) {
      const me = people.find((p) => p.name === sample.recipient_label);
      if (!me) throw new Error(`amostra de quem? ${sample.recipient_label}`);
      expect(sample.text).toBe(
        `Olá, ${me.name.split(' ')[0]!}! Sua Avaliação de alinhadores é amanhã às ${me.hour}. Responda 1 para confirmar.`,
      );
      for (const other of people.filter((p) => p !== me)) {
        expect(sample.text).not.toContain(other.name.split(' ')[0]!);
        expect(sample.text).not.toContain(other.hour);
      }
    }
    expect(check(row.policyChecks, 'consent').status).toBe('ok');
    expect(check(row.policyChecks, 'window_24h').status).toBe('ok');
    expect(check(row.policyChecks, 'recipients').detail).toBe('4 de 4 recebem a mensagem.');

    // Sem a caixa "Revisei": 422.
    const noAck = await confirm(id, 'OWNER', { acknowledged: false });
    expect(noAck.ok).toBe(false);
    if (!noAck.ok) expect(noAck.error).toBe('ack_required');

    const out = await confirm(id, 'OWNER');
    expect(out.ok).toBe(true);
    const final = await proposalOf(id);
    expect(final.row.status).toBe('completed');
    expect(final.row.undoDeadline).toBeNull();

    for (const p of seeded) {
      const msgs = await outbound(p.conversationId);
      expect(msgs).toHaveLength(1);
      const msg = msgs[0]!;
      expect(msg).toMatchObject({
        senderType: 'member',
        senderMemberId: a.ws.members.OWNER.id,
        viewStatus: 'pending',
        metadata: { via: 'copilot', proposal_id: id },
      });
      expect(msg.content).toContain(p.name.split(' ')[0]!);
      expect(msg.content).toContain(p.hour);
      const jobs = await outboxPayloadsFor(a.workspaceId, [msg.id]);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        kind: 'text',
        conversationId: p.conversationId,
        messageId: msg.id,
        purpose: 'transactional',
        text: msg.content,
      });
      for (const other of seeded.filter((o) => o !== p)) {
        expect(String(jobs[0]?.['text'])).not.toContain(other.name.split(' ')[0]!);
      }
    }
  });

  it('consentimento revogado entre propor e confirmar: a política é recalculada e o item é pulado', async () => {
    const keep = await addRecipient(a, { name: 'Fica Aqui' });
    const gone = await addRecipient(a, { name: 'Pediu Pare' });
    const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [keep.contactId, gone.contactId],
      content: { kind: 'text', text: 'Olá, {primeiro_nome}! Atualizamos o horário.' },
    });
    const id = proposalIdOf(env);
    expect(check((await proposalOf(id)).row.policyChecks, 'consent').status).toBe('ok');

    // Entre a prévia e o clique, o contato pediu para parar.
    await withWorkspace(a.workspaceId, (tx) =>
      consentRepo.revoke(tx, {
        workspaceId: a.workspaceId,
        contactId: gone.contactId,
        channel: null,
        reason: 'stop_keyword',
      }),
    );
    const out = await confirm(id, 'OWNER');
    expect(out.ok).toBe(true);
    const { row, items } = await proposalOf(id);
    const consent = check(row.policyChecks, 'consent');
    expect(consent.status).toBe('warn');
    expect(consent.detail).toContain('1 de 2 · 1 será pulado');
    expect(row.status).toBe('partially_completed');
    const byContact = new Map(items.map((i) => [i.targetId, i]));
    expect(byContact.get(keep.contactId)?.status).toBe('done');
    expect(byContact.get(gone.contactId)).toMatchObject({
      status: 'skipped_policy',
      errorCode: 'suppressed',
    });
    expect(await outbound(gone.conversationId)).toHaveLength(0);
    expect(await outbound(keep.conversationId)).toHaveLength(1);
  });

  it('conversa fechada há mais de 24 h: texto livre = block (409 no confirmar); modelo aprovado = ok e envia', async () => {
    const closed = await addRecipient(a, { name: 'Ana Fechada', lastInboundMinutesAgo: 26 * 60 });
    await addEvent(a, { contactId: closed.contactId, startAt: spAt(1, 11, 0), title: 'Consulta' });

    const text = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [closed.contactId],
      content: { kind: 'text', text: 'Oi, {primeiro_nome}!' },
    });
    const textId = proposalIdOf(text);
    const tp = await proposalOf(textId);
    expect(check(tp.row.policyChecks, 'window_24h')).toMatchObject({ status: 'block' });
    const refused = await confirm(textId, 'OWNER');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe('policy_blocked');
    expect(await outbound(closed.conversationId)).toHaveLength(0);

    const templateId = await addTemplate(a, {
      name: 'lembrete_consulta',
      body: 'Olá, {{1}}! Lembrando da sua consulta amanhã às {{2}}.',
    });
    const tpl = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [closed.contactId],
      content: {
        kind: 'template',
        template_id: templateId,
        variables: ['{primeiro_nome}', '{hora}'],
      },
    });
    const tplId = proposalIdOf(tpl);
    const pp = await proposalOf(tplId);
    expect(check(pp.row.policyChecks, 'window_24h').status).toBe('ok');
    expect(check(pp.row.policyChecks, 'template_approved')).toMatchObject({ status: 'ok' });
    expect(check(pp.row.policyChecks, 'template_approved').detail).toContain('lembrete_consulta');
    expect(pp.preview.message_preview).toMatchObject({
      template_name: 'lembrete_consulta',
      body: 'Olá, {primeiro_nome}! Lembrando da sua consulta amanhã às {hora}.',
      samples: [
        {
          recipient_label: 'Ana Fechada',
          text: 'Olá, Ana! Lembrando da sua consulta amanhã às 11:00.',
        },
      ],
    });
    expect((await confirm(tplId, 'OWNER')).ok).toBe(true);
    const [msg] = await outbound(closed.conversationId);
    expect(msg).toMatchObject({
      type: 'template',
      content: 'Olá, Ana! Lembrando da sua consulta amanhã às 11:00.',
    });
    const jobs = await outboxPayloadsFor(a.workspaceId, [msg!.id]);
    expect(jobs[0]).toMatchObject({
      kind: 'template',
      templateName: 'lembrete_consulta',
      purpose: 'transactional',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ana' },
            { type: 'text', text: '11:00' },
          ],
        },
      ],
    });

    // Modelo não aprovado: block.
    const pending = await addTemplate(a, {
      name: 'em_analise',
      body: 'Oi {{1}}',
      status: 'PENDING',
    });
    const np = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [closed.contactId],
      content: { kind: 'template', template_id: pending, variables: ['{primeiro_nome}'] },
    });
    expect(
      check((await proposalOf(proposalIdOf(np))).row.policyChecks, 'template_approved').status,
    ).toBe('block');
  });

  it('fora da janela legal (EUA, marketing, 3h no fuso do contato): send_window = block', async () => {
    const tz = zoneAtThreeAm();
    const r = await addRecipient(us, { name: 'Night Owl', timezone: tz });
    await withWorkspace(us.workspaceId, (tx) =>
      consentRepo.grant(tx, {
        workspaceId: us.workspaceId,
        contactId: r.contactId,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
        source: 'test',
        proof: { displayedText: 'Aceito receber ofertas.' },
        market: 'US',
      }),
    );
    const promo = await addTemplate(us, {
      name: 'promo_outubro',
      body: 'Hi {{1}}, 20% off this week!',
      category: 'MARKETING',
    });
    const env = await call(
      SEND_MESSAGES_TOOL_KEY,
      'OWNER',
      {
        contact_ids: [r.contactId],
        content: { kind: 'template', template_id: promo, variables: ['{primeiro_nome}'] },
      },
      us,
    );
    const { row } = await proposalOf(proposalIdOf(env), us);
    expect(check(row.policyChecks, 'send_window').status).toBe('block');
    expect(check(row.policyChecks, 'consent').detail).toContain('marketing');
  });

  it('variável sem valor: o destinatário é pulado ("sem horário de avaliação"), nunca mensagem com buraco', async () => {
    const withEvent = await addRecipient(a, { name: 'Com Horário' });
    const without = await addRecipient(a, { name: 'Sem Horário' });
    await addEvent(a, {
      contactId: withEvent.contactId,
      startAt: spAt(1, 8, 30),
      title: 'Avaliação',
    });
    const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [withEvent.contactId, without.contactId],
      content: { kind: 'text', text: 'Lembrete: amanhã às {hora}.' },
    });
    const id = proposalIdOf(env);
    const { row, preview } = await proposalOf(id);
    const vars = check(row.policyChecks, 'variables');
    expect(vars.status).toBe('warn');
    expect(vars.detail).toContain('sem horário de avaliação');
    expect(preview.message_preview?.samples).toEqual([
      { recipient_label: 'Com Horário', text: 'Lembrete: amanhã às 08:30.' },
    ]);
    expect((await confirm(id, 'OWNER')).ok).toBe(true);
    const { items } = await proposalOf(id);
    const byContact = new Map(items.map((i) => [i.targetId, i]));
    expect(byContact.get(without.contactId)).toMatchObject({
      status: 'skipped_policy',
      errorCode: 'missing_hora',
    });
    expect(await outbound(without.conversationId)).toHaveLength(0);
  });

  it('pedido de agendamento: linha schedule avisa que sai no confirmar', async () => {
    const r = await addRecipient(a, { name: 'Agendar' });
    const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [r.contactId],
      content: { kind: 'text', text: 'Bom dia!' },
      send_at: spAt(1, 9, 0).toISOString(),
    });
    const { row } = await proposalOf(proposalIdOf(env));
    const schedule = check(row.policyChecks, 'schedule');
    expect(schedule.status).toBe('warn');
    expect(schedule.detail).toContain('sai ao confirmar');
  });

  it('permissão por volume: AGENT com 1 destinatário propõe; com 2 vira blocked (papel) com aprovação', async () => {
    const agentId = a.ws.members.AGENT.id;
    const one = await addRecipient(a, { name: 'Do Atendente', assignedTo: agentId });
    const two = await addRecipient(a, { name: 'Também Dele', assignedTo: agentId });
    const single = await call(SEND_MESSAGES_TOOL_KEY, 'AGENT', {
      contact_ids: [one.contactId],
      content: { kind: 'text', text: 'Oi!' },
    });
    expect(single.decision).toBe('proposed');
    expect((await proposalOf(proposalIdOf(single))).row.riskLevel).toBe(4);

    const many = await call(SEND_MESSAGES_TOOL_KEY, 'AGENT', {
      contact_ids: [one.contactId, two.contactId],
      content: { kind: 'text', text: 'Oi!' },
    });
    expect(many.decision).toBe('blocked');
    expect(many.model_view).toMatchObject({ reason: 'role', can_request_approval: true });
  });

  it('escopo: contato de outro workspace não existe (scope), e conversa que o membro não vê é pulada', async () => {
    const foreign = await addRecipient(b, { name: 'De Fora' });
    const env = await call(SEND_MESSAGES_TOOL_KEY, 'OWNER', {
      contact_ids: [foreign.contactId],
      content: { kind: 'text', text: 'Oi' },
    });
    expect(env.decision).toBe('blocked');
    expect(env.model_view).toMatchObject({ reason: 'scope', not_found: 1 });

    // AGENT: contato visível (contact.view), conversa de outro responsável → sem conversa visível.
    const notMine = await addRecipient(a, {
      name: 'Do Colega',
      assignedTo: a.ws.members.SUPERVISOR.id,
    });
    const mine = await addRecipient(a, { name: 'Meu Cliente', assignedTo: a.ws.members.AGENT.id });
    void mine;
    const agentEnv = await call(SEND_MESSAGES_TOOL_KEY, 'AGENT', {
      contact_ids: [notMine.contactId],
      content: { kind: 'text', text: 'Oi' },
    });
    const { row } = await proposalOf(proposalIdOf(agentEnv));
    expect(check(row.policyChecks, 'recipients').status).toBe('block');
  });
});

// ─── campanha ───────────────────────────────────────────────────────────────────

describe('propose_campaign_status', () => {
  it('cancelar: nível 4 irreversível, números e "Pausar em vez disso"; o ajuste pausa e o desfazer retoma', async () => {
    const { campaignId } = await addCampaign(a, {
      status: 'running',
      sent: 2,
      pending: 3,
      name: 'Clareamento de Outubro',
    });
    const env = await call(CAMPAIGN_STATUS_TOOL_KEY, 'ADMIN', {
      campaign_id: campaignId,
      action: 'cancel',
    });
    expect(env.decision).toBe('proposed');
    const id = proposalIdOf(env);
    const { row, preview } = await proposalOf(id);
    expect(row).toMatchObject({ capability: 'campaign.cancel', riskLevel: 4 });
    expect(row.summary).toBe('Cancelar a campanha "Clareamento de Outubro"');
    expect(preview.alternatives).toEqual([{ kind: 'pause_instead', label: 'Pausar em vez disso' }]);
    expect(preview.before_after).toEqual([
      { label: 'Campanha', before: 'Enviando', after: 'Cancelada', count: 1 },
    ]);
    expect(check(row.policyChecks, 'campaign_status').status).toBe('ok');
    expect(check(row.policyChecks, 'already_sent')).toMatchObject({
      status: 'warn',
      detail: '2 de 5 já saíram e não voltam.',
    });
    expect(check(row.policyChecks, 'scheduled').detail).toContain('3 ainda iam sair');
    expect(check(row.policyChecks, 'cost_used').detail).toBe(
      'Custo por campanha ainda não é registrado.',
    );

    // "Pausar em vez disso" = adjust com pause_instead.
    const admin = await principalOf('ADMIN');
    const adjusted = await withWorkspace(a.workspaceId, (tx) =>
      adjustProposal(deps, tx, admin, id, {
        version: row.version,
        params: { pause_instead: true },
      }),
    );
    if (!adjusted.ok) throw new Error(`adjust: ${adjusted.error}`);
    expect(adjusted.row.args).toMatchObject({ action: 'pause' });
    expect(adjusted.row.summary).toBe('Pausar a campanha "Clareamento de Outubro"');
    expect(adjusted.proposal.preview.alternatives).toBeUndefined();
    expect(adjusted.row.riskLevel).toBe(4);

    expect((await confirm(id, 'ADMIN')).ok).toBe(true);
    expect(await campaignStatus(campaignId)).toBe('paused');
    const done = await proposalOf(id);
    expect(done.row.status).toBe('completed');
    expect(done.row.undoDeadline).not.toBeNull();

    const undone = await undoProposal(deps, admin, id, randomUUID());
    expect(undone.ok).toBe(true);
    expect(await campaignStatus(campaignId)).toBe('running');
  });

  it('cancelar de fato: status cancelled, números no item; SUPERVISOR não cancela (blocked) mas pausa', async () => {
    const { campaignId } = await addCampaign(a, { status: 'running', sent: 1, pending: 2 });
    const sup = await call(CAMPAIGN_STATUS_TOOL_KEY, 'SUPERVISOR', {
      campaign_id: campaignId,
      action: 'cancel',
    });
    expect(sup.decision).toBe('blocked');
    expect(sup.model_view).toMatchObject({ reason: 'role' });
    const supPause = await call(CAMPAIGN_STATUS_TOOL_KEY, 'SUPERVISOR', {
      campaign_id: campaignId,
      action: 'pause',
    });
    expect(supPause.decision).toBe('proposed');
    // Quem não vê custo não recebe a linha de custo.
    const sp = await proposalOf(proposalIdOf(supPause));
    expect((sp.row.policyChecks ?? []).some((c) => c.key === 'cost_used')).toBe(false);

    const env = await call(CAMPAIGN_STATUS_TOOL_KEY, 'OWNER', {
      campaign_id: campaignId,
      action: 'cancel',
    });
    const id = proposalIdOf(env);
    expect((await confirm(id, 'OWNER')).ok).toBe(true);
    expect(await campaignStatus(campaignId)).toBe('cancelled');
    const { row, items } = await proposalOf(id);
    expect(row.status).toBe('completed');
    expect(row.undoDeadline).toBeNull();
    expect(items[0]?.after).toMatchObject({
      state: { status: 'cancelled', already_sent: 1, cancelled_scheduled: 2, cost_used: null },
    });
  });

  it('campanha concluída: campaign_status = block e o confirmar recusa (409)', async () => {
    const { campaignId } = await addCampaign(a, { status: 'completed', sent: 3 });
    const env = await call(CAMPAIGN_STATUS_TOOL_KEY, 'OWNER', {
      campaign_id: campaignId,
      action: 'cancel',
    });
    const id = proposalIdOf(env);
    expect(check((await proposalOf(id)).row.policyChecks, 'campaign_status').status).toBe('block');
    const out = await confirm(id, 'OWNER');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('policy_blocked');
    expect(await campaignStatus(campaignId)).toBe('completed');
  });

  it('campanha de outro workspace: scope (não existe)', async () => {
    const { campaignId } = await addCampaign(b, { status: 'running' });
    const env = await call(CAMPAIGN_STATUS_TOOL_KEY, 'OWNER', {
      campaign_id: campaignId,
      action: 'pause',
    });
    expect(env.decision).toBe('blocked');
    expect(env.model_view).toMatchObject({ reason: 'scope' });
    expect(await campaignStatus(campaignId)).toBe('running');
  });
});

// ─── flow ───────────────────────────────────────────────────────────────────────

describe('propose_trigger_flow', () => {
  it('dispara o flow publicado (nível 4, "pode enviar mensagens"), idempotente por item; desfazer cancela a execução', async () => {
    const flowId = await addFlow(a, { sends: true });
    const r = await addRecipient(a, { name: 'Flow Cliente', assignedTo: a.ws.members.AGENT.id });
    const env = await call(TRIGGER_FLOW_TOOL_KEY, 'AGENT', {
      flow_id: flowId,
      contact_ids: [r.contactId],
    });
    expect(env.decision).toBe('proposed');
    const id = proposalIdOf(env);
    const { row, preview } = await proposalOf(id);
    expect(row).toMatchObject({ capability: 'flow.trigger', riskLevel: 4 });
    expect(preview.impact.criterion).toContain('pode enviar mensagens');
    expect(check(row.policyChecks, 'flow_published').status).toBe('ok');
    expect(check(row.policyChecks, 'flow_sends').status).toBe('warn');

    // Quem pediu confirma (o atendente tem `flow.trigger`).
    expect((await confirm(id, 'AGENT')).ok).toBe(true);
    const { items } = await proposalOf(id);
    expect(items[0]?.status).toBe('done');
    const [exec] = await getDb()
      .select()
      .from(schema.flowExecutions)
      .where(eq(schema.flowExecutions.contactId, r.contactId));
    expect(exec).toMatchObject({
      flowId,
      triggeredBy: 'manual',
      triggeredByMemberId: a.ws.members.AGENT.id,
      conversationId: r.conversationId,
      variables: { trigger: { via: 'copilot', proposal_id: id, copilot_item_id: items[0]?.id } },
    });

    // Repetir o item (retomada) não dispara de novo.
    const owner = await principalOf('AGENT');
    const again = await withWorkspace(a.workspaceId, (tx) =>
      triggerFlowExecutor.executeItem(
        executorContext({
          tx,
          principal: owner,
          requestedByMemberId: owner.memberId,
          proposalId: id,
          source: 'copilot',
          now: new Date(),
          afterCommit: () => undefined,
        }),
        { flow_id: flowId, contact_ids: [r.contactId] },
        {
          id: items[0]!.id,
          targetType: 'contact',
          targetId: r.contactId,
          label: 'Flow Cliente',
          expectedVersion: null,
          before: null,
          plannedAfter: null,
        },
      ),
    );
    expect(again).toMatchObject({ status: 'done', after: { execution_id: exec?.id } });
    const all = await getDb()
      .select({ id: schema.flowExecutions.id })
      .from(schema.flowExecutions)
      .where(eq(schema.flowExecutions.contactId, r.contactId));
    expect(all).toHaveLength(1);

    const undone = await undoProposal(deps, owner, id, randomUUID());
    expect(undone.ok).toBe(true);
    const [after] = await getDb()
      .select({ status: schema.flowExecutions.status })
      .from(schema.flowExecutions)
      .where(eq(schema.flowExecutions.id, exec!.id));
    expect(after?.status).toBe('cancelled');
  });

  it('flow em rascunho: flow_published = block; flow sem nó de envio: flow_sends ok', async () => {
    const draft = await addFlow(a, { status: 'draft' });
    const quiet = await addFlow(a, { sends: false });
    const r = await addRecipient(a, { name: 'Flow Dois' });
    const d = await call(TRIGGER_FLOW_TOOL_KEY, 'OWNER', {
      flow_id: draft,
      contact_ids: [r.contactId],
    });
    expect(
      check((await proposalOf(proposalIdOf(d))).row.policyChecks, 'flow_published').status,
    ).toBe('block');
    const q = await call(TRIGGER_FLOW_TOOL_KEY, 'OWNER', {
      flow_id: quiet,
      contact_ids: [r.contactId],
    });
    const qp = await proposalOf(proposalIdOf(q));
    expect(qp.row.riskLevel).toBe(4);
    expect(check(qp.row.policyChecks, 'flow_sends').status).toBe('ok');
  });
});
