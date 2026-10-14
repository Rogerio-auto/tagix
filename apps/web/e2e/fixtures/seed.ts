/**
 * Seed determinístico para a jornada e2e (F10-S03).
 *
 * Tudo aqui espelha os contratos JSON públicos das features (lidos dos `queries.ts`
 * e `types.ts` reais — NÃO inventado). Um único workspace/tenant, um membro OWNER
 * (role com todas as permissões, então toda a nav e todos os botões aparecem) e os
 * objetos mínimos para a jornada: 1 canal, 1 conversa, 1 pipeline com 3 stages,
 * 1 deal, 1 flow manual ativo.
 *
 * Estes tipos são propositalmente locais (cópia mínima do shape de wire) para o
 * pacote e2e não importar de `features/**` (fronteira de arquivos do slot) e ainda
 * tipar 100% sem `any`.
 */

export const SESSION_COOKIE = 'hm_session';

export const ME = {
  member: {
    id: 'mem_owner_e2e',
    workspaceId: 'ws_e2e',
    name: 'Ana QA',
    role: 'OWNER',
  },
  workspace: { id: 'ws_e2e' },
} as const;

export const CHANNEL = {
  id: 'chan_wa_e2e',
  provider: 'meta_whatsapp',
  name: 'WhatsApp Vendas',
  displayHandle: '+55 11 99999-0000',
  phoneNumber: '+5511999990000',
  igUsername: null,
  igAccountType: null,
  wahaSessionId: null,
  isActive: true,
  isDefault: true,
  createdAt: '2026-06-12T12:00:00.000Z',
  updatedAt: null,
} as const;

export const CONVERSATION = {
  id: 'conv_e2e_1',
  contactId: 'contact_e2e_1',
  channelId: CHANNEL.id,
  remoteId: '5511988887777',
  kind: 'whatsapp',
  status: 'open',
  aiMode: 'on',
  assignedTo: ME.member.id,
  lastMessagePreview: 'Oi, quero saber sobre o plano.',
  lastMessageAt: '2026-06-12T13:00:00.000Z',
  lastMessageFrom: 'contact',
  unreadCount: 1,
} as const;

/** Estado de janela 24h: aberta → composer livre (não exige template). */
export const WINDOW_OPEN = {
  provider: 'meta_whatsapp',
  isOpen: true,
  expiresAt: '2026-06-13T13:00:00.000Z',
  requiresTemplate: false,
  messageTag: null,
} as const;

/** Mensagem inbound inicial do contato (a conversa já tem histórico). */
export const INBOUND_MESSAGE = {
  id: 'msg_inbound_1',
  conversationId: CONVERSATION.id,
  direction: 'inbound',
  senderType: 'contact',
  type: 'text',
  content: 'Oi, quero saber sobre o plano.',
  viewStatus: 'delivered',
  mediaUrl: null,
  createdAt: '2026-06-12T13:00:00.000Z',
} as const;

/** Resposta determinística que o "agente IA" devolve após o envio do atendente. */
export const AGENT_REPLY = {
  id: 'msg_agent_reply_1',
  conversationId: CONVERSATION.id,
  direction: 'outbound',
  senderType: 'agent',
  type: 'text',
  content: 'Claro! Nosso plano Pro custa R$ 199/mês. Posso te enviar os detalhes?',
  viewStatus: 'sent',
  mediaUrl: null,
  createdAt: '2026-06-12T13:01:30.000Z',
} as const;

/** Flow manual ATIVO — aparece na quickbar acima do composer (gated por flow.trigger). */
export const MANUAL_FLOW = {
  id: 'flow_e2e_welcome',
  name: 'Enviar catálogo',
  status: 'active',
  triggerType: 'manual',
  manualPosition: 0,
} as const;

export const PIPELINE = {
  id: 'pipe_e2e',
  name: 'Vendas',
  description: 'Pipeline de vendas',
  industry: 'generic',
  isDefault: true,
  isActive: true,
  settings: { custom_fields: [] as unknown[] },
} as const;

export const STAGES = [
  {
    id: 'stage_lead',
    pipelineId: PIPELINE.id,
    name: 'Lead',
    color: '#7c3aed',
    icon: null,
    position: 0,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [] as unknown[],
    transitionRules: {},
  },
  {
    id: 'stage_negotiation',
    pipelineId: PIPELINE.id,
    name: 'Negociação',
    color: '#2563eb',
    icon: null,
    position: 1,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [] as unknown[],
    transitionRules: {},
  },
  {
    id: 'stage_won',
    pipelineId: PIPELINE.id,
    name: 'Ganho',
    color: '#16a34a',
    icon: null,
    position: 2,
    isWon: true,
    isLost: false,
    probability: null,
    automationRules: [] as unknown[],
    transitionRules: {},
  },
] as const;

export const DEAL = {
  id: 'deal_e2e_1',
  pipelineId: PIPELINE.id,
  stageId: STAGES[0].id,
  contactId: CONVERSATION.contactId,
  title: 'Negócio com Ana',
  valueCents: 19900,
  currency: 'BRL',
  ownerId: ME.member.id,
  position: 0,
  customFields: {} as Record<string, unknown>,
  closedAt: null,
  closedWon: null,
} as const;

/** Dashboard payload mínimo (server-driven, role-aware). Um card stat basta. */
export const DASHBOARD = {
  role: 'OWNER',
  cards: [
    {
      key: 'volume_inbound_24h',
      label: 'Mensagens recebidas (24h)',
      category: 'atendimento',
      cardType: 'stat',
      cadence: 'snapshot_5min',
      // `count` é o campo que `formatMetricDisplay` lê num card `stat` (com `total` o
      // Painel completo mostrava "—").
      value: { count: 42 },
      drillHref: null,
    },
  ],
  alerts: [] as unknown[],
  layoutPreferences: { hidden: [] as string[], order: [] as string[], period: null },
} as const;

/**
 * Tours guiados do shell (`shared/components/tour/content/tours.tsx`, F43-S07).
 * Cópia dos ids: o tour abre sozinho na primeira visita a `/`, `/conversations`,
 * `/pipeline`, `/agents` e `/flows` e cobre a tela com um spotlight modal.
 */
export const TOUR_IDS = [
  'tour:dashboard',
  'tour:inbox',
  'tour:pipeline',
  'tour:agents',
  'tour:flows',
] as const;

/**
 * `GET /api/onboarding/state` de um workspace já verticalizado cujo membro já
 * dispensou os tours (F70-S29). Antes caía no fallback `{}`: cada spec abria por
 * baixo do tour de primeira visita, com o spotlight e o painel de ajuda tapando a
 * tela. O cenário destes specs é o de quem usa o produto todo dia, não o first-run.
 */
export const ONBOARDING_STATE = {
  onboarding: {
    niche_key: 'agency',
    applied_at: '2026-06-12T12:00:00.000Z',
    survey: null,
    setup_completed: true,
  },
  tourState: Object.fromEntries(TOUR_IDS.map((id) => [id, { dismissed: true }])),
} as const;

/**
 * `GET /api/onboarding/checklist` de quem já concluiu os primeiros passos (F43-S06):
 * todos `done`, então o widget "Primeiros passos" some da Home. Explícito, em vez de
 * depender do fallback `{}`: o cenário destes specs é o do uso diário.
 */
export const ONBOARDING_CHECKLIST_DONE = {
  steps: [
    { key: 'connect_channel', label: 'Conectar o WhatsApp', done: true, href: '/settings/channels' },
    { key: 'activate_agent', label: 'Ativar um agente', done: true, href: '/agents' },
    { key: 'publish_flow', label: 'Publicar um fluxo', done: true, href: '/flows' },
  ],
} as const;

/** Receita atribuída da janela atual do OWNER (centavos). KPI e série dizem o mesmo. */
const HOME_REVENUE_CENTS = 18_420_000;

/**
 * Série diária de receita que soma EXATAMENTE o KPI (o servidor garante essa
 * igualdade: a série e o total saem da mesma consulta). Forma determinística e
 * crescente, com respiro a cada 4 dias, a "linha que sobe" da maquete; o arredondamento
 * acumulado cai no último dia.
 */
function revenueSeries(totalCents: number, days: number): { day: string; valueCents: number }[] {
  const weights = Array.from(
    { length: days },
    (_, i) => (120_000 + i * 18_000) * (i % 4 === 0 ? 0.6 : 1),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w, i) => {
    const valueCents = i === days - 1 ? totalCents - acc : Math.round((w / sum) * totalCents);
    acc += valueCents;
    return {
      day: new Date(Date.UTC(2026, 4, 13 + i)).toISOString().slice(0, 10),
      valueCents,
    };
  });
}

/**
 * `GET /api/dashboard/home` de um OWNER (F72-S04 — contrato em
 * `apps/api/src/services/dashboard/home-model.ts`). Escopo `workspace`: resultado com
 * janela anterior, jornada e série de receita. Sem isto a Home caía no fallback `{}`.
 * Specs que precisam do recorte de AGENT (`scope: 'personal'`) sobrescrevem a rota.
 */
export const HOME_OWNER = {
  scope: 'workspace',
  role: 'OWNER',
  periodDays: 30,
  window: {
    from: '2026-05-13T12:00:00.000Z',
    to: '2026-06-12T12:00:00.000Z',
    previousFrom: '2026-04-13T12:00:00.000Z',
    previousTo: '2026-05-13T12:00:00.000Z',
  },
  thresholds: { slaMinutes: 15, slaSource: 'default', stalledDays: 7, mediaFailedDays: 7 },
  kpis: [
    {
      key: 'revenue',
      unit: 'cents',
      value: HOME_REVENUE_CENTS,
      previous: 15_560_000,
      betterWhen: 'higher',
      href: '/conversions',
      sample: null,
    },
    {
      key: 'leads',
      unit: 'count',
      value: 89,
      previous: 78,
      betterWhen: 'higher',
      href: '/contacts',
      sample: null,
    },
    {
      key: 'speed_to_lead',
      unit: 'seconds',
      value: 41,
      previous: 59,
      betterWhen: 'lower',
      href: '/conversations',
      sample: { answered: 84, unanswered: 5 },
    },
    {
      key: 'conversions',
      unit: 'count',
      value: 31,
      previous: 27,
      betterWhen: 'higher',
      href: '/conversions',
      sample: null,
    },
  ],
  attention: [
    {
      kind: 'waiting_sla',
      severity: 'warning',
      count: 1,
      oldestMinutes: 22,
      href: `/conversations/${CONVERSATION.id}`,
      targetId: CONVERSATION.id,
    },
    {
      kind: 'deals_stalled',
      severity: 'warning',
      count: 1,
      oldestMinutes: null,
      href: '/pipeline',
      targetId: DEAL.id,
    },
  ],
  journey: { leads: 89, conversations: 74, booked: 31, won: 12 },
  revenueSeries: revenueSeries(HOME_REVENUE_CENTS, 31),
  serverTime: '2026-06-12T12:00:00.000Z',
} as const;

/**
 * `GET /api/dashboard/today` (fila "Aguardando resposta" + agenda do dia). A conversa
 * do seed espera há 22 min (faixa "atenção"). `month` é `null` para AGENT/READONLY.
 */
export const TODAY = {
  waiting: [
    {
      conversationId: CONVERSATION.id,
      contactId: CONVERSATION.contactId,
      contactName: 'Ana Souza',
      preview: CONVERSATION.lastMessagePreview,
      waitingSince: '2026-06-12T11:38:00.000Z',
      waitingMinutes: 22,
      channel: 'whatsapp',
      urgency: 'atencao',
    },
  ],
  waitingTotal: 1,
  waitingBands: { esfriando: 0, atencao: 1, agora: 0 },
  appointments: [
    {
      id: 'appt_e2e_1',
      title: 'Avaliação',
      startsAt: '2026-06-12T17:00:00.000Z',
      contactName: 'Ana Souza',
    },
  ],
  month: {
    leads: 89,
    leadsPrevious: 78,
    appointments: 31,
    appointmentsPrevious: 27,
    conversations: 74,
    conversationsPrevious: 70,
  },
  serverTime: '2026-06-12T12:00:00.000Z',
} as const;
