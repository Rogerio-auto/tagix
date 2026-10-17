/**
 * F73-S02 — fixtures canônicas × schemas, e o que os schemas recusam.
 *
 * O que este arquivo protege:
 * - toda fixture parseia no seu schema, e a ida e volta por JSON devolve o mesmo valor
 *   (nada depende de `Date`, de `undefined` explícito ou de transformação);
 * - a entrada é `.strict()`: identidade, workspace e campos inesperados não entram (R2);
 * - links do modelo só são internos (R4).
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ActivityPageSchema,
  AdjustProposalBody,
  ApproverSchema,
  AskBody,
  AutopilotRuleSchema,
  BriefingSchema,
  ConfirmProposalBody,
  CopilotAnswerBlocksSchema,
  CopilotMeSchema,
  CopilotMessageSchema,
  CopilotPageContextSchema,
  CopilotPrefsUpdateSchema,
  CopilotSessionSchema,
  CopilotSettingsSchema,
  CopilotSettingsUpdateSchema,
  CopilotStreamEventSchema,
  CopilotUsageSchema,
  DecideSuggestionsBody,
  MemoryFactBodySchema,
  MemoryFactSchema,
  MemoryProfileSchema,
  MemoryProfileUpdateSchema,
  MemorySourceSchema,
  NextStepActionSchema,
  ProposalDTOSchema,
  RequestApprovalBody,
  SuggestionSchema,
  ToolResultCardSchema,
} from './contracts';
import {
  CopilotRunRequestSchema,
  CopilotRuntimeEventSchema,
  CopilotToolCallBodySchema,
  CopilotToolEnvelopeSchema,
} from './internal';
import * as F from './fixtures';

const roundTrip = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;

/** [nome, schema, fixture] — cada fixture exportada aparece aqui pelo menos uma vez. */
const pares: ReadonlyArray<[string, z.ZodTypeAny, unknown]> = [
  ['pageContextDeal', CopilotPageContextSchema, F.fixturePageContextDeal],
  ['pageContextBoard', CopilotPageContextSchema, F.fixturePageContextBoard],
  ...F.fixtureCards.map((c): [string, z.ZodTypeAny, unknown] => [`card:${c.kind}`, ToolResultCardSchema, c]),
  ['answerIdle', CopilotAnswerBlocksSchema, F.fixtureAnswerIdle],
  ['proposalMoveIdle', ProposalDTOSchema, F.fixtureProposalMoveIdle],
  ['proposalMoveIdlePartial', ProposalDTOSchema, F.fixtureProposalMoveIdlePartial],
  ['proposalReminder', ProposalDTOSchema, F.fixtureProposalReminder],
  ['proposalCancelCampaign', ProposalDTOSchema, F.fixtureProposalCancelCampaign],
  ['proposalBlockedCancel', ProposalDTOSchema, F.fixtureProposalBlockedCancel],
  ...[...F.fixtureStreamMoveIdle, ...F.fixtureStreamOthers].map(
    (e, i): [string, z.ZodTypeAny, unknown] => [`stream#${i}:${e.type}`, CopilotStreamEventSchema, e],
  ),
  ['session', CopilotSessionSchema, F.fixtureSession],
  ...F.fixtureMessages.map((m): [string, z.ZodTypeAny, unknown] => [`message:${m.role}`, CopilotMessageSchema, m]),
  ['activityPage', ActivityPageSchema, F.fixtureActivityPage],
  ...F.fixtureApprovers.map((a): [string, z.ZodTypeAny, unknown] => [`approver:${a.name}`, ApproverSchema, a]),
  ['briefing', BriefingSchema, F.fixtureBriefing],
  ['memoryProfile', MemoryProfileSchema, F.fixtureMemoryProfile],
  ...F.fixtureMemoryFacts.map((f): [string, z.ZodTypeAny, unknown] => [`fact:${f.status}`, MemoryFactSchema, f]),
  ...F.fixtureMemorySources.map((s): [string, z.ZodTypeAny, unknown] => [`source:${s.key}`, MemorySourceSchema, s]),
  ['settings', CopilotSettingsSchema, F.fixtureSettings],
  ['meAdmin', CopilotMeSchema, F.fixtureMeAdmin],
  ['meAgent', CopilotMeSchema, F.fixtureMeAgent],
  ...F.fixtureSuggestions.map((s): [string, z.ZodTypeAny, unknown] => [`suggestion:${s.confidence}`, SuggestionSchema, s]),
  ...F.fixtureAutopilotRules.map((r): [string, z.ZodTypeAny, unknown] => [`rule:${r.mode}`, AutopilotRuleSchema, r]),
  ['usage', CopilotUsageSchema, F.fixtureUsage],
  ['askBody', AskBody, F.fixtureAskBody],
  ['confirmBody', ConfirmProposalBody, F.fixtureConfirmBody],
  ['confirmLevel4Body', ConfirmProposalBody, F.fixtureConfirmLevel4Body],
  ['adjustBody', AdjustProposalBody, F.fixtureAdjustBody],
  ['requestApprovalBody', RequestApprovalBody, F.fixtureRequestApprovalBody],
  ['decideSuggestionsBody', DecideSuggestionsBody, F.fixtureDecideSuggestionsBody],
  ['runRequest', CopilotRunRequestSchema, F.fixtureRunRequest],
  ['toolCallBody', CopilotToolCallBodySchema, F.fixtureToolCallBody],
  ['toolEnvelope', CopilotToolEnvelopeSchema, F.fixtureToolEnvelope],
  ...[...F.fixtureRuntimeEvents, ...F.fixtureRuntimeEventsFallback].map(
    (e, i): [string, z.ZodTypeAny, unknown] => [`runtime#${i}:${e.type}`, CopilotRuntimeEventSchema, e],
  ),
];

describe('fixtures × schemas', () => {
  it.each(pares)('%s parseia e o parse não muda nada', (_n, schema, fx) => {
    const r = schema.safeParse(fx);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues, null, 2));
    expect(r.data).toEqual(fx);
  });

  it.each(pares)('%s sobrevive a JSON.parse(JSON.stringify(x))', (_n, schema, fx) => {
    const volta = roundTrip(fx);
    expect(volta).toEqual(fx);
    expect(schema.parse(volta)).toEqual(fx);
  });

  it('todos os 10 tipos de cartão têm fixture', () => {
    expect(new Set(F.fixtureCards.map((c) => c.kind)).size).toBe(10);
  });

  it('todos os 10 tipos de evento SSE público têm fixture', () => {
    const tipos = new Set([...F.fixtureStreamMoveIdle, ...F.fixtureStreamOthers].map((e) => e.type));
    expect(tipos.size).toBe(10);
  });

  it('todos os 6 tipos de evento interno têm fixture', () => {
    const tipos = new Set([...F.fixtureRuntimeEvents, ...F.fixtureRuntimeEventsFallback].map((e) => e.type));
    expect(tipos.size).toBe(6);
  });
});

describe('fixtures — fiéis à maquete (Arcada Odontologia)', () => {
  it('7 negócios parados somam R$ 38.500', () => {
    expect(F.FIXTURE_IDLE_TOTAL_BRL).toBe(38_500);
    expect(F.fixtureCardDealListIdle.data.items).toHaveLength(7);
    expect(F.fixtureProposalMoveIdle.preview.impact.forecast_delta_brl).toBe(-38_500);
  });

  it('Maria Souza está no contexto, no cartão e na proposta', () => {
    expect(F.fixtureCardContactMaria.data.name).toBe('Maria Souza');
    expect(F.fixtureProposalMoveIdle.items.data[0]?.label).toBe('Maria Souza · Alinhadores');
  });

  it('briefing de 3 itens, ordenado por receita em risco', () => {
    expect(F.fixtureBriefing.items).toHaveLength(3);
    const valores = F.fixtureBriefing.items.map((i) => i.value_at_risk);
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
  });

  it('lembrete a 12 pacientes é nível 4 com checagem de política', () => {
    expect(F.fixtureProposalReminder.items.total).toBe(12);
    expect(F.fixtureProposalReminder.risk_level).toBe(4);
    expect(F.fixtureProposalReminder.policy_checks?.length).toBeGreaterThan(0);
  });

  it('campanha "Clareamento de Outubro" com "Pausar em vez disso"', () => {
    expect(F.fixtureCardCampaign.data.name).toBe('Clareamento de Outubro');
    expect(F.fixtureProposalCancelCampaign.preview.alternatives?.[0]?.kind).toBe('pause_instead');
  });

  it('parcial "5 de 7": dois pulados por conflito, com motivo', () => {
    const itens = F.fixtureProposalMoveIdlePartial.items.data;
    expect(itens.filter((i) => i.status === 'done')).toHaveLength(5);
    expect(itens.filter((i) => i.status === 'skipped_conflict' && i.reason !== null)).toHaveLength(2);
  });

  it('o /me do atendente não carrega custo', () => {
    expect(F.fixtureMeAgent.budget.spent_usd).toBeUndefined();
    expect('spent_usd' in F.fixtureMeAgent.budget).toBe(false);
  });
});

describe('entrada estrita (R2: nada de identidade nem campo inesperado)', () => {
  it('body do callback recusa workspace_id/member_id', () => {
    expect(CopilotToolCallBodySchema.safeParse({ ...F.fixtureToolCallBody, workspace_id: F.FIXTURE_IDS.workspace }).success).toBe(false);
    expect(CopilotToolCallBodySchema.safeParse({ ...F.fixtureToolCallBody, member_id: F.FIXTURE_IDS.members.bruna }).success).toBe(false);
  });

  it('pedido ao runtime não aceita campo de identidade', () => {
    expect(CopilotRunRequestSchema.safeParse({ ...F.fixtureRunRequest, member_id: F.FIXTURE_IDS.members.bruna }).success).toBe(false);
    expect(
      CopilotRunRequestSchema.safeParse({ ...F.fixtureRunRequest, member: { ...F.fixtureRunRequest.member, role: 'OWNER' } }).success,
    ).toBe(false);
  });

  it('AskBody: texto até 2.000, client_request_id UUID, sem campo extra', () => {
    expect(AskBody.safeParse({ ...F.fixtureAskBody, text: 'x'.repeat(2000) }).success).toBe(true);
    expect(AskBody.safeParse({ ...F.fixtureAskBody, text: 'x'.repeat(2001) }).success).toBe(false);
    expect(AskBody.safeParse({ ...F.fixtureAskBody, text: '   ' }).success).toBe(false);
    expect(AskBody.safeParse({ ...F.fixtureAskBody, client_request_id: 'abc' }).success).toBe(false);
    expect(AskBody.safeParse({ ...F.fixtureAskBody, role: 'OWNER' }).success).toBe(false);
  });

  it('contexto de página: filtros só da allowlist, seleção ≤ 50, rota é padrão', () => {
    expect(CopilotPageContextSchema.safeParse({ route: '/pipeline', filters: { workspaceId: 'x' } }).success).toBe(false);
    const ids = Array.from({ length: 51 }, () => F.FIXTURE_IDS.deals.maria);
    expect(CopilotPageContextSchema.safeParse({ route: '/pipeline', selection: { type: 'deal', ids } }).success).toBe(false);
    expect(CopilotPageContextSchema.safeParse({ route: 'https://evil.example' }).success).toBe(false);
    expect(CopilotPageContextSchema.safeParse({ route: '/conversations/[id]' }).success).toBe(true);
  });

  it('settings: o dono não desliga o próprio acesso; modelo e agência não são do tenant', () => {
    expect(CopilotSettingsUpdateSchema.safeParse({ capability_matrix: { OWNER: { use: false } } }).success).toBe(false);
    expect(CopilotSettingsUpdateSchema.safeParse({ capability_matrix: { AGENT: { use: false } } }).success).toBe(true);
    expect(CopilotSettingsUpdateSchema.safeParse({ model: 'openai/gpt' }).success).toBe(false);
    expect(CopilotSettingsUpdateSchema.safeParse({ partner_access: true }).success).toBe(false);
    expect(CopilotSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(CopilotSettingsUpdateSchema.safeParse({ capability_matrix: { AGENT: { 'deal.delete': false } } }).success).toBe(false);
    expect(CopilotSettingsUpdateSchema.safeParse({ capability_matrix: { GUEST: {} } }).success).toBe(false);
  });

  it('prefs, memória, sugestões e ajuste recusam corpo vazio ou inválido', () => {
    expect(CopilotPrefsUpdateSchema.safeParse({}).success).toBe(false);
    expect(CopilotPrefsUpdateSchema.safeParse({ auto_open: null }).success).toBe(true);
    expect(MemoryProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(MemoryProfileUpdateSchema.safeParse({ tone: 'x'.repeat(501) }).success).toBe(false);
    expect(MemoryFactBodySchema.safeParse({ content: 'x'.repeat(301) }).success).toBe(false);
    expect(DecideSuggestionsBody.safeParse({ ids: [F.FIXTURE_IDS.deals.maria, F.FIXTURE_IDS.deals.maria], decision: 'approve' }).success).toBe(false);
    expect(DecideSuggestionsBody.safeParse({ ids: [], decision: 'approve' }).success).toBe(false);
    expect(AdjustProposalBody.safeParse({ version: 1 }).success).toBe(false);
    expect(ConfirmProposalBody.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe('saída: links internos, versão e limites', () => {
  it.each(['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/\\evil', 'pipeline'])(
    'navigate recusa %s',
    (value) => {
      expect(NextStepActionSchema.safeParse({ kind: 'navigate', value }).success).toBe(false);
    },
  );

  it('navigate aceita rota interna com query', () => {
    expect(NextStepActionSchema.safeParse({ kind: 'navigate', value: '/pipeline?stage=abc' }).success).toBe(true);
  });

  it('evento SSE com outra versão é recusado', () => {
    expect(CopilotStreamEventSchema.safeParse({ ...F.fixtureStreamOthers[3], v: 2 }).success).toBe(false);
  });

  it('evento SSE de erro só aceita código do conjunto público', () => {
    expect(CopilotStreamEventSchema.safeParse({ v: 1, type: 'error', code: 'boom', ref: 'hm_err_1' }).success).toBe(false);
  });

  it('cartão de tabela com coluna desconhecida é recusado', () => {
    const t = F.fixtureCardMembersTable;
    const ruim = { ...t, data: { ...t.data, rows: [{ name: 'X', email: 'x@y.z' }] } };
    expect(ToolResultCardSchema.safeParse(ruim).success).toBe(false);
  });

  it('cartão com kind trocado não passa no schema do outro kind', () => {
    expect(ToolResultCardSchema.safeParse({ ...F.fixtureCardCampaign, kind: 'deal_list' }).success).toBe(false);
  });

  it('proposta com mais de 200 itens numa página é recusada', () => {
    const item = F.fixtureProposalMoveIdle.items.data[0];
    const data = Array.from({ length: 201 }, () => item);
    const p = { ...F.fixtureProposalMoveIdle, items: { data, total: 201, next_cursor: null } };
    expect(ProposalDTOSchema.safeParse(p).success).toBe(false);
  });

  it('envelope recusa decisão fora do enum e public_event que não é de ferramenta', () => {
    expect(CopilotToolEnvelopeSchema.safeParse({ ...F.fixtureToolEnvelope, decision: 'ok' }).success).toBe(false);
    expect(
      CopilotToolEnvelopeSchema.safeParse({
        ...F.fixtureToolEnvelope,
        public_event: F.fixtureStreamMoveIdle[F.fixtureStreamMoveIdle.length - 1],
      }).success,
    ).toBe(false);
  });

  it('evento interno de erro aceita código aberto (a API mapeia para o público)', () => {
    expect(CopilotRuntimeEventSchema.safeParse({ type: 'error', code: 'model_error' }).success).toBe(true);
    expect(CopilotRuntimeEventSchema.safeParse({ type: 'error', code: 'Model Error!' }).success).toBe(false);
  });

  it('final interno: format_fallback é opcional; usage exige os três campos', () => {
    const final = F.fixtureRuntimeEvents[F.fixtureRuntimeEvents.length - 1];
    expect(CopilotRuntimeEventSchema.safeParse(final).success).toBe(true);
    expect(
      CopilotRuntimeEventSchema.safeParse({
        type: 'final',
        blocks: F.fixtureAnswerIdle,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        iterations: 1,
      }).success,
    ).toBe(false);
  });

  it('política do runtime não passa dos tetos duros (8 iterações, 16 ferramentas, 60 s)', () => {
    const p = F.fixtureRunRequest.policy;
    for (const ruim of [{ max_iterations: 9 }, { max_tool_calls: 17 }, { turn_timeout_s: 61 }]) {
      expect(CopilotRunRequestSchema.safeParse({ ...F.fixtureRunRequest, policy: { ...p, ...ruim } }).success).toBe(false);
    }
  });
});
