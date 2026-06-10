/**
 * Cost tracking + agregação de `agent_metrics` (F2-S13, AGENTS_LANGGRAPH §8/§11,
 * DATA_MODEL §7.8/§7.9).
 *
 * Job periódico, scheduler-friendly e **idempotente**, que faz roll-up das
 * fontes de verdade de execução de agente em `agent_metrics` (cache agregado por
 * `workspace_id` / `agent_id` / `period` / `period_start`):
 *
 * ```
 * llm_usage_logs   (custo/tokens/latência por chamada LLM)  ─┐
 * agent_executions (execuções: conversas, mensagens, erros) ─┤→ upsert agent_metrics
 * ```
 *
 * **Fontes (DATA_MODEL §7.8):**
 * - `total_tokens`, `total_cost_usd`, `avg_latency_ms` ← `llm_usage_logs`
 *   (a fonte de verdade do custo; gravada no `call_model` do agent-runtime).
 * - `total_conversations` ← `count(distinct conversation_id)` em `agent_executions`.
 * - `total_messages` ← número de execuções concluídas (cada execução = um turno
 *   de resposta do agente; espelha 1 mensagem outbound gerada).
 * - `error_count` ← execuções com `status='failed'`.
 * - `handoff_count` ← execuções cujo snapshot de `state.should_handoff = true`
 *   (campo do `AgentState`, AGENTS_LANGGRAPH §3.1).
 *
 * **Períodos (`agent_metrics.period`, CHECK `day|week|month`):** a granularidade
 * canônica de roll-up é `day` (um bucket por dia UTC). `week`/`month` são
 * agregações derivadas (truncadas pelo início do período) — o mesmo upsert serve
 * os três, variando só o `dateTrunc` da janela.
 *
 * **Idempotência:** todo bucket é recomputado a partir do bruto e gravado via
 * `INSERT … ON CONFLICT (agent_id, period, period_start) DO UPDATE` (unique
 * `agent_metrics_agent_period_uq`). Re-rodar a mesma janela **substitui** os
 * valores agregados pelos números recalculados — nunca soma incrementalmente,
 * então não há dupla contagem (DoD: "números batem com a soma bruta").
 *
 * **RLS:** o roll-up por workspace roda dentro de `withWorkspace(workspaceId, …)`.
 * A descoberta de quais workspaces têm atividade na janela é cross-tenant
 * (`getDb()` direto), espelhando o resolver do worker inbound (`db-ports.ts`).
 *
 * **In-process (ARCHITECTURE §4.2):** workers persistem direto via `@hm/db`; não
 * há DB-owner fantasma via MQ. O módulo é self-contained e exporta um entrypoint
 * limpo (`runAgentMetricsRollup`) para o scheduler chamar (ver REPORT p/ wiring).
 */
import { sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import type { Logger } from '@hm/logger';

/** Granularidades aceitas por `agent_metrics.period` (CHECK day|week|month). */
export type MetricsPeriod = 'day' | 'week' | 'month';

/** Períodos rolados por default a cada execução do job. */
export const DEFAULT_PERIODS: readonly MetricsPeriod[] = ['day', 'week', 'month'] as const;

/** `date_trunc` Postgres por período (define o `period_start` de cada bucket). */
const PERIOD_TRUNC: Record<MetricsPeriod, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/** Opções do roll-up. */
export interface AgentMetricsRollupOptions {
  /**
   * Instante de referência da janela (default: agora). Os buckets cobertos são
   * derivados deste ponto recuando `lookbackDays` (cobre execuções que chegaram
   * com atraso — ex.: custo real da OpenRouter, AGENTS_LANGGRAPH §11).
   */
  readonly now?: Date;
  /**
   * Quantos dias para trás recomputar (default: 2). Mantém buckets recentes
   * frescos sem reprocessar todo o histórico; idempotente, então é seguro.
   */
  readonly lookbackDays?: number;
  /** Períodos a rolar (default: day+week+month). */
  readonly periods?: readonly MetricsPeriod[];
  /**
   * Limita o roll-up a um único workspace (default: todos com atividade na
   * janela). Útil para testes e re-cálculo direcionado.
   */
  readonly workspaceId?: string;
}

/** Resultado observável do roll-up (log/teste). */
export interface AgentMetricsRollupResult {
  /** Workspaces visitados (tinham atividade na janela). */
  readonly workspaces: number;
  /** Linhas de `agent_metrics` inseridas ou atualizadas (todos os períodos). */
  readonly bucketsUpserted: number;
  /** Início da janela bruta considerada (UTC). */
  readonly windowStart: Date;
  /** Fim exclusivo da janela bruta (UTC). */
  readonly windowEnd: Date;
}

/** Início do dia UTC de `at` recuado `days` dias (limite inferior da janela). */
function windowStartUtc(at: Date, days: number): Date {
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - days),
  );
  return start;
}

/**
 * Descobre os workspaces com atividade de agente na janela `[start, end)`.
 * Cross-tenant (`getDb()` direto) — é o passo que enumera tenants, então roda
 * fora de qualquer escopo RLS, espelhando o resolver do inbound.
 *
 * "Atividade" = ter `llm_usage_logs` OU `agent_executions` na janela; a união
 * garante que um workspace com erro puro (execução falha sem log de custo)
 * também seja rolado.
 */
async function workspacesWithActivity(start: Date, end: Date): Promise<string[]> {
  const rows = await getDb().execute<{ workspace_id: string } & Record<string, unknown>>(sql`
    select distinct workspace_id from (
      select workspace_id from llm_usage_logs
        where created_at >= ${start} and created_at < ${end}
      union
      select workspace_id from agent_executions
        where started_at >= ${start} and started_at < ${end}
    ) as activity
  `);
  return [...rows].map((r) => r.workspace_id);
}

/**
 * Linha agregada de `llm_usage_logs` por (agent, bucket). O index signature
 * satisfaz a constraint `Record<string, unknown>` de `tx.execute<T>` (postgres-js).
 */
type UsageAggRow = {
  agent_id: string;
  period_start: string;
  total_tokens: number;
  total_cost_usd: string;
  avg_latency_ms: number | null;
} & Record<string, unknown>;

/** Linha agregada de `agent_executions` por (agent, bucket). */
type ExecAggRow = {
  agent_id: string;
  period_start: string;
  total_conversations: number;
  total_messages: number;
  handoff_count: number;
  error_count: number;
} & Record<string, unknown>;

/** Bucket consolidado pronto para upsert em `agent_metrics`. */
interface MetricBucket {
  agentId: string;
  periodStart: string;
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  totalCostUsd: string;
  avgLatencyMs: number;
  handoffCount: number;
  errorCount: number;
}

/**
 * Agrega `llm_usage_logs` por agente e bucket do período dentro do tenant atual
 * (RLS). Só considera linhas com `agent_id` não-nulo (uso atribuível a um agente;
 * embeddings/KB-ingest sem agente não entram em `agent_metrics`).
 */
async function aggregateUsage(
  tx: DbTx,
  period: MetricsPeriod,
  start: Date,
  end: Date,
): Promise<UsageAggRow[]> {
  const trunc = PERIOD_TRUNC[period];
  const rows = await tx.execute<UsageAggRow>(sql`
    select
      agent_id,
      date_trunc(${trunc}, created_at at time zone 'UTC')::date as period_start,
      coalesce(sum(total_tokens), 0)::bigint as total_tokens,
      coalesce(sum(cost_usd), 0)::numeric(12,6) as total_cost_usd,
      avg(latency_ms)::int as avg_latency_ms
    from llm_usage_logs
    where agent_id is not null
      and created_at >= ${start} and created_at < ${end}
    group by agent_id, period_start
  `);
  return [...rows];
}

/**
 * Agrega `agent_executions` por agente e bucket. `total_messages` = execuções
 * concluídas (cada execução = um turno de resposta do agente); `error_count` =
 * `status='failed'`; `handoff_count` = execuções cujo snapshot de state marcou
 * `should_handoff=true` (campo do AgentState, AGENTS_LANGGRAPH §3.1).
 */
async function aggregateExecutions(
  tx: DbTx,
  period: MetricsPeriod,
  start: Date,
  end: Date,
): Promise<ExecAggRow[]> {
  const trunc = PERIOD_TRUNC[period];
  const rows = await tx.execute<ExecAggRow>(sql`
    select
      agent_id,
      date_trunc(${trunc}, started_at at time zone 'UTC')::date as period_start,
      count(distinct conversation_id)
        filter (where conversation_id is not null)::int as total_conversations,
      count(*) filter (where status = 'completed')::int as total_messages,
      count(*) filter (where (state->>'should_handoff') = 'true')::int as handoff_count,
      count(*) filter (where status = 'failed')::int as error_count
    from agent_executions
    where started_at >= ${start} and started_at < ${end}
    group by agent_id, period_start
  `);
  return [...rows];
}

/** Funde as duas agregações por (agent, bucket) numa lista de buckets. */
function mergeBuckets(usage: UsageAggRow[], execs: ExecAggRow[]): MetricBucket[] {
  const byKey = new Map<string, MetricBucket>();

  const keyOf = (agentId: string, periodStart: string): string => `${agentId}|${periodStart}`;

  const ensure = (agentId: string, periodStart: string): MetricBucket => {
    const key = keyOf(agentId, periodStart);
    let bucket = byKey.get(key);
    if (bucket === undefined) {
      bucket = {
        agentId,
        periodStart,
        totalConversations: 0,
        totalMessages: 0,
        totalTokens: 0,
        totalCostUsd: '0',
        avgLatencyMs: 0,
        handoffCount: 0,
        errorCount: 0,
      };
      byKey.set(key, bucket);
    }
    return bucket;
  };

  for (const row of usage) {
    const bucket = ensure(row.agent_id, row.period_start);
    bucket.totalTokens = Number(row.total_tokens);
    bucket.totalCostUsd = row.total_cost_usd;
    bucket.avgLatencyMs = row.avg_latency_ms ?? 0;
  }

  for (const row of execs) {
    const bucket = ensure(row.agent_id, row.period_start);
    bucket.totalConversations = row.total_conversations;
    bucket.totalMessages = row.total_messages;
    bucket.handoffCount = row.handoff_count;
    bucket.errorCount = row.error_count;
  }

  return [...byKey.values()];
}

/**
 * Upsert idempotente de um bucket em `agent_metrics`. A unique
 * `(agent_id, period, period_start)` resolve o conflito; o `DO UPDATE`
 * **substitui** os agregados pelos números recalculados (não soma) — re-run da
 * mesma janela é estável.
 */
async function upsertBucket(
  tx: DbTx,
  workspaceId: string,
  period: MetricsPeriod,
  bucket: MetricBucket,
): Promise<void> {
  const { agentMetrics } = schema;
  await tx
    .insert(agentMetrics)
    .values({
      workspaceId,
      agentId: bucket.agentId,
      period,
      periodStart: bucket.periodStart,
      totalConversations: bucket.totalConversations,
      totalMessages: bucket.totalMessages,
      totalTokens: bucket.totalTokens,
      totalCostUsd: bucket.totalCostUsd,
      avgLatencyMs: bucket.avgLatencyMs,
      handoffCount: bucket.handoffCount,
      errorCount: bucket.errorCount,
    })
    .onConflictDoUpdate({
      target: [agentMetrics.agentId, agentMetrics.period, agentMetrics.periodStart],
      set: {
        totalConversations: bucket.totalConversations,
        totalMessages: bucket.totalMessages,
        totalTokens: bucket.totalTokens,
        totalCostUsd: bucket.totalCostUsd,
        avgLatencyMs: bucket.avgLatencyMs,
        handoffCount: bucket.handoffCount,
        errorCount: bucket.errorCount,
      },
    });
}

/**
 * Rola um único workspace para todos os períodos pedidos, sob RLS. Retorna o
 * número de buckets gravados (insert+update).
 */
async function rollupWorkspace(
  workspaceId: string,
  periods: readonly MetricsPeriod[],
  start: Date,
  end: Date,
): Promise<number> {
  return withWorkspace(workspaceId, async (tx) => {
    let upserted = 0;
    for (const period of periods) {
      const [usage, execs] = await Promise.all([
        aggregateUsage(tx, period, start, end),
        aggregateExecutions(tx, period, start, end),
      ]);
      const buckets = mergeBuckets(usage, execs);
      for (const bucket of buckets) {
        await upsertBucket(tx, workspaceId, period, bucket);
        upserted += 1;
      }
    }
    return upserted;
  });
}

/**
 * Entrypoint do job de roll-up de métricas de agente. Recomputa, de forma
 * idempotente, os buckets de `agent_metrics` para a janela `[now-lookbackDays,
 * now)` a partir de `llm_usage_logs` + `agent_executions`.
 *
 * O scheduler deve chamar isto periodicamente (ver REPORT). Self-contained: não
 * conhece MQ nem o registry de workers; só `@hm/db` + logger.
 */
export async function runAgentMetricsRollup(
  options: AgentMetricsRollupOptions = {},
  logger?: Logger,
): Promise<AgentMetricsRollupResult> {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? 2;
  const periods = options.periods ?? DEFAULT_PERIODS;

  // `week`/`month` truncam para o início do período; para que esses buckets
  // fiquem completos, a janela bruta recua o suficiente para cobrir o início do
  // período mais grosso que toca `now-lookbackDays`. 31 dias cobrem qualquer mês.
  const coarsest = periods.includes('month') ? 31 : periods.includes('week') ? 7 : 0;
  const windowStart = windowStartUtc(now, lookbackDays + coarsest);
  const windowEnd = now;

  const targets =
    options.workspaceId !== undefined
      ? [options.workspaceId]
      : await workspacesWithActivity(windowStart, windowEnd);

  let bucketsUpserted = 0;
  for (const workspaceId of targets) {
    try {
      bucketsUpserted += await rollupWorkspace(workspaceId, periods, windowStart, windowEnd);
    } catch (err: unknown) {
      // Um workspace problemático não derruba o roll-up dos demais; o próximo
      // ciclo recomputa (idempotente).
      logger?.error('agent-metrics: roll-up de workspace falhou', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: AgentMetricsRollupResult = {
    workspaces: targets.length,
    bucketsUpserted,
    windowStart,
    windowEnd,
  };

  logger?.info('agent-metrics: roll-up concluído', {
    workspaces: result.workspaces,
    bucketsUpserted: result.bucketsUpserted,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    periods,
  });

  return result;
}
