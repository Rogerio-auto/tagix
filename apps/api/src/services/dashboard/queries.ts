/**
 * Queries que materializam o valor de cada métrica (DASHBOARD.md §2). Três fontes:
 *  - LIVE: agregação direta sobre as tabelas (estado operacional, cadência socket/5min).
 *  - SNAPSHOT: lê `dashboard_snapshots` (job 5min populou) por (metric_key, scope).
 *  - MV: lê as materialized views `mv_dashboard_*` (job 1h/1d deu refresh).
 *
 * TODAS as queries rodam dentro de uma tx com RLS (`req.scoped`). As tabelas têm
 * isolamento por `app.workspace_id`; as **MVs não suportam RLS**, então as leituras
 * de MV adicionam `WHERE workspace_id = ${workspaceId}` explicitamente (defesa em
 * profundidade — o caller também passa o workspace do auth).
 *
 * O valor de cada métrica é um objeto jsonb-like (`{ count }`, `{ valueCents }`,
 * série, breakdown). A forma por metric_key é validada no load (não aqui).
 */
import { and, count, eq, gte, isNull, isNotNull, sql, sum } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const { conversations, conversionEvents, conversionTypes, contacts, deals } = schema;

export type MetricValue = Record<string, unknown>;

/** Início do mês corrente (UTC) — alinhado ao filtro das MVs (`date_trunc('month', now())`). */
function startOfMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Início do dia corrente (UTC). */
function startOfDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ─── §13: o workspace tem ao menos um conversion_type? (gate dos cards §2.5) ──
export async function hasConversionType(tx: DbTx): Promise<boolean> {
  const [row] = await tx.select({ n: count() }).from(conversionTypes);
  return (row?.n ?? 0) > 0;
}

// ─── LIVE: estado operacional (cadência socket/5min) ─────────────────────────
export async function minhasConversasAbertas(tx: DbTx, memberId: string): Promise<MetricValue> {
  const [row] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(and(eq(conversations.assignedTo, memberId), eq(conversations.status, 'open')));
  return { count: row?.n ?? 0 };
}

export async function minhaFilaPendente(tx: DbTx, memberId: string): Promise<MetricValue> {
  const [row] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(and(eq(conversations.assignedTo, memberId), eq(conversations.status, 'pending')));
  return { count: row?.n ?? 0 };
}

export async function aguardandoAtribuicao(tx: DbTx): Promise<MetricValue> {
  const [row] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(and(isNull(conversations.assignedTo), eq(conversations.status, 'pending')));
  return { count: row?.n ?? 0 };
}

export async function emAtendimentoIa(tx: DbTx): Promise<MetricValue> {
  const [row] = await tx
    .select({ n: count() })
    .from(conversations)
    .where(eq(conversations.aiMode, 'on'));
  return { count: row?.n ?? 0 };
}

export async function inboxPorDepartamento(tx: DbTx): Promise<MetricValue> {
  const rows = await tx
    .select({
      departmentId: conversations.departmentId,
      status: conversations.status,
      n: count(),
    })
    .from(conversations)
    .where(isNotNull(conversations.departmentId))
    .groupBy(conversations.departmentId, conversations.status);
  return { rows: rows.map((r) => ({ departmentId: r.departmentId, status: r.status, count: r.n })) };
}

export async function valorTotalPipeline(tx: DbTx): Promise<MetricValue> {
  const [row] = await tx
    .select({ total: sum(deals.valueCents) })
    .from(deals)
    .where(isNull(deals.closedAt));
  return { valueCents: Number(row?.total ?? 0) };
}

// ─── LIVE: conversões do mês (snapshot/5min) ─────────────────────────────────
export async function conversoesMinhasMes(tx: DbTx, memberId: string): Promise<MetricValue> {
  const since = startOfMonth();
  const [row] = await tx
    .select({ n: count(), total: sum(conversionEvents.valueCents) })
    .from(conversionEvents)
    .where(
      and(
        eq(conversionEvents.triggeredByMemberId, memberId),
        gte(conversionEvents.occurredAt, since),
        isNull(conversionEvents.cancelledAt),
      ),
    );
  return { count: row?.n ?? 0, valueCents: Number(row?.total ?? 0) };
}

export async function conversoesWorkspaceMes(tx: DbTx): Promise<MetricValue> {
  const since = startOfMonth();
  const [row] = await tx
    .select({ n: count(), total: sum(conversionEvents.valueCents) })
    .from(conversionEvents)
    .where(and(gte(conversionEvents.occurredAt, since), isNull(conversionEvents.cancelledAt)));
  return { count: row?.n ?? 0, valueCents: Number(row?.total ?? 0) };
}

// ─── LIVE: negócio (OWNER) ───────────────────────────────────────────────────
export async function novosContatosMes(tx: DbTx): Promise<MetricValue> {
  const since = startOfMonth();
  const [row] = await tx
    .select({ n: count() })
    .from(contacts)
    .where(and(gte(contacts.createdAt, since), isNull(contacts.deletedAt)));
  return { count: row?.n ?? 0 };
}

export async function contatosTotalWorkspace(tx: DbTx): Promise<MetricValue> {
  const [row] = await tx.select({ n: count() }).from(contacts).where(isNull(contacts.deletedAt));
  return { count: row?.n ?? 0 };
}

// ─── SNAPSHOT: lê dashboard_snapshots por (metric_key, scope) ─────────────────
/** Lê o valor de uma snapshot; scope canônico (chaves ordenadas) garantido pelo job. */
export async function readSnapshot(
  tx: DbTx,
  metricKey: string,
  scope: Record<string, string>,
): Promise<MetricValue | null> {
  // Comparação de jsonb por igualdade estrutural via cast explícito (`= ...::jsonb`)
  // — evita o binding ambíguo de objeto JS no operador `eq` da drizzle sobre jsonb.
  const rows = await tx.execute<{ value: MetricValue; computed_at: string }>(sql`
    SELECT value, computed_at
    FROM dashboard_snapshots
    WHERE metric_key = ${metricKey}
      AND scope = ${JSON.stringify(scope)}::jsonb
    ORDER BY computed_at DESC
    LIMIT 1
  `);
  const row = Array.from(rows)[0];
  if (!row) return null;
  return { ...row.value, computedAt: row.computed_at };
}

// ─── MV: leituras das materialized views (filtro explícito de workspace) ──────
export async function readVolume24h(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const rows = await tx.execute<{ bucket_hour: string; direction: string; message_count: number }>(
    sql`SELECT bucket_hour, direction, message_count
        FROM mv_dashboard_volume_24h
        WHERE workspace_id = ${workspaceId}
        ORDER BY bucket_hour ASC`,
  );
  return { series: Array.from(rows) };
}

export async function readLlmCostMonth(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const rows = await tx.execute<{ cost_usd: string; total_tokens: number; request_count: number }>(
    sql`SELECT cost_usd, total_tokens, request_count
        FROM mv_dashboard_llm_cost_month
        WHERE workspace_id = ${workspaceId}
        LIMIT 1`,
  );
  const row = Array.from(rows)[0];
  return {
    costUsd: row ? Number(row.cost_usd) : 0,
    totalTokens: row?.total_tokens ?? 0,
    requestCount: row?.request_count ?? 0,
  };
}

export async function readConversionsMonth(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const rows = await tx.execute<{
    conversion_type_id: string;
    conversion_count: number;
    value_cents: number;
  }>(
    sql`SELECT conversion_type_id, conversion_count, value_cents
        FROM mv_dashboard_conversions_month
        WHERE workspace_id = ${workspaceId}
        ORDER BY conversion_count DESC`,
  );
  return { byType: Array.from(rows) };
}

// ─── LIVE: custo LLM hoje (snapshot 5min lê isto; drill-down também) ──────────
export async function custoLlmHojeUsd(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const since = startOfDay().toISOString();
  const rows = await tx.execute<{ cost_usd: string }>(
    sql`SELECT coalesce(sum(cost_usd), 0)::numeric(18,8) AS cost_usd
        FROM llm_usage_logs
        WHERE workspace_id = ${workspaceId} AND created_at >= ${since}::timestamptz`,
  );
  const row = Array.from(rows)[0];
  return { costUsd: row ? Number(row.cost_usd) : 0 };
}
