/**
 * Contratos públicos do Copiloto (COPILOTO.md §5): contexto de página, eventos SSE, DTOs e
 * bodies de request. Fonte única entre `apps/api` (valida a entrada e monta a saída) e
 * `apps/web` (valida cada resposta e cada frame SSE; o cliente mock da F74 usa os mesmos
 * schemas sobre as fixtures).
 *
 * Convenções:
 * - snake_case em todo campo que cruza a rede (o runtime Python espelha o contrato interno).
 * - Todo objeto é `.strict()`. Na entrada, isso é segurança: identidade, workspace e campos
 *   inesperados nunca entram por `args` ou body (ADR-003 §3). Na saída, é detecção de deriva:
 *   API e web sobem juntas, e um campo a mais é contrato divergente, não "compatibilidade".
 *   As poucas exceções toleram e dizem por quê no próprio campo.
 * - Datas são strings ISO 8601 (`as_of`, `expires_at`…), nunca `Date`: o contrato precisa
 *   sobreviver a `JSON.parse(JSON.stringify(x))` sem perder nada.
 * - Dinheiro é número em unidades da moeda (R$ 38.500 → 38500) com `currency` ISO 4217 no
 *   contêiner. A exceção é `forecast_delta_brl`, nome travado pela spec.
 * - Mudança aqui exige nota no slot que mudou e aviso em `tasks/COMMS.md` (F73-S02 §Contratos).
 */
import { z } from 'zod';
import { ROLES } from '../permissions';
import { CAPABILITY_KEYS, type CapabilityKey } from './capabilities';
import { RISK_LEVELS } from './risk';
import {
  COPILOT_ACTION_ITEM_STATUSES,
  COPILOT_ACTION_TARGET_TYPES,
  COPILOT_AUTO_OPEN_MODES,
  COPILOT_AUTOPILOT_MODES,
  COPILOT_BLOCKED_REASONS,
  COPILOT_BRIEFING_STATUSES,
  COPILOT_BUDGET_MODES,
  COPILOT_HISTORY_RETENTION_MONTHS,
  COPILOT_MEMORY_PROFILE_KEYS,
  COPILOT_MEMORY_SOURCE_TYPES,
  COPILOT_MEMORY_STATUSES,
  COPILOT_MESSAGE_ROLES,
  COPILOT_PROPOSAL_SOURCES,
  COPILOT_PROPOSAL_STATUSES,
  COPILOT_SESSION_ORIGINS,
  COPILOT_SUGGESTION_CONFIDENCES,
  COPILOT_SUGGESTION_STATUSES,
  COPILOT_SURFACES,
} from './statuses';

// ─── Primitivos ──────────────────────────────────────────────────────────────

export const UuidSchema = z.string().uuid();
/** Instante ISO 8601 com fuso (`2026-10-16T09:14:00.000Z`). */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
/** Data civil (`2026-10-16`). */
export const IsoDateSchema = z.string().date();
/** ISO 4217 (`BRL`, `USD`). */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'moeda ISO 4217');
/** Id de resultado de ferramenta, gerado pelo Node (P5: o modelo só referencia). */
export const ResultIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'result_id inválido');
/** Cursor opaco de paginação. */
export const CursorSchema = z.string().min(1).max(512);
export const RoleSchema = z.enum(ROLES);
export const CapabilityKeySchema = z.enum(CAPABILITY_KEYS);
export const RiskLevelSchema = z.union([
  z.literal(RISK_LEVELS[0]),
  z.literal(RISK_LEVELS[1]),
  z.literal(RISK_LEVELS[2]),
  z.literal(RISK_LEVELS[3]),
]);
export const ProposalStatusSchema = z.enum(COPILOT_PROPOSAL_STATUSES);
export const ItemStatusSchema = z.enum(COPILOT_ACTION_ITEM_STATUSES);
export const SessionOriginSchema = z.enum(COPILOT_SESSION_ORIGINS);
export const AutoOpenSchema = z.enum(COPILOT_AUTO_OPEN_MODES);
// Tipos dos primitivos de enum: `CapabilityKey` (capabilities), `RiskLevel` (risk),
// `Role` (permissions) e `Copilot*Status`/`CopilotSessionOrigin`/`CopilotAutoOpenMode`/
// `CopilotBudgetMode`/`CopilotHistoryRetentionMonths` (statuses) são os `z.infer` destes
// schemas por construção (os schemas são gerados das mesmas constantes).
export const BudgetModeSchema = z.enum(COPILOT_BUDGET_MODES);
/** 6, 12 ou 24 meses: os mesmos números do `check` do banco. */
export const HistoryRetentionMonthsSchema = z.union([
  z.literal(COPILOT_HISTORY_RETENTION_MONTHS[0]),
  z.literal(COPILOT_HISTORY_RETENTION_MONTHS[1]),
  z.literal(COPILOT_HISTORY_RETENTION_MONTHS[2]),
]);

const nonNegInt = z.number().int().nonnegative();
const money = z.number().finite();
const shortText = (max: number) => z.string().min(1).max(max);

/** Membro como aparece na tela: id + nome. Nunca e-mail ou telefone. */
export const MemberRefSchema = z
  .object({ member_id: UuidSchema, name: shortText(120) })
  .strict();
export type MemberRef = z.infer<typeof MemberRefSchema>;

/**
 * Rota interna (R4: links só internos). Começa com `/`, sem `//` (URL de protocolo
 * relativo), sem `\` e sem esquema. Link externo vindo do modelo vira texto na interface.
 */
export const InternalRouteSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\/(?!\/)[^\s\\]*$/, 'rota interna inválida');
export type InternalRoute = z.infer<typeof InternalRouteSchema>;

/** Página por cursor. */
export function cursorPage<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), next_cursor: CursorSchema.nullable() }).strict();
}

// ─── §5.1 Contexto de página ─────────────────────────────────────────────────

export const PAGE_CONTEXT_ENTITY_TYPES = [
  'deal',
  'contact',
  'conversation',
  'campaign',
  'event',
  'pipeline',
  'stage',
] as const;
export const PAGE_CONTEXT_SELECTION_TYPES = ['deal', 'contact', 'conversation'] as const;
export const PAGE_CONTEXT_VIEWS = ['board', 'list', 'detail'] as const;
/** Máximo de ids na seleção múltipla. */
export const PAGE_CONTEXT_SELECTION_MAX = 50;

/**
 * Dica, não autorização: a API re-resolve cada id sob o escopo do membro e descarta o que
 * ele não vê. O rótulo do chip é calculado no servidor (`turn_started.context_label`).
 */
export const CopilotPageContextSchema = z
  .object({
    /** Padrão da rota, não a URL: `/pipeline`, `/conversations/[id]`, `/hoje`. */
    route: z
      .string()
      .min(1)
      .max(120)
      .regex(/^\/[A-Za-z0-9_\-/[\].]*$/, 'padrão de rota inválido'),
    entity: z.object({ type: z.enum(PAGE_CONTEXT_ENTITY_TYPES), id: UuidSchema }).strict().optional(),
    selection: z
      .object({
        type: z.enum(PAGE_CONTEXT_SELECTION_TYPES),
        ids: z.array(UuidSchema).min(1).max(PAGE_CONTEXT_SELECTION_MAX),
      })
      .strict()
      .optional(),
    /** Chaves em allowlist; valores curtos (ids, status, período). */
    filters: z
      .object({
        pipelineId: z.string().min(1).max(64).optional(),
        stageId: z.string().min(1).max(64).optional(),
        ownerId: z.string().min(1).max(64).optional(),
        status: z.string().min(1).max(64).optional(),
        period: z.string().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
    view: z.enum(PAGE_CONTEXT_VIEWS).optional(),
  })
  .strict();
export type CopilotPageContext = z.infer<typeof CopilotPageContextSchema>;

// ─── Cartões de resultado (`tool_result`, P5: números vêm do banco) ──────────

export const TOOL_RESULT_KINDS = [
  'deal_list',
  'contact_card',
  'deal_card',
  'kpis',
  'series',
  'funnel',
  'event_list',
  'conversation_list',
  'campaign_card',
  'table',
] as const;
export type ToolResultKind = (typeof TOOL_RESULT_KINDS)[number];

/** Máximo de linhas num cartão (R5). Acima disso, `truncated: true`. */
export const TOOL_RESULT_MAX_ROWS = 50;

/** Formato de exibição de um número. A interface formata com `Intl` e o locale do workspace. */
export const ValueFormatSchema = z.enum(['number', 'currency', 'percent', 'days', 'text', 'date', 'datetime']);
export type ValueFormat = z.infer<typeof ValueFormatSchema>;

/** De onde veio e de quando é o dado (P6). */
export const ToolResultSourceSchema = z
  .object({
    label: shortText(160),
    as_of: IsoDateTimeSchema,
    record_count: nonNegInt,
  })
  .strict();
export type ToolResultSource = z.infer<typeof ToolResultSourceSchema>;

const StageRefSchema = z.object({ stage_id: UuidSchema, name: shortText(120) }).strict();

export const DealListDataSchema = z
  .object({
    currency: CurrencySchema,
    /** Total que casou com o filtro (pode ser maior que `items.length`). */
    total: nonNegInt,
    items: z
      .array(
        z
          .object({
            deal_id: UuidSchema,
            title: shortText(200),
            contact_name: z.string().max(200).nullable(),
            value: money.nullable(),
            stage: StageRefSchema,
            owner_name: z.string().max(120).nullable(),
            /** Régua única de "parado" (`dealIdleDaysSql`, F73-S01). */
            idle_days: nonNegInt.nullable(),
          })
          .strict(),
      )
      .max(TOOL_RESULT_MAX_ROWS),
  })
  .strict();

export const ContactCardDataSchema = z
  .object({
    contact_id: UuidSchema,
    name: shortText(200),
    /** Telefone mascarado para exibição. Nunca o número inteiro no cartão. */
    phone_masked: z.string().max(40).nullable(),
    tags: z.array(shortText(80)).max(30),
    origin: z.string().max(120).nullable(),
    attribution: z.string().max(200).nullable(),
    currency: CurrencySchema,
    open_deals: z
      .array(
        z
          .object({
            deal_id: UuidSchema,
            title: shortText(200),
            value: money.nullable(),
            stage_name: shortText(120),
          })
          .strict(),
      )
      .max(20),
    /** Só metadados: o conteúdo da conversa não entra no cartão. */
    last_conversation: z
      .object({
        conversation_id: UuidSchema,
        channel: shortText(40),
        last_message_at: IsoDateTimeSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const DealCardDataSchema = z
  .object({
    deal_id: UuidSchema,
    title: shortText(200),
    contact: z.object({ contact_id: UuidSchema, name: shortText(200) }).strict().nullable(),
    currency: CurrencySchema,
    value: money.nullable(),
    installments: z.object({ count: z.number().int().positive(), value: money }).strict().nullable(),
    pipeline_name: shortText(120),
    stage: StageRefSchema,
    days_in_stage: nonNegInt,
    idle_days: nonNegInt.nullable(),
    owner_name: z.string().max(120).nullable(),
    /** Últimos 5 eventos de `deal_history`, já em linguagem de negócio. */
    history: z.array(z.object({ at: IsoDateTimeSchema, label: shortText(200) }).strict()).max(5),
    products: z
      .array(
        z
          .object({ name: shortText(200), quantity: z.number().positive(), value: money.nullable() })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const KpisDataSchema = z
  .object({
    currency: CurrencySchema.nullable(),
    items: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
            label: shortText(80),
            value: z.number().finite(),
            format: ValueFormatSchema,
            /** Variação contra o período anterior, no mesmo formato. */
            delta: z.number().finite().nullable(),
            /** Intervalo (ex.: previsão com 80% de confiança). */
            range: z.object({ low: z.number().finite(), high: z.number().finite() }).strict().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    /** Os números que compõem o cartão ("3 maiores componentes da previsão"). */
    why: z.array(shortText(200)).max(3),
  })
  .strict();

export const SeriesDataSchema = z
  .object({
    label: shortText(120),
    format: ValueFormatSchema,
    currency: CurrencySchema.nullable(),
    points: z
      .array(z.object({ x: shortText(40), y: z.number().finite() }).strict())
      .max(366),
  })
  .strict();

export const FunnelDataSchema = z
  .object({
    pipeline_id: UuidSchema,
    pipeline_name: shortText(120),
    currency: CurrencySchema,
    stages: z
      .array(
        z
          .object({
            stage_id: UuidSchema,
            name: shortText(120),
            count: nonNegInt,
            value: money,
            /** Fração 0..1 que passa para o próximo estágio; `null` no último. */
            conversion_to_next: z.number().min(0).max(1).nullable(),
            idle_over_7d: nonNegInt,
          })
          .strict(),
      )
      .max(TOOL_RESULT_MAX_ROWS),
  })
  .strict();

export const EventListDataSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            event_id: UuidSchema,
            title: shortText(200),
            start_at: IsoDateTimeSchema,
            end_at: IsoDateTimeSchema.nullable(),
            type: shortText(40),
            status: shortText(40),
            contact_name: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(TOOL_RESULT_MAX_ROWS),
  })
  .strict();

export const ConversationListDataSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            conversation_id: UuidSchema,
            contact_name: z.string().max(200).nullable(),
            channel: shortText(40),
            status: shortText(40),
            assigned_to_name: z.string().max(120).nullable(),
            last_message_at: IsoDateTimeSchema.nullable(),
            /** Minutos esperando resposta nossa; `null` se a última mensagem foi nossa. */
            waiting_minutes: nonNegInt.nullable(),
          })
          .strict(),
      )
      .max(TOOL_RESULT_MAX_ROWS),
  })
  .strict();

export const CampaignCardDataSchema = z
  .object({
    campaign_id: UuidSchema,
    name: shortText(200),
    status: shortText(40),
    channel: shortText(40),
    scheduled_at: IsoDateTimeSchema.nullable(),
    recipients: nonNegInt,
    sent: nonNegInt,
    delivered: nonNegInt,
    read: nonNegInt,
    replied: nonNegInt,
    failed: nonNegInt,
    currency: CurrencySchema,
    cost_used: money.nullable(),
  })
  .strict();

const TableCellSchema = z.union([z.string().max(500), z.number().finite(), z.null()]);
export const TableDataSchema = z
  .object({
    currency: CurrencySchema.nullable(),
    columns: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
            label: shortText(80),
            format: ValueFormatSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
    // Linhas são mapas coluna → célula. As chaves são conferidas contra `columns` abaixo:
    // a forma é genérica por natureza (a tabela serve a várias consultas).
    rows: z.array(z.record(z.string(), TableCellSchema)).max(TOOL_RESULT_MAX_ROWS),
  })
  .strict()
  .superRefine((t, ctx) => {
    const keys = new Set(t.columns.map((c) => c.key));
    if (keys.size !== t.columns.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'colunas repetidas', path: ['columns'] });
    }
    t.rows.forEach((row, i) => {
      for (const k of Object.keys(row)) {
        if (!keys.has(k)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `coluna desconhecida: ${k}`, path: ['rows', i, k] });
        }
      }
    });
  });

const cardBase = {
  result_id: ResultIdSchema,
  source: ToolResultSourceSchema,
  truncated: z.boolean(),
};

function card<K extends ToolResultKind, D extends z.ZodTypeAny>(kind: K, data: D) {
  return z.object({ ...cardBase, kind: z.literal(kind), data }).strict();
}

export const DealListCardSchema = card('deal_list', DealListDataSchema);
export const ContactCardCardSchema = card('contact_card', ContactCardDataSchema);
export const DealCardCardSchema = card('deal_card', DealCardDataSchema);
export const KpisCardSchema = card('kpis', KpisDataSchema);
export const SeriesCardSchema = card('series', SeriesDataSchema);
export const FunnelCardSchema = card('funnel', FunnelDataSchema);
export const EventListCardSchema = card('event_list', EventListDataSchema);
export const ConversationListCardSchema = card('conversation_list', ConversationListDataSchema);
export const CampaignCardCardSchema = card('campaign_card', CampaignCardDataSchema);
export const TableCardSchema = card('table', TableDataSchema);

const TOOL_RESULT_CARD_OPTIONS = [
  DealListCardSchema,
  ContactCardCardSchema,
  DealCardCardSchema,
  KpisCardSchema,
  SeriesCardSchema,
  FunnelCardSchema,
  EventListCardSchema,
  ConversationListCardSchema,
  CampaignCardCardSchema,
  TableCardSchema,
] as const;

/** Cartão mostrável: um schema de `data` por `kind`. */
export const ToolResultCardSchema = z.discriminatedUnion('kind', [...TOOL_RESULT_CARD_OPTIONS]);
export type ToolResultCard = z.infer<typeof ToolResultCardSchema>;
export type ToolResultCardOf<K extends ToolResultKind> = Extract<ToolResultCard, { kind: K }>;
export type DealListData = z.infer<typeof DealListDataSchema>;
export type ContactCardData = z.infer<typeof ContactCardDataSchema>;
export type DealCardData = z.infer<typeof DealCardDataSchema>;
export type KpisData = z.infer<typeof KpisDataSchema>;
export type SeriesData = z.infer<typeof SeriesDataSchema>;
export type FunnelData = z.infer<typeof FunnelDataSchema>;
export type EventListData = z.infer<typeof EventListDataSchema>;
export type ConversationListData = z.infer<typeof ConversationListDataSchema>;
export type CampaignCardData = z.infer<typeof CampaignCardDataSchema>;
export type TableData = z.infer<typeof TableDataSchema>;
export type DealListCard = z.infer<typeof DealListCardSchema>;
export type ContactCardCard = z.infer<typeof ContactCardCardSchema>;
export type DealCardCard = z.infer<typeof DealCardCardSchema>;
export type KpisCard = z.infer<typeof KpisCardSchema>;
export type SeriesCard = z.infer<typeof SeriesCardSchema>;
export type FunnelCard = z.infer<typeof FunnelCardSchema>;
export type EventListCard = z.infer<typeof EventListCardSchema>;
export type ConversationListCard = z.infer<typeof ConversationListCardSchema>;
export type CampaignCardCard = z.infer<typeof CampaignCardCardSchema>;
export type TableCard = z.infer<typeof TableCardSchema>;

// ─── Resposta em formato fixo (§7) ───────────────────────────────────────────

export const NextStepActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), value: InternalRouteSchema }).strict(),
  z.object({ kind: z.literal('ask'), value: shortText(2000) }).strict(),
]);
export type NextStepAction = z.infer<typeof NextStepActionSchema>;

/**
 * Veredito → por quê → dados (refs) → fontes → próximo passo.
 *
 * `verdict` aceita até 500 caracteres, mais que os 220 pedidos ao modelo na ferramenta
 * `answer` (F73-S04): no `format_fallback` o runtime monta o veredito com a primeira frase
 * do texto livre, e recusar o turno inteiro por uma frase longa seria pior que mostrá-la.
 */
export const CopilotAnswerBlocksSchema = z
  .object({
    verdict: z.string().max(500),
    why: z.array(shortText(300)).max(3),
    data_refs: z.array(ResultIdSchema).max(20),
    sources: z.array(z.object({ label: shortText(160), as_of: IsoDateTimeSchema }).strict()).max(10),
    next_steps: z
      .array(z.object({ label: shortText(80), action: NextStepActionSchema.optional() }).strict())
      .max(3),
  })
  .strict();
export type CopilotAnswerBlocks = z.infer<typeof CopilotAnswerBlocksSchema>;

// ─── Propostas (ADR-004) ─────────────────────────────────────────────────────

/** Máximo de itens por página da proposta (= BATCH_LIMIT). */
export const PROPOSAL_ITEMS_PAGE_MAX = 200;

export const PolicyCheckSchema = z
  .object({
    /** Ex.: `send_window`, `consent`, `session_window`, `campaign_progress`, `stage_automation`. */
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    status: z.enum(['ok', 'warn', 'block']),
    label: shortText(120),
    detail: z.string().max(500),
  })
  .strict();
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const ProposalImpactSchema = z
  .object({
    /** Quanto sai (negativo) ou entra na previsão do mês, em R$. Ausente = não se aplica. */
    forecast_delta_brl: money.optional(),
    notified_members: z.array(MemberRefSchema).max(50),
    affected_count: nonNegInt,
    /** Critério legível ("parados há 7+ dias em Orçamento enviado"). */
    criterion: z.string().max(300),
  })
  .strict();
export type ProposalImpact = z.infer<typeof ProposalImpactSchema>;

export const ProposalPreviewSchema = z
  .object({
    /** Resumo antes → depois ("Orçamento enviado → Reativação · 7"). */
    before_after: z
      .array(
        z
          .object({
            label: shortText(200),
            before: z.string().max(200),
            after: z.string().max(200),
            count: nonNegInt,
          })
          .strict(),
      )
      .max(20),
    impact: ProposalImpactSchema,
    /** Nível 4 de mensagem: o texto final, com variáveis marcadas, e até 3 amostras renderizadas. */
    message_preview: z
      .object({
        template_name: z.string().max(120).nullable(),
        body: z.string().min(1).max(4096),
        variables: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)).max(20),
        samples: z
          .array(z.object({ recipient_label: shortText(200), text: z.string().min(1).max(4096) }).strict())
          .max(3),
      })
      .strict()
      .optional(),
    /** Saídas mais brandas que a interface oferece ("Pausar em vez disso"). */
    alternatives: z
      .array(z.object({ kind: z.literal('pause_instead'), label: shortText(80) }).strict())
      .max(3)
      .optional(),
  })
  .strict();
export type ProposalPreview = z.infer<typeof ProposalPreviewSchema>;

export const ProposalItemSchema = z
  .object({
    id: UuidSchema,
    target_type: z.enum(COPILOT_ACTION_TARGET_TYPES),
    target_id: UuidSchema,
    /** Rótulo legível do alvo ("Maria Souza · Alinhadores"). */
    label: shortText(200),
    before: z.string().max(200).nullable(),
    after: z.string().max(200).nullable(),
    status: ItemStatusSchema,
    /** Motivo legível de pulado/falha ("editado pela Paula às 09:14"). */
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type ProposalItem = z.infer<typeof ProposalItemSchema>;

/** Mesmos valores de `blocked_reason` no banco (`COPILOT_BLOCKED_REASONS`). */
export const PROPOSAL_BLOCKED_REASONS = COPILOT_BLOCKED_REASONS;
export type ProposalBlockedReason = (typeof PROPOSAL_BLOCKED_REASONS)[number];
export const ProposalBlockedReasonSchema = z.enum(PROPOSAL_BLOCKED_REASONS);

export const ProposalProgressSchema = z
  .object({ done: nonNegInt, total: nonNegInt, failed: nonNegInt })
  .strict();
export type ProposalProgress = z.infer<typeof ProposalProgressSchema>;

export const ProposalDTOSchema = z
  .object({
    id: UuidSchema,
    source: z.enum(COPILOT_PROPOSAL_SOURCES),
    capability: CapabilityKeySchema,
    risk_level: RiskLevelSchema,
    status: ProposalStatusSchema,
    summary: shortText(500),
    preview: ProposalPreviewSchema,
    /** Só no nível 4; recalculado no confirmar. */
    policy_checks: z.array(PolicyCheckSchema).max(20).nullable(),
    items: z
      .object({
        data: z.array(ProposalItemSchema).max(PROPOSAL_ITEMS_PAGE_MAX),
        total: nonNegInt,
        next_cursor: CursorSchema.nullable(),
      })
      .strict(),
    progress: ProposalProgressSchema,
    requested_by: MemberRefSchema,
    approver: MemberRefSchema.nullable(),
    expires_at: IsoDateTimeSchema.nullable(),
    undo_deadline: IsoDateTimeSchema.nullable(),
    /** CAS do confirmar/ajustar (ADR-004 §2). */
    version: z.number().int().positive(),
    /** Calculados para QUEM LÊ (dono, aprovador ou gestor). A interface não tem regra de risco. */
    can_confirm: z.boolean(),
    can_undo: z.boolean(),
    blocked_reason: ProposalBlockedReasonSchema.nullable(),
    created_at: IsoDateTimeSchema,
  })
  .strict();
export type ProposalDTO = z.infer<typeof ProposalDTOSchema>;

// ─── §5.3 Eventos SSE públicos (`v: 1`) ──────────────────────────────────────

export const COPILOT_STREAM_VERSION = 1 as const;
const v = z.literal(COPILOT_STREAM_VERSION);

export const COPILOT_STATUS_PHASES = ['thinking', 'reading', 'acting'] as const;
export const COPILOT_ERROR_CODES = [
  'runtime_unavailable',
  'timeout',
  'iteration_limit',
  'rate_limited',
  'turn_in_progress',
  'internal',
] as const;
export type CopilotErrorCode = (typeof COPILOT_ERROR_CODES)[number];

export const TurnStartedEventSchema = z
  .object({
    v,
    type: z.literal('turn_started'),
    turn_id: UuidSchema,
    session_id: UuidSchema,
    message_id: UuidSchema,
    /** "Vendo: Maria Souza · Alinhadores", calculado no servidor. */
    context_label: z.string().max(160).nullable(),
  })
  .strict();

export const StatusEventSchema = z
  .object({
    v,
    type: z.literal('status'),
    phase: z.enum(COPILOT_STATUS_PHASES),
    /** Do catálogo (`statusLabelFor`), nunca do modelo. */
    label: shortText(80),
  })
  .strict();

export const VerdictDeltaEventSchema = z
  .object({ v, type: z.literal('verdict_delta'), text: z.string().min(1).max(2000) })
  .strict();

/** `tool_result` = cartão + envelope do evento. Um objeto por `kind`. */
export const ToolResultEventSchema = z.discriminatedUnion(
  'kind',
  [
    DealListCardSchema.extend({ v, type: z.literal('tool_result') }),
    ContactCardCardSchema.extend({ v, type: z.literal('tool_result') }),
    DealCardCardSchema.extend({ v, type: z.literal('tool_result') }),
    KpisCardSchema.extend({ v, type: z.literal('tool_result') }),
    SeriesCardSchema.extend({ v, type: z.literal('tool_result') }),
    FunnelCardSchema.extend({ v, type: z.literal('tool_result') }),
    EventListCardSchema.extend({ v, type: z.literal('tool_result') }),
    ConversationListCardSchema.extend({ v, type: z.literal('tool_result') }),
    CampaignCardCardSchema.extend({ v, type: z.literal('tool_result') }),
    TableCardSchema.extend({ v, type: z.literal('tool_result') }),
  ],
);

export const ActionReceiptEventSchema = z
  .object({
    v,
    type: z.literal('action_receipt'),
    proposal_id: UuidSchema,
    risk_level: z.literal(2),
    summary: shortText(500),
    undo_until: IsoDateTimeSchema,
  })
  .strict();

export const ActionProposedEventSchema = z
  .object({ v, type: z.literal('action_proposed'), proposal: ProposalDTOSchema })
  .strict();

export const ActionBlockedEventSchema = z
  .object({
    v,
    type: z.literal('action_blocked'),
    proposal_id: UuidSchema,
    reason: ProposalBlockedReasonSchema,
    capability: CapabilityKeySchema,
    can_request_approval: z.boolean(),
    message: shortText(300),
  })
  .strict();

export const FinalEventSchema = z
  .object({ v, type: z.literal('final'), message_id: UuidSchema, blocks: CopilotAnswerBlocksSchema })
  .strict();

export const BudgetExceededEventSchema = z
  .object({ v, type: z.literal('budget_exceeded'), mode: BudgetModeSchema, resets_on: IsoDateSchema })
  .strict();

export const ErrorEventSchema = z
  .object({
    v,
    type: z.literal('error'),
    code: z.enum(COPILOT_ERROR_CODES),
    /** Correlaciona com o log (`hm_err_*`). Nunca texto cru do runtime ou do modelo. */
    ref: shortText(80),
  })
  .strict();

/** Todos os eventos, menos `tool_result` (que é uma união própria por `kind`). */
const NonCardStreamEventSchema = z.discriminatedUnion('type', [
  TurnStartedEventSchema,
  StatusEventSchema,
  VerdictDeltaEventSchema,
  ActionReceiptEventSchema,
  ActionProposedEventSchema,
  ActionBlockedEventSchema,
  FinalEventSchema,
  BudgetExceededEventSchema,
  ErrorEventSchema,
]);

/**
 * Frame SSE público: `data: <json>\n\n`. União discriminada por `type`; o `tool_result` é
 * discriminado ainda por `kind`. O custo NUNCA vai no stream (§5.3).
 */
export const CopilotStreamEventSchema = z.union([NonCardStreamEventSchema, ToolResultEventSchema]);
export type CopilotStreamEvent = z.infer<typeof CopilotStreamEventSchema>;
export type CopilotStreamEventType = CopilotStreamEvent['type'];
export type CopilotStreamEventOf<T extends CopilotStreamEventType> = Extract<CopilotStreamEvent, { type: T }>;
export type CopilotTurnStartedEvent = z.infer<typeof TurnStartedEventSchema>;
export type CopilotStatusEvent = z.infer<typeof StatusEventSchema>;
export type CopilotVerdictDeltaEvent = z.infer<typeof VerdictDeltaEventSchema>;
export type CopilotToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type CopilotActionReceiptEvent = z.infer<typeof ActionReceiptEventSchema>;
export type CopilotActionProposedEvent = z.infer<typeof ActionProposedEventSchema>;
export type CopilotActionBlockedEvent = z.infer<typeof ActionBlockedEventSchema>;
export type CopilotFinalEvent = z.infer<typeof FinalEventSchema>;
export type CopilotBudgetExceededEvent = z.infer<typeof BudgetExceededEventSchema>;
export type CopilotErrorEvent = z.infer<typeof ErrorEventSchema>;

export const COPILOT_STREAM_EVENT_TYPES = [
  'turn_started',
  'status',
  'verdict_delta',
  'tool_result',
  'action_receipt',
  'action_proposed',
  'action_blocked',
  'final',
  'budget_exceeded',
  'error',
] as const satisfies readonly CopilotStreamEventType[];

// ─── Sessões e mensagens (F73-S10) ───────────────────────────────────────────

export const CopilotSessionSchema = z
  .object({
    id: UuidSchema,
    title: z.string().max(80),
    origin: SessionOriginSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
    archived_at: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type CopilotSession = z.infer<typeof CopilotSessionSchema>;

export const CopilotMessageSchema = z
  .object({
    id: UuidSchema,
    role: z.enum(COPILOT_MESSAGE_ROLES),
    /** Pergunta, ou o veredito da resposta. */
    content: z.string().max(4000),
    blocks: CopilotAnswerBlocksSchema.nullable(),
    /** Cartões persistidos, para reabrir o histórico com os mesmos números. */
    tool_results: z.array(ToolResultCardSchema).max(20).nullable(),
    proposal_id: UuidSchema.nullable(),
    created_at: IsoDateTimeSchema,
  })
  .strict();
export type CopilotMessage = z.infer<typeof CopilotMessageSchema>;

export const CopilotSessionPageSchema = cursorPage(CopilotSessionSchema);
export type CopilotSessionPage = z.infer<typeof CopilotSessionPageSchema>;
export const CopilotMessagePageSchema = cursorPage(CopilotMessageSchema);
export type CopilotMessagePage = z.infer<typeof CopilotMessagePageSchema>;

// ─── Atividade (A8) ──────────────────────────────────────────────────────────

export const ActivityEntrySchema = z
  .object({
    /** Id da proposta: a Atividade é uma view sobre `copilot_action_proposals` (ADR-004 §7). */
    id: UuidSchema,
    at: IsoDateTimeSchema,
    source: z.enum(COPILOT_PROPOSAL_SOURCES),
    requested_by: MemberRefSchema.nullable(),
    /** Membro cujas permissões foram usadas (difere de quem pediu só no fluxo de aprovação). */
    executed_as: MemberRefSchema.nullable(),
    approver: MemberRefSchema.nullable(),
    capability: CapabilityKeySchema,
    risk_level: RiskLevelSchema,
    status: ProposalStatusSchema,
    summary: shortText(500),
    counts: z
      .object({
        total: nonNegInt,
        done: nonNegInt,
        skipped: nonNegInt,
        failed: nonNegInt,
        undone: nonNegInt,
      })
      .strict(),
    can_undo: z.boolean(),
    undo_deadline: IsoDateTimeSchema.nullable(),
    blocked_reason: ProposalBlockedReasonSchema.nullable(),
  })
  .strict();
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export const ActivityPageSchema = cursorPage(ActivityEntrySchema);
export type ActivityPage = z.infer<typeof ActivityPageSchema>;

export const ApproverSchema = z
  .object({ member_id: UuidSchema, name: shortText(120), role: RoleSchema })
  .strict();
export type Approver = z.infer<typeof ApproverSchema>;

// ─── Briefing (A2, §7.1) ─────────────────────────────────────────────────────

export const BRIEFING_ITEM_KINDS = [
  'deals_idle',
  'leads_waiting',
  'events_today',
  'autopilot_pending',
  'campaign_issue',
  'integration_alert',
] as const;
export type BriefingItemKind = (typeof BRIEFING_ITEM_KINDS)[number];

/** Máximo de itens no briefing. Do quarto em diante vira `overflow_count`. */
export const BRIEFING_MAX_ITEMS = 3;

export const BriefingItemSchema = z
  .object({
    id: shortText(64),
    kind: z.enum(BRIEFING_ITEM_KINDS),
    priority: z.enum(['high', 'medium', 'low']),
    title: shortText(200),
    /** Receita em risco na moeda do briefing. */
    value_at_risk: money,
    /** Os números que compõem o score (explicável, sem "score 0,82"). */
    why: z.array(shortText(200)).min(1).max(3),
    /** De quando é o dado. Dado velho não aparece como fato. */
    as_of: IsoDateTimeSchema,
    source: shortText(120),
    action: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('navigate'), value: InternalRouteSchema, label: shortText(80) }).strict(),
      z.object({ kind: z.literal('ask'), value: shortText(2000), label: shortText(80) }).strict(),
    ]),
  })
  .strict();
export type BriefingItem = z.infer<typeof BriefingItemSchema>;

export const BriefingSchema = z
  .object({
    id: UuidSchema,
    for_date: IsoDateSchema,
    generated_at: IsoDateTimeSchema,
    data_as_of: IsoDateTimeSchema,
    status: z.enum(COPILOT_BRIEFING_STATUSES),
    currency: CurrencySchema,
    items: z.array(BriefingItemSchema).max(BRIEFING_MAX_ITEMS),
    overflow_count: nonNegInt,
    /** Itens que saíram na revalidação por já estarem resolvidos ("1 já resolvido"). */
    resolved_count: nonNegInt,
    seen_at: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type Briefing = z.infer<typeof BriefingSchema>;

// ─── Memória do negócio (A10) ────────────────────────────────────────────────

export const MEMORY_PROFILE_MAX_CHARS = 500;
export const MEMORY_FACT_MAX_CHARS = 300;
export const MEMORY_ACTIVE_FACTS_MAX = 200;

export const MemoryProfileSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            key: z.enum(COPILOT_MEMORY_PROFILE_KEYS),
            content: z.string().max(MEMORY_PROFILE_MAX_CHARS).nullable(),
            updated_at: IsoDateTimeSchema.nullable(),
            updated_by: MemberRefSchema.nullable(),
          })
          .strict(),
      )
      .max(COPILOT_MEMORY_PROFILE_KEYS.length),
  })
  .strict();
export type MemoryProfile = z.infer<typeof MemoryProfileSchema>;

/** `PUT /memory/profile`: só as chaves enviadas mudam; string vazia apaga. */
export const MemoryProfileUpdateSchema = z
  .object({
    what_we_sell: z.string().trim().max(MEMORY_PROFILE_MAX_CHARS).optional(),
    avg_ticket: z.string().trim().max(MEMORY_PROFILE_MAX_CHARS).optional(),
    tone: z.string().trim().max(MEMORY_PROFILE_MAX_CHARS).optional(),
    hours: z.string().trim().max(MEMORY_PROFILE_MAX_CHARS).optional(),
    commercial_rules: z.string().trim().max(MEMORY_PROFILE_MAX_CHARS).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'nada para atualizar' });
export type MemoryProfileUpdate = z.infer<typeof MemoryProfileUpdateSchema>;

export const MemoryFactSchema = z
  .object({
    id: UuidSchema,
    content: shortText(MEMORY_PROFILE_MAX_CHARS),
    source_type: z.enum(COPILOT_MEMORY_SOURCE_TYPES),
    /** "Escrito por Bruna", "Pedido de Paula ao Copiloto em 10/10", "Integração: ERP". */
    source_label: shortText(200),
    status: z.enum(COPILOT_MEMORY_STATUSES),
    created_by: MemberRefSchema.nullable(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
    forgotten_at: IsoDateTimeSchema.nullable(),
    /** Esquecido há menos de 24 h: ainda dá para restaurar. */
    can_restore: z.boolean(),
  })
  .strict();
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export const MemoryFactPageSchema = cursorPage(MemoryFactSchema);
export type MemoryFactPage = z.infer<typeof MemoryFactPageSchema>;

/** Ensinar (`POST /memory/facts`) e Corrigir (`POST /memory/facts/:id/correct`). */
export const MemoryFactBodySchema = z
  .object({ content: z.string().trim().min(1).max(MEMORY_FACT_MAX_CHARS) })
  .strict();
export type MemoryFactBody = z.infer<typeof MemoryFactBodySchema>;

export const MemorySourceSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/),
    label: shortText(120),
    status: z.enum(['ok', 'warn', 'danger']),
    detail: z.string().max(300),
  })
  .strict();
export type MemorySource = z.infer<typeof MemorySourceSchema>;

// ─── Configurações (A11) ─────────────────────────────────────────────────────

const matrixRowShape = Object.fromEntries(
  [...CAPABILITY_KEYS, 'use'].map((k) => [k, z.boolean().optional()]),
) as { [K in CapabilityKey | 'use']: z.ZodOptional<z.ZodBoolean> };

/**
 * `{ papel: { capacidade | 'use': bool } }`. Ausente = herda o papel. A matriz só restringe
 * (`effectiveCapabilities`). `use: false` desliga o Copiloto para o papel.
 */
export const CapabilityMatrixSchema = z
  .object({
    OWNER: z.object(matrixRowShape).strict().optional(),
    ADMIN: z.object(matrixRowShape).strict().optional(),
    SUPERVISOR: z.object(matrixRowShape).strict().optional(),
    AGENT: z.object(matrixRowShape).strict().optional(),
    READONLY: z.object(matrixRowShape).strict().optional(),
  })
  .strict();
export type CapabilityMatrixDTO = z.infer<typeof CapabilityMatrixSchema>;

export const CopilotSettingsSchema = z
  .object({
    enabled: z.boolean(),
    capability_matrix: CapabilityMatrixSchema,
    monthly_budget_usd: z.number().nonnegative().max(100_000),
    budget_mode: BudgetModeSchema,
    budget_alert_pct: z.number().int().min(1).max(100),
    history_retention_months: HistoryRetentionMonthsSchema,
    default_auto_open: AutoOpenSchema,
    partner_access: z.boolean(),
    /** `null` = padrão da plataforma. Só leitura para o workspace (whitelist do super-admin). */
    model: z.string().max(120).nullable(),
    updated_by: MemberRefSchema.nullable(),
    updated_at: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type CopilotSettings = z.infer<typeof CopilotSettingsSchema>;

/**
 * `PUT /api/copilot/settings` (parcial). Fora daqui, de propósito:
 * - `model`: escolha de plataforma (whitelist e custo); muda pelo runbook, não pelo tenant;
 * - `partner_access: true`: v1.1 ("em breve"), aceita só `false`.
 * O OWNER não pode desligar o próprio uso: perderia o acesso à tela que religa.
 */
export const CopilotSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    capability_matrix: CapabilityMatrixSchema.optional(),
    monthly_budget_usd: z.number().nonnegative().max(100_000).optional(),
    budget_mode: BudgetModeSchema.optional(),
    budget_alert_pct: z.number().int().min(1).max(100).optional(),
    history_retention_months: HistoryRetentionMonthsSchema.optional(),
    default_auto_open: AutoOpenSchema.optional(),
    partner_access: z.literal(false).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'nada para atualizar' })
  .refine((o) => o.capability_matrix?.OWNER?.use !== false, {
    message: 'o dono não pode desligar o próprio acesso ao Copiloto',
    path: ['capability_matrix', 'OWNER', 'use'],
  });
export type CopilotSettingsUpdate = z.infer<typeof CopilotSettingsUpdateSchema>;

// ─── /me (F73-S03) ───────────────────────────────────────────────────────────

export const EffectiveCapabilitySchema = z
  .object({ allowed: z.boolean(), reason: z.enum(['role', 'disabled_by_owner']).optional() })
  .strict();
export type EffectiveCapabilityDTO = z.infer<typeof EffectiveCapabilitySchema>;

const effectiveShape = Object.fromEntries(
  CAPABILITY_KEYS.map((k) => [k, EffectiveCapabilitySchema]),
) as { [K in CapabilityKey]: typeof EffectiveCapabilitySchema };

export const EffectiveCapabilitiesSchema = z.object(effectiveShape).strict();
export type EffectiveCapabilitiesDTO = z.infer<typeof EffectiveCapabilitiesSchema>;

export const COPILOT_UNAVAILABLE_REASONS = [
  'impersonation',
  'copilot_disabled',
  'role',
  'disabled_for_role',
] as const;
export const COPILOT_BUDGET_STATES = ['ok', 'alert', 'queries_only', 'paused'] as const;
export type CopilotBudgetState = (typeof COPILOT_BUDGET_STATES)[number];

export const CopilotMeSchema = z
  .object({
    available: z.boolean(),
    unavailable_reason: z.enum(COPILOT_UNAVAILABLE_REASONS).nullable(),
    role: RoleSchema,
    /** "Gestora comercial": o rodapé "Age com as suas permissões: …". */
    role_label: shortText(80),
    capabilities: EffectiveCapabilitiesSchema,
    /** Permissões do Copiloto do papel, para a interface esconder o que não pode. */
    permissions: z
      .object({
        manage: z.boolean(),
        view_costs: z.boolean(),
        memory_edit: z.boolean(),
        activity_view_all: z.boolean(),
        autopilot_manage: z.boolean(),
      })
      .strict(),
    /** Assinatura em só leitura: consultas seguem, nenhuma escrita é proposta. */
    read_only: z.boolean(),
    prefs: z
      .object({
        /** Resolvido: o do membro, ou o padrão do workspace. */
        auto_open: AutoOpenSchema,
        auto_open_source: z.enum(['member', 'workspace']),
        surface: z.enum(COPILOT_SURFACES),
        briefing_last_seen_on: IsoDateSchema.nullable(),
        first_use_hint_seen: z.boolean(),
      })
      .strict(),
    budget: z
      .object({
        state: z.enum(COPILOT_BUDGET_STATES),
        resets_on: IsoDateSchema,
        /** Só com `copilot.view_costs`; ausente para os demais. */
        spent_usd: z.number().nonnegative().optional(),
        cap_usd: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
export type CopilotMe = z.infer<typeof CopilotMeSchema>;

/** `PATCH /api/copilot/me/prefs`. `auto_open: null` volta a herdar do workspace. */
export const CopilotPrefsUpdateSchema = z
  .object({
    auto_open: AutoOpenSchema.nullable().optional(),
    surface: z.enum(COPILOT_SURFACES).optional(),
    first_use_hint_seen: z.literal(true).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'nada para atualizar' });
export type CopilotPrefsUpdate = z.infer<typeof CopilotPrefsUpdateSchema>;

// ─── Piloto automático (A9, §7.2) ────────────────────────────────────────────

export const SuggestionSchema = z
  .object({
    id: UuidSchema,
    deal: z
      .object({
        deal_id: UuidSchema,
        title: shortText(200),
        contact_name: z.string().max(200).nullable(),
        value: money.nullable(),
        currency: CurrencySchema,
      })
      .strict(),
    from_stage: StageRefSchema,
    to_stage: StageRefSchema,
    reason_code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    /** Linguagem de negócio, de modelo de texto. Nunca número de score. */
    reason_text: shortText(300),
    confidence: z.enum(COPILOT_SUGGESTION_CONFIDENCES),
    status: z.enum(COPILOT_SUGGESTION_STATUSES),
    proposal_id: UuidSchema.nullable(),
    decided_by: MemberRefSchema.nullable(),
    decided_at: IsoDateTimeSchema.nullable(),
    created_at: IsoDateTimeSchema,
  })
  .strict();
export type Suggestion = z.infer<typeof SuggestionSchema>;
export const SuggestionPageSchema = cursorPage(SuggestionSchema);
export type SuggestionPage = z.infer<typeof SuggestionPageSchema>;

export const AutopilotCriteriaSchema = z
  .object({
    idle_days: z.number().int().min(1).max(60),
    target_stage_id: UuidSchema,
    require_last_outbound: z.boolean(),
  })
  .strict();
export type AutopilotCriteria = z.infer<typeof AutopilotCriteriaSchema>;

export const AutopilotRuleSchema = z
  .object({
    stage_id: UuidSchema,
    stage_name: shortText(120),
    pipeline_id: UuidSchema,
    mode: z.enum(COPILOT_AUTOPILOT_MODES),
    criteria: AutopilotCriteriaSchema,
    daily_limit: z.number().int().min(1).max(50),
    enabled_by: MemberRefSchema.nullable(),
    enabled_at: IsoDateTimeSchema.nullable(),
    updated_at: IsoDateTimeSchema,
  })
  .strict();
export type AutopilotRule = z.infer<typeof AutopilotRuleSchema>;

/**
 * `PUT /api/copilot/autopilot/rules`. Aceita `mode: 'auto'` no schema de propósito: a API
 * responde `409 feature_not_available` (v1.1), que a interface explica, em vez de um 422.
 */
export const AutopilotRulesUpdateBody = z
  .object({
    rules: z
      .array(
        z
          .object({
            stage_id: UuidSchema,
            mode: z.enum(COPILOT_AUTOPILOT_MODES),
            criteria: AutopilotCriteriaSchema,
            daily_limit: z.number().int().min(1).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type AutopilotRulesUpdate = z.infer<typeof AutopilotRulesUpdateBody>;

// ─── Uso e custo (F73-S15; só `copilot.view_costs`) ──────────────────────────

export const CopilotUsageSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    resets_on: IsoDateSchema,
    spent_usd: z.number().nonnegative(),
    cap_usd: z.number().nonnegative(),
    /** 0..∞ (pode passar de 100 até o teto duro de 120%). */
    pct: z.number().nonnegative(),
    budget_mode: BudgetModeSchema,
    state: z.enum(COPILOT_BUDGET_STATES),
    daily: z
      .array(z.object({ date: IsoDateSchema, cost_usd: z.number().nonnegative(), turns: nonNegInt }).strict())
      .max(31),
    top_members: z
      .array(
        z
          .object({
            member_id: UuidSchema,
            name: shortText(120),
            cost_usd: z.number().nonnegative(),
            turns: nonNegInt,
          })
          .strict(),
      )
      .max(5),
    turns: nonNegInt,
    actions_by_risk: z
      .array(z.object({ risk_level: RiskLevelSchema, count: nonNegInt }).strict())
      .max(4),
  })
  .strict();
export type CopilotUsage = z.infer<typeof CopilotUsageSchema>;

// ─── Bodies de request ───────────────────────────────────────────────────────

/** Header `Idempotency-Key` (confirmar, desfazer): UUID gerado por intenção do usuário. */
export const IdempotencyKeySchema = UuidSchema;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** Parâmetros ajustáveis declarados pelo executor (ADR-004 §2). */
export const ProposalAdjustParamsSchema = z
  .object({
    target_stage_id: UuidSchema.optional(),
    notify_members: z.boolean().optional(),
    /** "Pausar em vez disso" no cancelar campanha. */
    pause_instead: z.literal(true).optional(),
  })
  .strict();
export type ProposalAdjustParams = z.infer<typeof ProposalAdjustParamsSchema>;

export const ConfirmProposalBody = z
  .object({
    version: z.number().int().positive(),
    /** Caixa "Revisei": obrigatória no nível 4 (a API devolve 422 sem ela). */
    acknowledged: z.boolean().optional(),
    adjustments: ProposalAdjustParamsSchema.optional(),
  })
  .strict();
export type ConfirmProposalInput = z.infer<typeof ConfirmProposalBody>;

export const AdjustProposalBody = z
  .object({
    version: z.number().int().positive(),
    exclude_item_ids: z.array(UuidSchema).min(1).max(PROPOSAL_ITEMS_PAGE_MAX).optional(),
    params: ProposalAdjustParamsSchema.optional(),
  })
  .strict()
  .refine((o) => o.exclude_item_ids !== undefined || o.params !== undefined, {
    message: 'nada para ajustar',
  });
export type AdjustProposalInput = z.infer<typeof AdjustProposalBody>;

export const RequestApprovalBody = z.object({ approver_member_id: UuidSchema }).strict();
export type RequestApprovalInput = z.infer<typeof RequestApprovalBody>;

export const DecideSuggestionsBody = z
  .object({
    ids: z
      .array(UuidSchema)
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'ids repetidos' }),
    decision: z.enum(['approve', 'reject']),
  })
  .strict();
export type DecideSuggestionsInput = z.infer<typeof DecideSuggestionsBody>;

export const ASK_TEXT_MAX = 2000;

/** `POST /api/copilot/sessions/:id/messages` → SSE. */
export const AskBody = z
  .object({
    text: z.string().trim().min(1).max(ASK_TEXT_MAX),
    page_context: CopilotPageContextSchema.optional(),
    /** Idempotência do turno: reenvio com o mesmo id não cria turno novo. */
    client_request_id: UuidSchema,
    origin: SessionOriginSchema,
  })
  .strict();
export type AskInput = z.infer<typeof AskBody>;

export const CreateSessionBody = z
  .object({ origin: SessionOriginSchema, page_context: CopilotPageContextSchema.optional() })
  .strict();
export type CreateSessionInput = z.infer<typeof CreateSessionBody>;

export const RenameSessionBody = z.object({ title: z.string().trim().min(1).max(80) }).strict();
export type RenameSessionInput = z.infer<typeof RenameSessionBody>;
