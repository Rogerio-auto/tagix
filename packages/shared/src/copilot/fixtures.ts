/**
 * Fixtures canônicas do Copiloto: Arcada Odontologia, dados FICTÍCIOS da maquete
 * (`docs/design/copilot-integracoes.html`, A1–A12).
 *
 * Insumo do cliente mock da F74-S01 e dos testes de API. Todas são validadas pelos schemas
 * em `fixtures.test.ts`, inclusive a ida e volta por JSON: nada aqui depende de `Date`, de
 * `undefined` explícito ou de referência compartilhada. Ids são UUIDs fixos e legíveis
 * (o prefixo hexadecimal diz o tipo: `d…` negócio, `c…` contato, `a…` membro etc.).
 *
 * Nenhum dado real: nomes, valores e telefones são inventados.
 */
import type {
  ActivityEntry,
  ActivityPage,
  AdjustProposalInput,
  Approver,
  AskInput,
  Briefing,
  ConfirmProposalInput,
  CopilotAnswerBlocks,
  CopilotMe,
  CopilotMessage,
  CopilotPageContext,
  CopilotSession,
  CopilotSettings,
  CopilotStreamEvent,
  CopilotUsage,
  DecideSuggestionsInput,
  AutopilotRule,
  MemoryFact,
  MemoryProfile,
  MemorySource,
  ProposalDTO,
  ProposalItem,
  RequestApprovalInput,
  Suggestion,
  ToolResultCard,
  ToolResultCardOf,
} from './contracts';
import type {
  CopilotRunRequest,
  CopilotRuntimeEvent,
  CopilotToolCallBody,
  CopilotToolEnvelope,
} from './internal';
import { effectiveCapabilities } from './capabilities';

// ─── Ids e relógio ───────────────────────────────────────────────────────────

/** UUID v4 fixo: `<prefixo hex><n>` nos 12 últimos dígitos. */
function fid(prefix: string, n: number): string {
  const tail = `${prefix}${n.toString(16)}`.padStart(12, '0');
  return `00000000-0000-4000-8000-${tail}`;
}

/** "Agora" da maquete: quinta de manhã em São Paulo (09:14 BRT). */
export const FIXTURE_NOW = '2026-10-16T12:14:00.000Z';
const BRIEFING_AT = '2026-10-16T09:30:00.000Z';
const TODAY = '2026-10-16';

export const FIXTURE_IDS = {
  workspace: fid('e', 1),
  members: {
    carlos: fid('a', 1),
    bruna: fid('a', 2),
    paula: fid('a', 3),
    rafael: fid('a', 4),
  },
  pipeline: fid('b', 1),
  stages: {
    novo: fid('5', 1),
    avaliacao: fid('5', 2),
    orcamento: fid('5', 3),
    negociacao: fid('5', 4),
    fechado: fid('5', 5),
    reativacao: fid('5', 6),
  },
  contacts: { maria: fid('c', 1) },
  deals: { maria: fid('d', 1) },
  campaign: fid('ca', 1),
  session: fid('f', 1),
  turn: fid('f1', 1),
  messages: { question: fid('f2', 1), answer: fid('f2', 2) },
  proposals: {
    moveIdle: fid('9', 1),
    moveIdlePartial: fid('9', 2),
    reminder: fid('9', 3),
    cancelCampaign: fid('9', 4),
    blockedCancel: fid('9', 5),
    tagReceipt: fid('9', 6),
  },
  briefing: fid('b2', 1),
} as const;

const M = FIXTURE_IDS.members;
const S = FIXTURE_IDS.stages;

const bruna = { member_id: M.bruna, name: 'Bruna Lima' };
const paula = { member_id: M.paula, name: 'Paula Reis' };
const rafael = { member_id: M.rafael, name: 'Rafael Costa' };

// ─── Os 7 negócios parados em "Orçamento enviado" (R$ 38.500) ────────────────

interface IdleDeal {
  readonly n: number;
  readonly patient: string;
  readonly treatment: string;
  readonly value: number;
  readonly idle: number;
  readonly owner: string;
}

const IDLE_DEALS: readonly IdleDeal[] = [
  { n: 1, patient: 'Maria Souza', treatment: 'Alinhadores', value: 6500, idle: 9, owner: 'Paula Reis' },
  { n: 2, patient: 'João Pereira', treatment: 'Implante unitário', value: 4800, idle: 12, owner: 'Rafael Costa' },
  { n: 3, patient: 'Ana Ribeiro', treatment: 'Lentes de contato dental', value: 7400, idle: 8, owner: 'Paula Reis' },
  { n: 4, patient: 'Lucas Martins', treatment: 'Prótese protocolo', value: 6200, idle: 15, owner: 'Rafael Costa' },
  { n: 5, patient: 'Fernanda Alves', treatment: 'Alinhadores', value: 5500, idle: 7, owner: 'Paula Reis' },
  { n: 6, patient: 'Ricardo Gomes', treatment: 'Clareamento a laser', value: 3900, idle: 10, owner: 'Rafael Costa' },
  { n: 7, patient: 'Camila Rocha', treatment: 'Implante unitário', value: 4200, idle: 11, owner: 'Paula Reis' },
];

/** Soma dos 7 parados. A maquete mostra "R$ 38.500 saem da previsão do mês". */
export const FIXTURE_IDLE_TOTAL_BRL = IDLE_DEALS.reduce((s, d) => s + d.value, 0);

// ─── Contexto de página ──────────────────────────────────────────────────────

export const fixturePageContextDeal: CopilotPageContext = {
  route: '/pipeline',
  entity: { type: 'deal', id: FIXTURE_IDS.deals.maria },
  view: 'detail',
};

export const fixturePageContextBoard: CopilotPageContext = {
  route: '/pipeline',
  selection: { type: 'deal', ids: IDLE_DEALS.map((d) => fid('d', d.n)) },
  filters: { pipelineId: FIXTURE_IDS.pipeline, stageId: S.orcamento },
  view: 'board',
};

// ─── Cartões (`tool_result`) ─────────────────────────────────────────────────

const source = (label: string, record_count: number) => ({ label, as_of: FIXTURE_NOW, record_count });

export const fixtureCardDealListIdle: ToolResultCardOf<'deal_list'> = {
  result_id: 'r_idle_deals',
  kind: 'deal_list',
  source: source('Pipeline Tratamentos', 7),
  truncated: false,
  data: {
    currency: 'BRL',
    total: 7,
    items: IDLE_DEALS.map((d) => ({
      deal_id: fid('d', d.n),
      title: d.treatment,
      contact_name: d.patient,
      value: d.value,
      stage: { stage_id: S.orcamento, name: 'Orçamento enviado' },
      owner_name: d.owner,
      idle_days: d.idle,
    })),
  },
};

export const fixtureCardContactMaria: ToolResultCardOf<'contact_card'> = {
  result_id: 'r_contact_maria',
  kind: 'contact_card',
  source: source('Contato e histórico de conversas', 23),
  truncated: false,
  data: {
    contact_id: FIXTURE_IDS.contacts.maria,
    name: 'Maria Souza',
    phone_masked: '+55 11 9••••-4821',
    tags: ['Alinhadores', 'Indicação'],
    origin: 'Instagram',
    attribution: 'Campanha "Sorriso alinhado" (setembro)',
    currency: 'BRL',
    open_deals: [
      { deal_id: FIXTURE_IDS.deals.maria, title: 'Alinhadores', value: 6500, stage_name: 'Orçamento enviado' },
    ],
    last_conversation: {
      conversation_id: fid('c0', 1),
      channel: 'WhatsApp',
      last_message_at: '2026-10-07T14:02:00.000Z',
    },
  },
};

export const fixtureCardDealMaria: ToolResultCardOf<'deal_card'> = {
  result_id: 'r_deal_maria',
  kind: 'deal_card',
  source: source('Negócio e histórico', 5),
  truncated: false,
  data: {
    deal_id: FIXTURE_IDS.deals.maria,
    title: 'Alinhadores',
    contact: { contact_id: FIXTURE_IDS.contacts.maria, name: 'Maria Souza' },
    currency: 'BRL',
    value: 6500,
    installments: { count: 10, value: 650 },
    pipeline_name: 'Tratamentos',
    stage: { stage_id: S.orcamento, name: 'Orçamento enviado' },
    days_in_stage: 9,
    idle_days: 9,
    owner_name: 'Paula Reis',
    history: [
      { at: '2026-09-28T13:00:00.000Z', label: 'Avaliação realizada com Dr. Carlos' },
      { at: '2026-10-07T14:00:00.000Z', label: 'Movido para Orçamento enviado por Paula Reis' },
      { at: '2026-10-07T14:02:00.000Z', label: 'Orçamento enviado pelo WhatsApp' },
    ],
    products: [{ name: 'Alinhadores (tratamento completo)', quantity: 1, value: 6500 }],
  },
};

export const fixtureCardKpisForecast: ToolResultCardOf<'kpis'> = {
  result_id: 'r_forecast',
  kind: 'kpis',
  source: source('Pipeline Tratamentos · ganhos e perdidos dos últimos 180 dias', 214),
  truncated: false,
  data: {
    currency: 'BRL',
    items: [
      { key: 'closed', label: 'Fechado até hoje', value: 61200, format: 'currency', delta: 8400, range: null },
      {
        key: 'forecast',
        label: 'Previsto para outubro',
        value: 92800,
        format: 'currency',
        delta: null,
        range: { low: 84100, high: 101500 },
      },
      { key: 'target', label: 'Meta do mês', value: 100000, format: 'currency', delta: null, range: null },
    ],
    why: [
      '7 negócios em Orçamento enviado somam R$ 38.500 (p = 0,41)',
      'Negociação: R$ 21.300 com p = 0,68',
      'Fechado até hoje: R$ 61.200',
    ],
  },
};

export const fixtureCardSeriesRevenue: ToolResultCardOf<'series'> = {
  result_id: 'r_revenue_series',
  kind: 'series',
  source: source('Negócios ganhos', 58),
  truncated: false,
  data: {
    label: 'Receita fechada por mês',
    format: 'currency',
    currency: 'BRL',
    points: [
      { x: '2026-05', y: 71400 },
      { x: '2026-06', y: 68900 },
      { x: '2026-07', y: 80300 },
      { x: '2026-08', y: 77100 },
      { x: '2026-09', y: 88600 },
      { x: '2026-10', y: 61200 },
    ],
  },
};

export const fixtureCardFunnel: ToolResultCardOf<'funnel'> = {
  result_id: 'r_funnel',
  kind: 'funnel',
  source: source('Pipeline Tratamentos', 96),
  truncated: false,
  data: {
    pipeline_id: FIXTURE_IDS.pipeline,
    pipeline_name: 'Tratamentos',
    currency: 'BRL',
    stages: [
      { stage_id: S.novo, name: 'Novo contato', count: 41, value: 0, conversion_to_next: 0.56, idle_over_7d: 6 },
      { stage_id: S.avaliacao, name: 'Avaliação agendada', count: 23, value: 0, conversion_to_next: 0.74, idle_over_7d: 2 },
      { stage_id: S.orcamento, name: 'Orçamento enviado', count: 17, value: 89300, conversion_to_next: 0.41, idle_over_7d: 7 },
      { stage_id: S.negociacao, name: 'Negociação', count: 7, value: 31300, conversion_to_next: 0.68, idle_over_7d: 1 },
      { stage_id: S.fechado, name: 'Fechado', count: 8, value: 61200, conversion_to_next: null, idle_over_7d: 0 },
    ],
  },
};

export const fixtureCardEventsToday: ToolResultCardOf<'event_list'> = {
  result_id: 'r_events_today',
  kind: 'event_list',
  source: source('Agenda da clínica', 3),
  truncated: false,
  data: {
    items: [
      {
        event_id: fid('ee', 1),
        title: 'Avaliação · Juliana Prado',
        start_at: '2026-10-16T17:00:00.000Z',
        end_at: '2026-10-16T17:45:00.000Z',
        type: 'meeting',
        status: 'scheduled',
        contact_name: 'Juliana Prado',
      },
      {
        event_id: fid('ee', 2),
        title: 'Retorno · Marcos Vieira',
        start_at: '2026-10-16T19:30:00.000Z',
        end_at: null,
        type: 'follow_up',
        status: 'scheduled',
        contact_name: 'Marcos Vieira',
      },
    ],
  },
};

export const fixtureCardConversationsWaiting: ToolResultCardOf<'conversation_list'> = {
  result_id: 'r_waiting',
  kind: 'conversation_list',
  source: source('Inbox', 2),
  truncated: false,
  data: {
    items: [
      {
        conversation_id: fid('c0', 2),
        contact_name: 'Patrícia Nunes',
        channel: 'WhatsApp',
        status: 'open',
        assigned_to_name: null,
        last_message_at: '2026-10-16T11:40:00.000Z',
        waiting_minutes: 34,
      },
      {
        conversation_id: fid('c0', 3),
        contact_name: 'Thiago Barros',
        channel: 'Instagram',
        status: 'open',
        assigned_to_name: 'Paula Reis',
        last_message_at: '2026-10-16T11:58:00.000Z',
        waiting_minutes: 16,
      },
    ],
  },
};

export const fixtureCardCampaign: ToolResultCardOf<'campaign_card'> = {
  result_id: 'r_campaign',
  kind: 'campaign_card',
  source: source('Campanhas', 1),
  truncated: false,
  data: {
    campaign_id: FIXTURE_IDS.campaign,
    name: 'Clareamento de Outubro',
    status: 'running',
    channel: 'WhatsApp',
    scheduled_at: '2026-10-14T13:00:00.000Z',
    recipients: 840,
    sent: 512,
    delivered: 498,
    read: 371,
    replied: 46,
    failed: 14,
    currency: 'BRL',
    cost_used: 187.4,
  },
};

export const fixtureCardMembersTable: ToolResultCardOf<'table'> = {
  result_id: 'r_members',
  kind: 'table',
  source: source('Equipe', 4),
  truncated: false,
  data: {
    currency: null,
    columns: [
      { key: 'name', label: 'Nome', format: 'text' },
      { key: 'role', label: 'Papel', format: 'text' },
      { key: 'open_deals', label: 'Negócios abertos', format: 'number' },
    ],
    rows: [
      { name: 'Dr. Carlos Mendes', role: 'Dono', open_deals: 3 },
      { name: 'Bruna Lima', role: 'Gestora comercial', open_deals: 5 },
      { name: 'Paula Reis', role: 'Atendente', open_deals: 19 },
      { name: 'Rafael Costa', role: 'Atendente', open_deals: 14 },
    ],
  },
};

export const fixtureCards: readonly ToolResultCard[] = [
  fixtureCardDealListIdle,
  fixtureCardContactMaria,
  fixtureCardDealMaria,
  fixtureCardKpisForecast,
  fixtureCardSeriesRevenue,
  fixtureCardFunnel,
  fixtureCardEventsToday,
  fixtureCardConversationsWaiting,
  fixtureCardCampaign,
  fixtureCardMembersTable,
];

// ─── Resposta (formato fixo) ─────────────────────────────────────────────────

export const fixtureAnswerIdle: CopilotAnswerBlocks = {
  verdict: '7 negócios estão parados em Orçamento enviado e somam R$ 38.500 da previsão do mês.',
  why: [
    'Todos sem resposta do paciente há 7 dias ou mais (média de 10,3 dias)',
    'Em Orçamento enviado, 41% fecham; parados há mais de 7 dias, só 18%',
    'Paula tem 4 deles e Rafael 3',
  ],
  data_refs: ['r_idle_deals'],
  sources: [{ label: 'Pipeline Tratamentos', as_of: FIXTURE_NOW }],
  next_steps: [
    { label: 'Mover para Reativação', action: { kind: 'ask', value: 'Mover os 7 parados para Reativação' } },
    { label: 'Abrir no Pipeline', action: { kind: 'navigate', value: `/pipeline?stage=${S.orcamento}` } },
  ],
};

// ─── Propostas ───────────────────────────────────────────────────────────────

function idleItems(statusFor: (n: number) => ProposalItem['status'], reasonFor: (n: number) => string | null) {
  return IDLE_DEALS.map(
    (d): ProposalItem => ({
      id: fid('1', d.n),
      target_type: 'deal',
      target_id: fid('d', d.n),
      label: `${d.patient} · ${d.treatment}`,
      before: 'Orçamento enviado',
      after: 'Reativação',
      status: statusFor(d.n),
      reason: reasonFor(d.n),
    }),
  );
}

const movePreview: ProposalDTO['preview'] = {
  before_after: [{ label: 'Negócios', before: 'Orçamento enviado', after: 'Reativação', count: 7 }],
  impact: {
    forecast_delta_brl: -FIXTURE_IDLE_TOTAL_BRL,
    notified_members: [paula, rafael],
    affected_count: 7,
    criterion: 'Sem resposta do paciente há 7 dias ou mais em Orçamento enviado',
  },
};

/** A4/A5 nível 3: mover os 7 parados, aguardando confirmação. */
export const fixtureProposalMoveIdle: ProposalDTO = {
  id: FIXTURE_IDS.proposals.moveIdle,
  source: 'copilot',
  capability: 'deal.move',
  risk_level: 3,
  status: 'proposed',
  summary: 'Mover 7 negócios parados de Orçamento enviado para Reativação',
  preview: movePreview,
  policy_checks: null,
  items: { data: idleItems(() => 'pending', () => null), total: 7, next_cursor: null },
  progress: { done: 0, total: 7, failed: 0 },
  requested_by: bruna,
  approver: null,
  expires_at: '2026-10-16T12:29:00.000Z',
  undo_deadline: null,
  version: 1,
  can_confirm: true,
  can_undo: false,
  blocked_reason: null,
  created_at: FIXTURE_NOW,
};

/** "Movi 5 de 7, parei em dois que a Paula estava editando." */
export const fixtureProposalMoveIdlePartial: ProposalDTO = {
  ...fixtureProposalMoveIdle,
  id: FIXTURE_IDS.proposals.moveIdlePartial,
  status: 'partially_completed',
  items: {
    data: idleItems(
      (n) => (n === 3 || n === 5 ? 'skipped_conflict' : 'done'),
      (n) => (n === 3 || n === 5 ? 'Editado por Paula Reis às 09:15' : null),
    ),
    total: 7,
    next_cursor: null,
  },
  progress: { done: 5, total: 7, failed: 0 },
  expires_at: null,
  undo_deadline: '2026-10-17T12:16:00.000Z',
  version: 2,
  can_confirm: false,
  can_undo: true,
};

const REMINDER_PATIENTS = [
  'Juliana Prado',
  'Marcos Vieira',
  'Beatriz Lopes',
  'Gustavo Freitas',
  'Larissa Campos',
  'Eduardo Rezende',
  'Natália Duarte',
  'Felipe Carvalho',
  'Renata Moura',
  'André Teixeira',
  'Sofia Batista',
  'Vinícius Cardoso',
] as const;

/** A5 nível 4: lembrete de consulta de amanhã a 12 pacientes. */
export const fixtureProposalReminder: ProposalDTO = {
  id: FIXTURE_IDS.proposals.reminder,
  source: 'copilot',
  capability: 'message.send',
  risk_level: 4,
  status: 'proposed',
  summary: 'Enviar lembrete da consulta de amanhã a 12 pacientes pelo WhatsApp',
  preview: {
    before_after: [],
    impact: {
      notified_members: [],
      affected_count: 12,
      criterion: 'Pacientes com consulta em 17/10 que ainda não confirmaram',
    },
    message_preview: {
      template_name: 'lembrete_consulta',
      body: 'Olá, {{primeiro_nome}}! Lembrando da sua consulta amanhã às {{hora}} na Arcada Odontologia. Responda 1 para confirmar ou 2 para remarcar.',
      variables: ['primeiro_nome', 'hora'],
      samples: [
        {
          recipient_label: 'Juliana Prado',
          text: 'Olá, Juliana! Lembrando da sua consulta amanhã às 09:00 na Arcada Odontologia. Responda 1 para confirmar ou 2 para remarcar.',
        },
        {
          recipient_label: 'Marcos Vieira',
          text: 'Olá, Marcos! Lembrando da sua consulta amanhã às 10:30 na Arcada Odontologia. Responda 1 para confirmar ou 2 para remarcar.',
        },
        {
          recipient_label: 'Beatriz Lopes',
          text: 'Olá, Beatriz! Lembrando da sua consulta amanhã às 14:00 na Arcada Odontologia. Responda 1 para confirmar ou 2 para remarcar.',
        },
      ],
    },
  },
  policy_checks: [
    { key: 'send_window', status: 'ok', label: 'Janela de envio', detail: 'Dentro do horário comercial (09:14)' },
    { key: 'consent', status: 'warn', label: 'Consentimento', detail: '1 paciente sem consentimento será pulado' },
    {
      key: 'session_window',
      status: 'ok',
      label: 'Modelo aprovado',
      detail: 'Conversas fechadas há mais de 24 h usam o modelo "lembrete_consulta"',
    },
  ],
  items: {
    data: REMINDER_PATIENTS.map(
      (name, i): ProposalItem => ({
        id: fid('2', i + 1),
        target_type: 'contact',
        target_id: fid('c1', i + 1),
        label: name,
        before: null,
        after: 'Lembrete enviado',
        status: 'pending',
        reason: null,
      }),
    ),
    total: 12,
    next_cursor: null,
  },
  progress: { done: 0, total: 12, failed: 0 },
  requested_by: bruna,
  approver: null,
  expires_at: '2026-10-16T12:24:00.000Z',
  undo_deadline: null,
  version: 1,
  can_confirm: true,
  can_undo: false,
  blocked_reason: null,
  created_at: FIXTURE_NOW,
};

/** A5 nível 4 irreversível: cancelar a campanha, com "Pausar em vez disso". */
export const fixtureProposalCancelCampaign: ProposalDTO = {
  id: FIXTURE_IDS.proposals.cancelCampaign,
  source: 'copilot',
  capability: 'campaign.cancel',
  risk_level: 4,
  status: 'proposed',
  summary: 'Cancelar a campanha "Clareamento de Outubro"',
  preview: {
    before_after: [{ label: 'Campanha', before: 'Enviando', after: 'Cancelada', count: 1 }],
    impact: {
      notified_members: [],
      affected_count: 328,
      criterion: '328 destinatários ainda não receberam',
    },
    alternatives: [{ kind: 'pause_instead', label: 'Pausar em vez disso' }],
  },
  policy_checks: [
    { key: 'campaign_progress', status: 'warn', label: 'Já enviadas', detail: '512 de 840 já saíram e não voltam' },
    { key: 'campaign_cost', status: 'ok', label: 'Custo já usado', detail: 'R$ 187,40 até agora' },
  ],
  items: {
    data: [
      {
        id: fid('3', 1),
        target_type: 'campaign',
        target_id: FIXTURE_IDS.campaign,
        label: 'Clareamento de Outubro',
        before: 'Enviando',
        after: 'Cancelada',
        status: 'pending',
        reason: null,
      },
    ],
    total: 1,
    next_cursor: null,
  },
  progress: { done: 0, total: 1, failed: 0 },
  requested_by: bruna,
  approver: null,
  expires_at: '2026-10-16T12:24:00.000Z',
  undo_deadline: null,
  version: 1,
  can_confirm: true,
  can_undo: false,
  blocked_reason: null,
  created_at: FIXTURE_NOW,
};

/** A5 bloqueio por papel: a Paula (atendente) pediu para cancelar a campanha. */
export const fixtureProposalBlockedCancel: ProposalDTO = {
  ...fixtureProposalCancelCampaign,
  id: FIXTURE_IDS.proposals.blockedCancel,
  status: 'blocked',
  policy_checks: null,
  requested_by: paula,
  expires_at: null,
  can_confirm: false,
  blocked_reason: 'role',
};

// ─── Eventos SSE: o roteiro "mover parados" (A4) ─────────────────────────────

export const fixtureStreamMoveIdle: readonly CopilotStreamEvent[] = [
  {
    v: 1,
    type: 'turn_started',
    turn_id: FIXTURE_IDS.turn,
    session_id: FIXTURE_IDS.session,
    message_id: FIXTURE_IDS.messages.answer,
    context_label: 'Vendo: Pipeline · Orçamento enviado',
  },
  { v: 1, type: 'status', phase: 'reading', label: 'Lendo o pipeline…' },
  { v: 1, type: 'tool_result', ...fixtureCardDealListIdle },
  { v: 1, type: 'verdict_delta', text: '7 negócios estão parados em Orçamento enviado ' },
  { v: 1, type: 'verdict_delta', text: 'e somam R$ 38.500 da previsão do mês.' },
  { v: 1, type: 'status', phase: 'acting', label: 'Preparando a movimentação…' },
  { v: 1, type: 'action_proposed', proposal: fixtureProposalMoveIdle },
  { v: 1, type: 'final', message_id: FIXTURE_IDS.messages.answer, blocks: fixtureAnswerIdle },
];

/** Os demais eventos públicos, um de cada, para o mock e os testes de leitor SSE. */
export const fixtureStreamOthers: readonly CopilotStreamEvent[] = [
  {
    v: 1,
    type: 'action_receipt',
    proposal_id: FIXTURE_IDS.proposals.tagReceipt,
    risk_level: 2,
    summary: 'Tag "Indicação" adicionada a Maria Souza',
    undo_until: '2026-10-17T12:14:00.000Z',
  },
  {
    v: 1,
    type: 'action_blocked',
    proposal_id: FIXTURE_IDS.proposals.blockedCancel,
    reason: 'role',
    capability: 'campaign.cancel',
    can_request_approval: true,
    message: 'Seu papel não pode cancelar campanhas.',
  },
  { v: 1, type: 'budget_exceeded', mode: 'queries_only', resets_on: '2026-11-01' },
  { v: 1, type: 'error', code: 'timeout', ref: 'hm_err_7f3a91c2' },
];

// ─── Sessão e histórico ──────────────────────────────────────────────────────

export const fixtureSession: CopilotSession = {
  id: FIXTURE_IDS.session,
  title: 'Negócios parados em Orçamento enviado',
  origin: 'docked',
  created_at: '2026-10-16T12:13:40.000Z',
  updated_at: FIXTURE_NOW,
  archived_at: null,
};

export const fixtureMessages: readonly CopilotMessage[] = [
  {
    id: FIXTURE_IDS.messages.question,
    role: 'user',
    content: 'Quais negócios estão parados em Orçamento enviado?',
    blocks: null,
    tool_results: null,
    proposal_id: null,
    created_at: '2026-10-16T12:13:58.000Z',
  },
  {
    id: FIXTURE_IDS.messages.answer,
    role: 'assistant',
    content: fixtureAnswerIdle.verdict,
    blocks: fixtureAnswerIdle,
    tool_results: [fixtureCardDealListIdle],
    proposal_id: FIXTURE_IDS.proposals.moveIdle,
    created_at: FIXTURE_NOW,
  },
];

// ─── Atividade (A8) ──────────────────────────────────────────────────────────

const activityPartial: ActivityEntry = {
  id: FIXTURE_IDS.proposals.moveIdlePartial,
  at: '2026-10-16T12:16:00.000Z',
  source: 'copilot',
  requested_by: bruna,
  executed_as: bruna,
  approver: null,
  capability: 'deal.move',
  risk_level: 3,
  status: 'partially_completed',
  summary: 'Moveu 5 de 7 negócios para Reativação',
  counts: { total: 7, done: 5, skipped: 2, failed: 0, undone: 0 },
  can_undo: true,
  undo_deadline: '2026-10-17T12:16:00.000Z',
  blocked_reason: null,
};

const activityBlocked: ActivityEntry = {
  id: FIXTURE_IDS.proposals.blockedCancel,
  at: '2026-10-16T11:02:00.000Z',
  source: 'copilot',
  requested_by: paula,
  executed_as: null,
  approver: bruna,
  capability: 'campaign.cancel',
  risk_level: 4,
  status: 'awaiting_approval',
  summary: 'Cancelar a campanha "Clareamento de Outubro" · pedido enviado a Bruna para aprovar',
  counts: { total: 1, done: 0, skipped: 0, failed: 0, undone: 0 },
  can_undo: false,
  undo_deadline: null,
  blocked_reason: 'role',
};

const activityAutopilot: ActivityEntry = {
  id: fid('9', 7),
  at: '2026-10-16T12:05:00.000Z',
  source: 'autopilot',
  requested_by: bruna,
  executed_as: bruna,
  approver: null,
  capability: 'deal.move',
  risk_level: 3,
  status: 'completed',
  summary: 'Piloto automático: 3 negócios movidos para Reativação (aprovado por Bruna)',
  counts: { total: 3, done: 3, skipped: 0, failed: 0, undone: 0 },
  can_undo: true,
  undo_deadline: '2026-10-23T12:05:00.000Z',
  blocked_reason: null,
};

export const fixtureActivityPage: ActivityPage = {
  data: [activityPartial, activityAutopilot, activityBlocked],
  next_cursor: null,
};

export const fixtureApprovers: readonly Approver[] = [
  { member_id: M.bruna, name: 'Bruna Lima', role: 'ADMIN' },
  { member_id: M.carlos, name: 'Dr. Carlos Mendes', role: 'OWNER' },
];

// ─── Briefing do dia (A2) ────────────────────────────────────────────────────

export const fixtureBriefing: Briefing = {
  id: FIXTURE_IDS.briefing,
  for_date: TODAY,
  generated_at: BRIEFING_AT,
  data_as_of: BRIEFING_AT,
  status: 'ready',
  currency: 'BRL',
  items: [
    {
      id: 'deals_idle:orcamento',
      kind: 'deals_idle',
      priority: 'high',
      title: '7 negócios sem resposta há 7+ dias em Orçamento enviado',
      value_at_risk: FIXTURE_IDLE_TOTAL_BRL,
      why: ['R$ 38.500 em 7 negócios', 'Parados há 10 dias em média', 'Em Orçamento enviado, 41% fecham'],
      as_of: BRIEFING_AT,
      source: 'Pipeline Tratamentos',
      action: { kind: 'ask', value: 'Mover os 7 parados para Reativação', label: 'Mover para Reativação' },
    },
    {
      id: 'events_today',
      kind: 'events_today',
      priority: 'medium',
      title: '12 pacientes com consulta amanhã ainda não confirmaram',
      value_at_risk: 14200,
      why: ['12 consultas em 17/10 sem confirmação', 'R$ 14.200 em negócios ligados a elas'],
      as_of: BRIEFING_AT,
      source: 'Agenda da clínica',
      action: { kind: 'ask', value: 'Mandar lembrete aos 12 pacientes de amanhã', label: 'Enviar lembrete' },
    },
    {
      id: 'campaign_issue:clareamento',
      kind: 'campaign_issue',
      priority: 'low',
      title: 'Campanha "Clareamento de Outubro" com 14 falhas de envio',
      value_at_risk: 187.4,
      why: ['512 de 840 enviadas', '14 falharam', 'R$ 187,40 já usados'],
      as_of: BRIEFING_AT,
      source: 'Campanhas',
      action: { kind: 'navigate', value: `/campaigns/${FIXTURE_IDS.campaign}`, label: 'Ver campanha' },
    },
  ],
  overflow_count: 2,
  resolved_count: 0,
  seen_at: null,
};

// ─── Memória do negócio (A10) ────────────────────────────────────────────────

export const fixtureMemoryProfile: MemoryProfile = {
  entries: [
    {
      key: 'what_we_sell',
      content: 'Clínica odontológica: alinhadores, implantes, lentes de contato dental, clareamento e próteses.',
      updated_at: '2026-10-02T15:00:00.000Z',
      updated_by: bruna,
    },
    {
      key: 'avg_ticket',
      content: 'Ticket médio de R$ 5.500; alinhadores entre R$ 5.000 e R$ 8.000.',
      updated_at: '2026-10-02T15:00:00.000Z',
      updated_by: bruna,
    },
    { key: 'tone', content: 'Próximo e cuidadoso, sem jargão clínico.', updated_at: '2026-10-02T15:00:00.000Z', updated_by: bruna },
    { key: 'hours', content: 'Segunda a sexta, 8h às 19h; sábado, 8h às 12h.', updated_at: '2026-10-02T15:00:00.000Z', updated_by: bruna },
    { key: 'commercial_rules', content: null, updated_at: null, updated_by: null },
  ],
};

export const fixtureMemoryFacts: readonly MemoryFact[] = [
  {
    id: fid('4', 1),
    content: 'Parcelamos alinhadores em até 12 vezes sem juros.',
    source_type: 'member',
    source_label: 'Escrito por Bruna Lima',
    status: 'active',
    created_by: bruna,
    created_at: '2026-10-03T13:00:00.000Z',
    updated_at: '2026-10-03T13:00:00.000Z',
    forgotten_at: null,
    can_restore: false,
  },
  {
    id: fid('4', 2),
    content: 'Avaliação inicial é gratuita.',
    source_type: 'copilot',
    source_label: 'Pedido de Paula Reis ao Copiloto em 10/10',
    status: 'active',
    created_by: paula,
    created_at: '2026-10-10T17:20:00.000Z',
    updated_at: '2026-10-10T17:20:00.000Z',
    forgotten_at: null,
    can_restore: false,
  },
  {
    id: fid('4', 3),
    content: 'Desconto de 10% para pagamento à vista.',
    source_type: 'member',
    source_label: 'Escrito por Bruna Lima',
    status: 'forgotten',
    created_by: bruna,
    created_at: '2026-09-20T13:00:00.000Z',
    updated_at: '2026-10-16T11:50:00.000Z',
    forgotten_at: '2026-10-16T11:50:00.000Z',
    can_restore: true,
  },
];

export const fixtureMemorySources: readonly MemorySource[] = [
  { key: 'knowledge', label: 'Conhecimento', status: 'ok', detail: '14 documentos' },
  { key: 'products', label: 'Produtos', status: 'ok', detail: '9 tratamentos no catálogo' },
  { key: 'pipeline', label: 'Pipeline', status: 'ok', detail: 'Tratamentos' },
  { key: 'inbox', label: 'Inbox', status: 'warn', detail: 'Instagram desconectado há 2 dias' },
];

// ─── Configurações e /me (A11) ───────────────────────────────────────────────

export const fixtureSettings: CopilotSettings = {
  enabled: true,
  capability_matrix: {
    AGENT: { 'campaign.pause': false, 'flow.trigger': false },
    READONLY: { use: false },
  },
  monthly_budget_usd: 30,
  budget_mode: 'queries_only',
  budget_alert_pct: 80,
  history_retention_months: 12,
  default_auto_open: 'daily',
  partner_access: false,
  model: null,
  updated_by: bruna,
  updated_at: '2026-10-10T14:00:00.000Z',
};

/** /me da Bruna (ADMIN, "Gestora comercial"), que vê custo. */
export const fixtureMeAdmin: CopilotMe = {
  available: true,
  unavailable_reason: null,
  role: 'ADMIN',
  role_label: 'Gestora comercial',
  capabilities: effectiveCapabilities('ADMIN', fixtureSettings.capability_matrix),
  permissions: {
    manage: true,
    view_costs: true,
    memory_edit: true,
    activity_view_all: true,
    autopilot_manage: true,
  },
  read_only: false,
  prefs: {
    auto_open: 'daily',
    auto_open_source: 'workspace',
    surface: 'docked',
    briefing_last_seen_on: '2026-10-15',
    first_use_hint_seen: true,
  },
  budget: { state: 'ok', resets_on: '2026-11-01', spent_usd: 11.42, cap_usd: 30 },
};

/** /me da Paula (AGENT): sem custo, sem "Todas" na Atividade, sem cancelar campanha. */
export const fixtureMeAgent: CopilotMe = {
  available: true,
  unavailable_reason: null,
  role: 'AGENT',
  role_label: 'Atendente',
  capabilities: effectiveCapabilities('AGENT', fixtureSettings.capability_matrix),
  permissions: {
    manage: false,
    view_costs: false,
    memory_edit: false,
    activity_view_all: false,
    autopilot_manage: false,
  },
  read_only: false,
  prefs: {
    auto_open: 'never',
    auto_open_source: 'member',
    surface: 'bubble',
    briefing_last_seen_on: null,
    first_use_hint_seen: false,
  },
  budget: { state: 'ok', resets_on: '2026-11-01' },
};

// ─── Piloto automático (A9) ──────────────────────────────────────────────────

export const fixtureSuggestions: readonly Suggestion[] = IDLE_DEALS.slice(0, 3).map(
  (d, i): Suggestion => ({
    id: fid('6', d.n),
    deal: {
      deal_id: fid('d', d.n),
      title: d.treatment,
      contact_name: d.patient,
      value: d.value,
      currency: 'BRL',
    },
    from_stage: { stage_id: S.orcamento, name: 'Orçamento enviado' },
    to_stage: { stage_id: S.reativacao, name: 'Reativação' },
    reason_code: 'idle_last_outbound',
    reason_text: `Sem resposta há ${d.idle} dias; a última mensagem foi nossa, em 0${7 - i}/10`,
    confidence: i === 0 ? 'high' : i === 1 ? 'medium' : 'low',
    status: 'pending',
    proposal_id: null,
    decided_by: null,
    decided_at: null,
    created_at: '2026-10-16T11:00:00.000Z',
  }),
);

export const fixtureAutopilotRules: readonly AutopilotRule[] = [
  {
    stage_id: S.orcamento,
    stage_name: 'Orçamento enviado',
    pipeline_id: FIXTURE_IDS.pipeline,
    mode: 'daily_approval',
    criteria: { idle_days: 7, target_stage_id: S.reativacao, require_last_outbound: true },
    daily_limit: 10,
    enabled_by: bruna,
    enabled_at: '2026-10-10T14:00:00.000Z',
    updated_at: '2026-10-10T14:00:00.000Z',
  },
  {
    stage_id: S.negociacao,
    stage_name: 'Negociação',
    pipeline_id: FIXTURE_IDS.pipeline,
    mode: 'suggest',
    criteria: { idle_days: 5, target_stage_id: S.reativacao, require_last_outbound: false },
    daily_limit: 10,
    enabled_by: bruna,
    enabled_at: '2026-10-10T14:00:00.000Z',
    updated_at: '2026-10-10T14:00:00.000Z',
  },
];

// ─── Uso e custo ─────────────────────────────────────────────────────────────

export const fixtureUsage: CopilotUsage = {
  month: '2026-10',
  resets_on: '2026-11-01',
  spent_usd: 11.42,
  cap_usd: 30,
  pct: 38.07,
  budget_mode: 'queries_only',
  state: 'ok',
  daily: [
    { date: '2026-10-14', cost_usd: 0.92, turns: 31 },
    { date: '2026-10-15', cost_usd: 1.18, turns: 40 },
    { date: '2026-10-16', cost_usd: 0.41, turns: 14 },
  ],
  top_members: [
    { member_id: M.bruna, name: 'Bruna Lima', cost_usd: 5.1, turns: 162 },
    { member_id: M.paula, name: 'Paula Reis', cost_usd: 3.87, turns: 131 },
    { member_id: M.rafael, name: 'Rafael Costa', cost_usd: 2.45, turns: 88 },
  ],
  turns: 381,
  actions_by_risk: [
    { risk_level: 2, count: 44 },
    { risk_level: 3, count: 12 },
    { risk_level: 4, count: 3 },
  ],
};

// ─── Bodies de request ───────────────────────────────────────────────────────

export const fixtureAskBody: AskInput = {
  text: 'Quais negócios estão parados em Orçamento enviado?',
  page_context: fixturePageContextBoard,
  client_request_id: fid('7', 1),
  origin: 'docked',
};

export const fixtureConfirmBody: ConfirmProposalInput = { version: 1 };
export const fixtureConfirmLevel4Body: ConfirmProposalInput = { version: 1, acknowledged: true };
export const fixtureAdjustBody: AdjustProposalInput = {
  version: 1,
  exclude_item_ids: [fid('1', 3)],
  params: { notify_members: false },
};
export const fixtureRequestApprovalBody: RequestApprovalInput = { approver_member_id: M.bruna };
export const fixtureDecideSuggestionsBody: DecideSuggestionsInput = {
  ids: [fid('6', 1), fid('6', 2)],
  decision: 'approve',
};

// ─── Contrato interno (API ↔ runtime) ────────────────────────────────────────

export const fixtureRunRequest: CopilotRunRequest = {
  turn_id: FIXTURE_IDS.turn,
  workspace_id: FIXTURE_IDS.workspace,
  grant: 'eyJ2IjoxfQ.c2lnbmF0dXJh',
  member: {
    display_name: 'Bruna Lima',
    role_label: 'Gestora comercial',
    locale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
  },
  now_iso: FIXTURE_NOW,
  page_context_resolved: { label: 'Pipeline · Orçamento enviado', entity_summary: '17 negócios no estágio' },
  history: [],
  memory: {
    profile: [{ key: 'what_we_sell', content: 'Clínica odontológica: alinhadores, implantes e clareamento.' }],
    facts: [
      { id: fid('4', 1), content: 'Parcelamos alinhadores em até 12 vezes sem juros.', source_label: 'Escrito por Bruna Lima' },
      { id: fid('4', 9), content: 'Tabela de preços 2026 vigente.', source_label: 'Integração: ERP', untrusted: true },
    ],
  },
  tools: [
    {
      key: 'list_deals',
      description: 'Lista negócios do pipeline com filtros. Use para perguntas sobre negócios.',
      parameters: {
        type: 'object',
        properties: { stage_ids: { type: 'array', items: { type: 'string' } }, idle_days_gte: { type: 'integer' } },
        additionalProperties: false,
      },
    },
  ],
  policy: {
    model: 'anthropic/claude-sonnet',
    max_iterations: 8,
    max_tool_calls: 16,
    max_tokens_per_call: 2048,
    temperature: 0.2,
    turn_timeout_s: 60,
  },
  user_input: 'Quais negócios estão parados em Orçamento enviado?',
};

export const fixtureToolCallBody: CopilotToolCallBody = {
  turn_id: FIXTURE_IDS.turn,
  call_id: 'call_01',
  args: { stage_ids: [S.orcamento], idle_days_gte: 7 },
};

export const fixtureToolEnvelope: CopilotToolEnvelope = {
  ok: true,
  decision: 'executed',
  result_id: 'r_idle_deals',
  model_view: {
    total: 7,
    total_value_brl: FIXTURE_IDLE_TOTAL_BRL,
    deals: IDLE_DEALS.map((d) => ({ id: fid('d', d.n), value: d.value, idle_days: d.idle })),
  },
  public_event: { v: 1, type: 'tool_result', ...fixtureCardDealListIdle },
};

export const fixtureRuntimeEvents: readonly CopilotRuntimeEvent[] = [
  { type: 'status', tool_key: 'list_deals' },
  { type: 'tool_call_completed', tool_key: 'list_deals', call_id: 'call_01', envelope: fixtureToolEnvelope },
  { type: 'verdict_delta', text: '7 negócios estão parados em Orçamento enviado ' },
  { type: 'verdict_delta', text: 'e somam R$ 38.500 da previsão do mês.' },
  {
    type: 'final',
    blocks: fixtureAnswerIdle,
    usage: { prompt_tokens: 3120, completion_tokens: 284, total_cost_usd: 0.0137 },
    iterations: 2,
  },
];

/** Turno que estourou iterações e caiu no formato de reserva. */
export const fixtureRuntimeEventsFallback: readonly CopilotRuntimeEvent[] = [
  { type: 'iteration_exceeded' },
  {
    type: 'final',
    blocks: { verdict: 'Não consegui concluir a consulta agora.', why: [], data_refs: [], sources: [], next_steps: [] },
    usage: { prompt_tokens: 9800, completion_tokens: 610, total_cost_usd: null },
    iterations: 8,
    format_fallback: true,
  },
  { type: 'error', code: 'iteration_limit' },
];
