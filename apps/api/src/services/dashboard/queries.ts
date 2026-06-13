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
import { and, count, desc, eq, gte, inArray, isNull, isNotNull, sql, sum } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const {
  conversations,
  conversionEvents,
  conversionTypes,
  contacts,
  deals,
  members,
  channels,
  agents,
  tools,
  toolLogs,
  llmUsageLogs,
  routingHistory,
  workspaceAgentPolicies,
} = schema;

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

// === F28-S01 — Tabela column-aware (contrato consumido pelo TableCard do S02) ==
export interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: 'left' | 'right' | 'center';
}
export type TableMetricValue = MetricValue & {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
};

function sinceHoursIso(hours: number, now = new Date()): string {
  return new Date(now.getTime() - hours * 3600000).toISOString();
}

export async function performancePorAtendente(
  tx: DbTx,
  workspaceId: string,
): Promise<TableMetricValue> {
  const dayStart = startOfDay().toISOString();
  const rows = await tx.execute<{
    member_id: string;
    nome: string | null;
    abertas: number;
    resolvidas_hoje: number;
    tempo_medio_resposta_seg: number | null;
    sla_violadas: number;
  }>(sql`
    SELECT
      m.id AS member_id,
      m.name AS nome,
      count(*) FILTER (WHERE c.status = 'open') AS abertas,
      count(*) FILTER (
        WHERE c.status IN ('resolved', 'closed') AND c.updated_at >= ${dayStart}::timestamptz
      ) AS resolvidas_hoje,
      avg(frt.first_response_seconds) AS tempo_medio_resposta_seg,
      count(*) FILTER (WHERE frt.first_response_seconds > 1800) AS sla_violadas
    FROM members m
    JOIN conversations c ON c.assigned_to = m.id AND c.workspace_id = ${workspaceId}
    LEFT JOIN LATERAL (
      SELECT EXTRACT(EPOCH FROM (
        (SELECT min(om.created_at) FROM messages om
          WHERE om.conversation_id = c.id AND om.direction = 'outbound')
        - (SELECT min(im.created_at) FROM messages im
            WHERE im.conversation_id = c.id AND im.direction = 'inbound')
      )) AS first_response_seconds
    ) frt ON true
    WHERE m.workspace_id = ${workspaceId} AND m.status = 'active'
    GROUP BY m.id, m.name
    HAVING count(*) > 0
    ORDER BY abertas DESC, resolvidas_hoje DESC
  `);
  const list = Array.from(rows);
  return {
    columns: [
      { key: 'nome', label: 'Atendente' },
      { key: 'abertas', label: 'Abertas', align: 'right' },
      { key: 'resolvidas_hoje', label: 'Resolvidas hoje', align: 'right' },
      { key: 'tempo_medio_resposta_seg', label: 'T. medio (s)', align: 'right' },
      { key: 'sla_status', label: 'SLA' },
    ],
    rows: list.map((r) => ({
      memberId: r.member_id,
      nome: r.nome ?? 'Sem nome',
      abertas: Number(r.abertas ?? 0),
      resolvidas_hoje: Number(r.resolvidas_hoje ?? 0),
      tempo_medio_resposta_seg:
        r.tempo_medio_resposta_seg == null ? null : Math.round(Number(r.tempo_medio_resposta_seg)),
      sla_status: Number(r.sla_violadas ?? 0) > 0 ? 'violado' : 'ok',
    })),
  };
}

export async function tempoMedioPrimeiraResposta24h(
  tx: DbTx,
  workspaceId: string,
  memberId?: string,
): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const memberFilter = memberId ? sql`AND c.assigned_to = ${memberId}` : sql``;
  const rows = await tx.execute<{ media_seg: number | null; amostra: number }>(sql`
    SELECT avg(frt.secs) AS media_seg, count(frt.secs) AS amostra
    FROM conversations c
    CROSS JOIN LATERAL (
      SELECT EXTRACT(EPOCH FROM (
        (SELECT min(om.created_at) FROM messages om
          WHERE om.conversation_id = c.id AND om.direction = 'outbound')
        - (SELECT min(im.created_at) FROM messages im
            WHERE im.conversation_id = c.id AND im.direction = 'inbound')
      )) AS secs
    ) frt
    WHERE c.workspace_id = ${workspaceId}
      AND c.created_at >= ${since}::timestamptz
      ${memberFilter}
      AND frt.secs IS NOT NULL AND frt.secs >= 0
  `);
  const row = Array.from(rows)[0];
  return {
    value: row?.media_seg == null ? 0 : Math.round(Number(row.media_seg)),
    unit: 's',
    sample: Number(row?.amostra ?? 0),
  };
}

export async function tempoMedioResolucao24h(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const rows = await tx.execute<{ media_seg: number | null; amostra: number }>(sql`
    SELECT
      avg(EXTRACT(EPOCH FROM (updated_at - created_at))) AS media_seg,
      count(*) AS amostra
    FROM conversations
    WHERE workspace_id = ${workspaceId}
      AND status IN ('resolved', 'closed')
      AND updated_at IS NOT NULL
      AND updated_at >= ${since}::timestamptz
  `);
  const row = Array.from(rows)[0];
  return {
    value: row?.media_seg == null ? 0 : Math.round(Number(row.media_seg)),
    unit: 's',
    sample: Number(row?.amostra ?? 0),
  };
}

export async function inboxPorCanal(tx: DbTx): Promise<TableMetricValue> {
  const rows = await tx
    .select({ provider: channels.provider, status: conversations.status, n: count() })
    .from(conversations)
    .innerJoin(channels, eq(conversations.channelId, channels.id))
    .groupBy(channels.provider, conversations.status);
  return {
    columns: [
      { key: 'provider', label: 'Canal' },
      { key: 'status', label: 'Status' },
      { key: 'count', label: 'Total', align: 'right' },
    ],
    rows: rows.map((r) => ({ provider: r.provider, status: r.status, count: Number(r.n) })),
  };
}

export async function transferencias24h(tx: DbTx): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const [row] = await tx
    .select({ n: count() })
    .from(routingHistory)
    .where(
      and(
        gte(routingHistory.createdAt, new Date(since)),
        inArray(routingHistory.action, ['transfer_member', 'transfer_department']),
      ),
    );
  return { value: row?.n ?? 0, unit: '' };
}

async function toolExecCount24h(tx: DbTx, toolKey: string): Promise<number> {
  const since = sinceHoursIso(24);
  const [row] = await tx
    .select({ n: count() })
    .from(toolLogs)
    .innerJoin(tools, eq(toolLogs.toolId, tools.id))
    .where(and(eq(tools.key, toolKey), gte(toolLogs.executedAt, new Date(since))));
  return row?.n ?? 0;
}

export async function agenteHandoffs24h(tx: DbTx): Promise<MetricValue> {
  return { value: await toolExecCount24h(tx, 'transfer_to_human'), unit: '' };
}

export async function agenteResolucoes24h(tx: DbTx): Promise<MetricValue> {
  return { value: await toolExecCount24h(tx, 'mark_resolved'), unit: '' };
}

export async function latenciaAgenteP9524h(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const rows = await tx.execute<{ p95_ms: number | null; amostra: number }>(sql`
    SELECT
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
      ) AS p95_ms,
      count(*) AS amostra
    FROM agent_executions
    WHERE workspace_id = ${workspaceId}
      AND completed_at IS NOT NULL
      AND started_at >= ${since}::timestamptz
  `);
  const row = Array.from(rows)[0];
  return {
    value: row?.p95_ms == null ? 0 : Math.round(Number(row.p95_ms)),
    unit: 'ms',
    sample: Number(row?.amostra ?? 0),
  };
}

export async function tokensPorModelo24h(
  tx: DbTx,
  workspaceId: string,
): Promise<TableMetricValue> {
  const since = sinceHoursIso(24);
  const rows = await tx
    .select({
      model: llmUsageLogs.model,
      totalTokens: sum(llmUsageLogs.totalTokens),
      requests: count(),
      costUsd: sum(llmUsageLogs.costUsd),
    })
    .from(llmUsageLogs)
    .where(
      and(
        eq(llmUsageLogs.workspaceId, workspaceId),
        eq(llmUsageLogs.isTest, false),
        gte(llmUsageLogs.createdAt, new Date(since)),
      ),
    )
    .groupBy(llmUsageLogs.model)
    .orderBy(desc(sum(llmUsageLogs.totalTokens)));
  return {
    columns: [
      { key: 'model', label: 'Modelo' },
      { key: 'tokens', label: 'Tokens', align: 'right' },
      { key: 'requests', label: 'Requisicoes', align: 'right' },
      { key: 'cost_usd', label: 'Custo (USD)', align: 'right' },
    ],
    rows: rows.map((r) => ({
      model: r.model,
      tokens: Number(r.totalTokens ?? 0),
      requests: Number(r.requests ?? 0),
      cost_usd: Number(r.costUsd ?? 0),
    })),
  };
}

export async function capMensalConsumidoPct(
  tx: DbTx,
  workspaceId: string,
): Promise<MetricValue> {
  const since = startOfMonth().toISOString();
  const [policy] = await tx
    .select({ cap: workspaceAgentPolicies.maxMonthlyCostUsd })
    .from(workspaceAgentPolicies)
    .where(eq(workspaceAgentPolicies.workspaceId, workspaceId))
    .limit(1);
  const capUsd = policy?.cap == null ? null : Number(policy.cap);
  if (capUsd == null || capUsd <= 0) {
    return { value: null, capUsd: null, spentUsd: 0 };
  }
  const rows = await tx.execute<{ spent: string }>(sql`
    SELECT coalesce(sum(cost_usd), 0)::numeric(18,8) AS spent
    FROM llm_usage_logs
    WHERE workspace_id = ${workspaceId}
      AND is_test = false
      AND created_at >= ${since}::timestamptz
  `);
  const spent = Number(Array.from(rows)[0]?.spent ?? 0);
  return {
    value: Math.round((spent / capUsd) * 100),
    unit: '%',
    capUsd,
    spentUsd: spent,
  };
}

export async function conversoesPorAtendenteHumano(tx: DbTx): Promise<TableMetricValue> {
  const since = startOfMonth();
  const rows = await tx
    .select({
      memberId: conversionEvents.triggeredByMemberId,
      nome: members.name,
      conversoes: count(),
      valorCents: sum(conversionEvents.valueCents),
    })
    .from(conversionEvents)
    .leftJoin(members, eq(conversionEvents.triggeredByMemberId, members.id))
    .where(
      and(
        isNotNull(conversionEvents.triggeredByMemberId),
        gte(conversionEvents.occurredAt, since),
        isNull(conversionEvents.cancelledAt),
      ),
    )
    .groupBy(conversionEvents.triggeredByMemberId, members.name)
    .orderBy(desc(count()));
  return {
    columns: [
      { key: 'nome', label: 'Atendente' },
      { key: 'conversoes', label: 'Conversoes', align: 'right' },
      { key: 'valor_cents', label: 'Valor', align: 'right' },
    ],
    rows: rows.map((r) => ({
      memberId: r.memberId,
      nome: r.nome ?? 'Sem nome',
      conversoes: Number(r.conversoes ?? 0),
      valor_cents: Number(r.valorCents ?? 0),
    })),
  };
}

export async function conversoesPorAgenteIa(tx: DbTx): Promise<TableMetricValue> {
  const since = startOfMonth();
  const rows = await tx
    .select({
      agentId: conversionEvents.triggeredByAgentId,
      nome: agents.name,
      conversoes: count(),
      valorCents: sum(conversionEvents.valueCents),
    })
    .from(conversionEvents)
    .leftJoin(agents, eq(conversionEvents.triggeredByAgentId, agents.id))
    .where(
      and(
        isNotNull(conversionEvents.triggeredByAgentId),
        gte(conversionEvents.occurredAt, since),
        isNull(conversionEvents.cancelledAt),
      ),
    )
    .groupBy(conversionEvents.triggeredByAgentId, agents.name)
    .orderBy(desc(count()));
  return {
    columns: [
      { key: 'nome', label: 'Agente IA' },
      { key: 'conversoes', label: 'Conversoes', align: 'right' },
      { key: 'valor_cents', label: 'Valor', align: 'right' },
    ],
    rows: rows.map((r) => ({
      agentId: r.agentId,
      nome: r.nome ?? 'Sem agente',
      conversoes: Number(r.conversoes ?? 0),
      valor_cents: Number(r.valorCents ?? 0),
    })),
  };
}
