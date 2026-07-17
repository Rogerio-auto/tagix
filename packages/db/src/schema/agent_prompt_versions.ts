/**
 * Prompt como código — versionamento do cérebro do agente (F56-S31 / AUDITORIA_TECNICA §3.3, AG-04).
 *
 * Problema (verificado): `agents.system_prompt` é coluna mutável e o PATCH sobrescreve
 * in-place — sem histórico, diff, rollback ou auditoria. Editava-se o cérebro do agente
 * ao vivo sem staging. Este é o gap #1 vs. Fin/Sierra/Decagon.
 *
 * Modelo: `agents` continua guardando o prompt/modelo LIVE (o que o runtime lê).
 * `agent_prompt_versions` é o histórico **append-only** + a área de staging:
 *
 *   - `status = 'draft'`  — rascunho staged, NÃO aplicado ao agente. Editável até publicar.
 *   - `status = 'live'`   — a versão atualmente publicada (espelha o estado do agente).
 *                           Índice parcial único garante NO MÁXIMO 1 live por agente.
 *   - `status = 'archived'` — versão que já foi live e foi substituída (histórico).
 *
 * Fluxo: criar draft → publicar (draft→live: aplica ao agente, arquiva o live anterior)
 * → diff entre quaisquer duas versões → rollback (republica o conteúdo de uma versão
 * antiga como uma NOVA versão live; nunca muta o histórico).
 *
 * RLS: `workspace_id` denormalizado (espelha `agent_departments`/`team_members`/
 * `contact_tags`) → isolamento direto por `app.workspace_id`. `agent_id` casa sempre
 * com o mesmo workspace (garantido app-side, defesa-em-profundidade além da RLS).
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Estados possíveis de uma versão de prompt. */
export const AGENT_PROMPT_VERSION_STATUSES = ['draft', 'live', 'archived'] as const;
export type AgentPromptVersionStatus = (typeof AGENT_PROMPT_VERSION_STATUSES)[number];

export const agentPromptVersions = pgTable(
  'agent_prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // workspace_id denormalizado p/ RLS direta (espelha agent_departments).
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** Número monotônico por agente (1, 2, 3, …). Único por agente. */
    version: integer('version').notNull(),
    /** draft | live | archived (ver AGENT_PROMPT_VERSION_STATUSES). */
    status: text('status').notNull().default('draft'),
    // ── Snapshot do "cérebro" nesta versão ──────────────────────────────────
    systemPrompt: text('system_prompt').notNull(),
    /** Slug OpenRouter congelado nesta versão (null = herda o default do agente). */
    model: text('model'),
    modelParams: jsonb('model_params').$type<Record<string, unknown>>().notNull().default({}),
    // ── Metadados de auditoria ──────────────────────────────────────────────
    /** Rótulo humano opcional (ex.: "v2 — tom mais consultivo"). */
    label: text('label'),
    /** Nota de mudança opcional (changelog curto). */
    note: text('note'),
    /** Autor da versão (SET NULL se o membro sair). */
    authorMemberId: uuid('author_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    /** Se esta versão nasceu de um rollback, aponta a versão de origem. */
    rolledBackFrom: integer('rolled_back_from'),
    createdAt: ts('created_at').notNull().defaultNow(),
    /** Quando foi promovida a live (null enquanto draft). */
    publishedAt: ts('published_at'),
  },
  (t) => [
    // Numeração monotônica única por agente.
    unique('uq_agent_prompt_versions_agent_version').on(t.agentId, t.version),
    // Histórico por agente ordenado por versão desc (list).
    index('idx_agent_prompt_versions_agent').on(t.agentId, t.version.desc()),
    index('idx_agent_prompt_versions_workspace').on(t.workspaceId),
    // NO MÁXIMO 1 live por agente (índice parcial único — o banco é a garantia final).
    uniqueIndex('uq_agent_prompt_versions_one_live_per_agent')
      .on(t.agentId)
      .where(sql`${t.status} = 'live'`),
  ],
);
