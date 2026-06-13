/**
 * Agent quality / CSAT / objections domain (F29 — Dashboard "Onda B").
 * Doc: docs/features/AGENT_QUALITY_OBJECTIONS.md §3.
 *
 * Resultado do LLM-judge pós-conversa, persistido pelo worker de avaliação
 * (F29-S03) a partir do que o agent-runtime devolve (F29-S02):
 *
 * - `conversation_evaluations` — 1 avaliação por conversa encerrada (UNIQUE por
 *   `conversation_id` → idempotência do worker). Guarda qualidade da resposta
 *   (0-100), sentimento/CSAT do contato, quem conduziu (ai|human|mixed), e o
 *   modelo/custo do judge (denormalização para auditoria por conversa — o custo
 *   "fonte de verdade" também vai a `llm_usage_logs(request_type='evaluation')`).
 *   Persistimos score + rótulos + `raw` jsonb — NUNCA o transcript inteiro (§2.4).
 * - `objections` — N objeções classificadas por conversa, com vocabulário
 *   controlado (`category`), rótulo legível, excerto curto do contato e se foi
 *   contornada. FK `evaluation_id` CASCADE: deletar a avaliação limpa as objeções.
 *
 * Ambas workspace-scoped → RLS direto (policy na migration custom). Índices de
 * agregação para as métricas do dashboard (F29-S04): por evaluated_at, por agente,
 * por atendente, por categoria de objeção e por occurred_at.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Vocabulário controlado de categorias de objeção (MVP fixo — §2). */
export const OBJECTION_CATEGORIES = [
  'price',
  'timing',
  'trust',
  'competitor',
  'feature_gap',
  'authority',
  'other',
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

/** Quem conduziu majoritariamente a conversa. */
export const HANDLED_BY = ['ai', 'human', 'mixed'] as const;
export type HandledBy = (typeof HANDLED_BY)[number];

/** Rótulo CSAT derivado do sentimento. */
export const CSAT_LABELS = ['promoter', 'neutral', 'detractor'] as const;
export type CsatLabel = (typeof CSAT_LABELS)[number];

export const conversationEvaluations = pgTable(
  'conversation_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Agente IA que atuou (se houve). */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Atendente humano principal (se houve). */
    primaryMemberId: uuid('primary_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    handledBy: text('handled_by').notNull(),
    /** Qualidade da resposta: clareza, correção, tom, resolução (0-100). */
    qualityScore: smallint('quality_score').notNull(),
    qualityRationale: text('quality_rationale'),
    /** Sentimento do contato ao longo do diálogo (-100..100). Null = não medível. */
    sentimentScore: smallint('sentiment_score'),
    csatLabel: text('csat_label'),
    /** Slug do modelo judge usado (configurável por env no agent-runtime). */
    judgeModel: text('judge_model').notNull(),
    /** Custo do judge desta avaliação (denormalização; fonte = llm_usage_logs). */
    judgeCostUsd: numeric('judge_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    evaluatedAt: ts('evaluated_at').notNull().defaultNow(),
    /** Saída crua validada do judge (sem transcript). */
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // 1 avaliação por conversa → idempotência do worker (F29-S03).
    unique('conversation_evaluations_conversation_uq').on(t.conversationId),
    index('idx_conv_eval_ws_evaluated').on(t.workspaceId, t.evaluatedAt.desc()),
    index('idx_conv_eval_ws_agent').on(t.workspaceId, t.agentId),
    index('idx_conv_eval_ws_member').on(t.workspaceId, t.primaryMemberId),
    check('conversation_evaluations_handled_by_chk', sql`${t.handledBy} in ('ai','human','mixed')`),
    check('conversation_evaluations_quality_chk', sql`${t.qualityScore} between 0 and 100`),
    check(
      'conversation_evaluations_sentiment_chk',
      sql`${t.sentimentScore} is null or ${t.sentimentScore} between -100 and 100`,
    ),
    check(
      'conversation_evaluations_csat_chk',
      sql`${t.csatLabel} is null or ${t.csatLabel} in ('promoter','neutral','detractor')`,
    ),
  ],
);

export const objections = pgTable(
  'objections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => conversationEvaluations.id, { onDelete: 'cascade' }),
    /** Vocabulário controlado (§2). */
    category: text('category').notNull(),
    /** Rótulo legível. */
    label: text('label').notNull(),
    /** Citação curta do contato (PII curta — não o transcript). */
    excerpt: text('excerpt'),
    /** A objeção foi contornada na conversa? */
    resolved: boolean('resolved').notNull().default(false),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_objections_ws_category').on(t.workspaceId, t.category),
    index('idx_objections_ws_occurred').on(t.workspaceId, t.occurredAt.desc()),
    index('idx_objections_evaluation').on(t.evaluationId),
    check(
      'objections_category_chk',
      sql`${t.category} in ('price','timing','trust','competitor','feature_gap','authority','other')`,
    ),
  ],
);
