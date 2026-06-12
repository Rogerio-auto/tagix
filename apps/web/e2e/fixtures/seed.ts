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
      value: { total: 42 },
      drillHref: null,
    },
  ],
  alerts: [] as unknown[],
  layoutPreferences: { hidden: [] as string[], order: [] as string[], period: null },
} as const;
