/**
 * Agent executions (DATA_MODEL §7.7 / AGENTS_LANGGRAPH §3.4, §4.1).
 *
 * Registro de cada execução do grafo LangGraph por agente. `thread_id` é o thread
 * do LangGraph; `state` guarda o snapshot do StateGraph (permite retomar interrupts).
 * Workspace-scoped → RLS. Os checkpoints internos do LangGraph (`langgraph_*`) são
 * tabelas auxiliares criadas pela própria lib (AsyncPostgresSaver.setup()) — não
 * modeladas aqui.
 *
 * `execution_id` em `tool_logs`/`llm_usage_logs` correlaciona com esta tabela (não FK,
 * pois execuções podem ser purgadas independentemente dos logs).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents, conversations, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** LangGraph thread_id. */
    threadId: text('thread_id').notNull(),
    status: text('status').notNull().default('running'),
    currentNode: text('current_node'),
    /** Snapshot do StateGraph state. */
    state: jsonb('state').$type<Record<string, unknown>>().notNull(),
    totalTokens: integer('total_tokens').default(0),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0'),
    startedAt: ts('started_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    completedAt: ts('completed_at'),
    error: text('error'),
    /**
     * Id estável do gatilho que motivou o turno (F70-S26, `agentRunTriggerId` de
     * `@hm/shared/mq`). Único por workspace: é a reivindicação do turno. NULL = execução
     * sem gatilho de fila (flush do buffer de agregação, linhas anteriores à 0092).
     */
    triggerId: text('trigger_id'),
    /**
     * Estado de entrega do turno, independente de `status` (que o runtime também escreve):
     * `claimed` → `running` → `responded` → `completed`; `failed_before_runtime` libera a
     * retentativa. Ver `apps/workers/src/agents/run.ts` (máquina de estados).
     */
    turnState: text('turn_state'),
    /** Dono da reivindicação atual; toda transição confere o token. */
    turnToken: uuid('turn_token'),
    /** Quantas vezes o turno foi reivindicado (1 + retentativas antes do runtime). */
    turnAttempts: integer('turn_attempts'),
    /** Início da reivindicação atual (lease de `claimed`). */
    turnClaimedAt: ts('turn_claimed_at'),
    /**
     * Resposta do runtime guardada entre o `final` e a gravação da mensagem. Uma retentativa
     * em `responded` grava ESTA resposta sem chamar o runtime de novo. Limpa ao concluir.
     */
    turnReply: text('turn_reply'),
  },
  (t) => [
    index('idx_agent_executions_thread').on(t.threadId),
    index('idx_agent_executions_conversation')
      .on(t.conversationId)
      .where(sql`${t.conversationId} is not null`),
    index('idx_agent_executions_agent_started').on(t.agentId, t.startedAt.desc()),
    // F56-S24 (DB-05): listagem/telemetria por tenant (workspace_id + recência) —
    // antes só existia o eixo por agente, e a query de workspace fazia seq scan.
    index('idx_agent_executions_ws_started').on(t.workspaceId, t.startedAt.desc()),
    // F56-S24 (DB-05): sweeper de execuções vivas — parcial só nos estados ativos
    // (running/interrupted), fração mínima da tabela.
    index('idx_agent_executions_status_active')
      .on(t.status)
      .where(sql`${t.status} in ('running','interrupted')`),
    check(
      'agent_executions_status_chk',
      sql`${t.status} in ('running','interrupted','completed','failed')`,
    ),
    // F70-S26 (0092): reivindicação do turno pelo id do gatilho, uma por workspace.
    uniqueIndex('uq_agent_executions_trigger')
      .on(t.workspaceId, t.triggerId)
      .where(sql`${t.triggerId} is not null`),
    check(
      'agent_executions_turn_state_chk',
      sql`${t.turnState} is null or ${t.turnState} in ('claimed','running','responded','completed','failed_before_runtime')`,
    ),
    check(
      'agent_executions_turn_claim_chk',
      sql`(${t.triggerId} is null) = (${t.turnState} is null) and (${t.triggerId} is null or length(${t.triggerId}) <= 256)`,
    ),
  ],
);
