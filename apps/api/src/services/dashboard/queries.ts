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
import { and, avg, count, desc, eq, gte, inArray, isNull, isNotNull, sql, sum } from 'drizzle-orm';
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
  conversationEvaluations,
  objections,
  slaRules,
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

/**
 * Tempo médio de 1ª resposta (24h) — lê o marco de ciclo `first_response_at` (F55-S01)
 * em vez de varrer `messages` por LATERAL. A janela considera conversas com a 1ª
 * resposta registrada nas últimas 24h; `secs = first_response_at − created_at`. Com
 * `memberId` (scope pessoal) restringe ao atendente atribuído.
 */
export async function tempoMedioPrimeiraResposta24h(
  tx: DbTx,
  workspaceId: string,
  memberId?: string,
): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const memberFilter = memberId ? sql`AND c.assigned_to = ${memberId}` : sql``;
  const rows = await tx.execute<{ media_seg: number | null; amostra: number }>(sql`
    SELECT
      avg(EXTRACT(EPOCH FROM (c.first_response_at - c.created_at))) AS media_seg,
      count(*) AS amostra
    FROM conversations c
    WHERE c.workspace_id = ${workspaceId}
      AND c.first_response_at IS NOT NULL
      AND c.first_response_at >= ${since}::timestamptz
      AND c.first_response_at >= c.created_at
      ${memberFilter}
  `);
  const row = Array.from(rows)[0];
  return {
    value: row?.media_seg == null ? 0 : Math.round(Number(row.media_seg)),
    unit: 's',
    sample: Number(row?.amostra ?? 0),
  };
}

/**
 * Tempo médio de resolução (24h) — lê os marcos `resolved_at`/`closed_at` (F55-S01).
 * `secs = coalesce(closed_at, resolved_at) − created_at`. A janela considera conversas
 * resolvidas/fechadas nas últimas 24h (pelo marco, não mais por `updated_at`, que era
 * tocado por qualquer mutação e poluía a métrica).
 */
export async function tempoMedioResolucao24h(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const since = sinceHoursIso(24);
  const rows = await tx.execute<{ media_seg: number | null; amostra: number }>(sql`
    SELECT
      avg(EXTRACT(EPOCH FROM (coalesce(closed_at, resolved_at) - created_at))) AS media_seg,
      count(*) AS amostra
    FROM conversations
    WHERE workspace_id = ${workspaceId}
      AND status IN ('resolved', 'closed')
      AND coalesce(closed_at, resolved_at) IS NOT NULL
      AND coalesce(closed_at, resolved_at) >= ${since}::timestamptz
      AND coalesce(closed_at, resolved_at) >= created_at
  `);
  const row = Array.from(rows)[0];
  return {
    value: row?.media_seg == null ? 0 : Math.round(Number(row.media_seg)),
    unit: 's',
    sample: Number(row?.amostra ?? 0),
  };
}

/**
 * SLA violado hoje (live) — conta conversas abertas hoje que estouraram a regra de SLA
 * default do workspace (`sla_rules`, scope_type='workspace', ativa), comparando os
 * marcos de ciclo (F55-S01) em vez de varrer `messages`:
 *  - 1ª resposta: `first_response_secs` violado se ainda sem resposta e já passou do
 *    limite desde `created_at`, OU se respondeu além do limite.
 *  - resolução: `resolution_secs` violado se ainda sem `resolved_at`/`closed_at` e já
 *    passou do limite, OU se resolveu além do limite.
 * Sem regra de SLA (ou ambos os limites nulos) → `null` (não inventa limite — mesma
 * filosofia do job de snapshot). Mantém o shape `{ count }` do contrato.
 */
export async function slaVioladoHoje(tx: DbTx): Promise<MetricValue | null> {
  const [rule] = await tx
    .select({
      firstResponseSecs: slaRules.firstResponseSecs,
      resolutionSecs: slaRules.resolutionSecs,
    })
    .from(slaRules)
    .where(and(eq(slaRules.scopeType, 'workspace'), eq(slaRules.isActive, 'active')))
    .limit(1);
  if (!rule || (rule.firstResponseSecs == null && rule.resolutionSecs == null)) return null;

  const frtSecs = rule.firstResponseSecs;
  const resSecs = rule.resolutionSecs;
  const rows = await tx.execute<{ violated: number }>(sql`
    SELECT count(*)::int AS violated
    FROM conversations c
    WHERE c.created_at >= date_trunc('day', now())
      AND (
        (
          ${frtSecs}::int IS NOT NULL
          AND (
            (c.first_response_at IS NULL
              AND EXTRACT(EPOCH FROM (now() - c.created_at)) > ${frtSecs}::int)
            OR (c.first_response_at IS NOT NULL
              AND EXTRACT(EPOCH FROM (c.first_response_at - c.created_at)) > ${frtSecs}::int)
          )
        )
        OR (
          ${resSecs}::int IS NOT NULL
          AND (
            (coalesce(c.closed_at, c.resolved_at) IS NULL
              AND c.status NOT IN ('resolved', 'closed')
              AND EXTRACT(EPOCH FROM (now() - c.created_at)) > ${resSecs}::int)
            OR (coalesce(c.closed_at, c.resolved_at) IS NOT NULL
              AND EXTRACT(EPOCH FROM (coalesce(c.closed_at, c.resolved_at) - c.created_at)) > ${resSecs}::int)
          )
        )
      )
  `);
  return { count: Number(Array.from(rows)[0]?.violated ?? 0) };
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
      avatarUrl: members.avatarUrl,
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
    .groupBy(conversionEvents.triggeredByMemberId, members.name, members.avatarUrl)
    .orderBy(desc(count()));
  return {
    // `avatarUrl` é campo extra nas rows (não em `columns`) — o TableCard atual o ignora;
    // o leaderboard/avatar (S03+) o consome para o <Avatar> com fallback de iniciais.
    columns: [
      { key: 'nome', label: 'Atendente' },
      { key: 'conversoes', label: 'Conversoes', align: 'right' },
      { key: 'valor_cents', label: 'Valor', align: 'right' },
    ],
    rows: rows.map((r) => ({
      memberId: r.memberId,
      nome: r.nome ?? 'Sem nome',
      avatarUrl: r.avatarUrl ?? null,
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

// ─── §F29 Onda B — qualidade / CSAT / objeções (conversation_evaluations / objections) ──
// Janela padrão de 30 dias. `null` quando não há avaliação na janela (o front omite o
// card vazio em vez de exibir zero enganoso — DASHBOARD §10). Tudo sob RLS do tx.

/** Início da janela de 30 dias atrás (UTC). */
function start30dAgo(now = new Date()): Date {
  return new Date(now.getTime() - 30 * 24 * 3600000);
}

/** Qualidade média (avg quality_score) 30d. `null` sem avaliação na janela. */
export async function qualidadeRespostaMedia(tx: DbTx): Promise<MetricValue | null> {
  const since = start30dAgo();
  const [row] = await tx
    .select({ media: avg(conversationEvaluations.qualityScore), amostra: count() })
    .from(conversationEvaluations)
    .where(gte(conversationEvaluations.evaluatedAt, since));
  const amostra = Number(row?.amostra ?? 0);
  if (amostra === 0) return null;
  return { value: row?.media == null ? null : Math.round(Number(row.media)), sample: amostra };
}

/** Satisfação (CSAT) 30d: sentimento médio + distribuição promoter/neutral/detractor. */
export async function satisfacaoMedia(tx: DbTx): Promise<MetricValue | null> {
  const since = start30dAgo();
  const [row] = await tx
    .select({
      mediaSent: avg(conversationEvaluations.sentimentScore),
      promoters: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'promoter')::int`,
      neutrals: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'neutral')::int`,
      detractors: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} = 'detractor')::int`,
      amostra: sql<number>`count(*) filter (where ${conversationEvaluations.csatLabel} is not null)::int`,
    })
    .from(conversationEvaluations)
    .where(gte(conversationEvaluations.evaluatedAt, since));
  const amostra = Number(row?.amostra ?? 0);
  if (amostra === 0) return null;
  return {
    value: row?.mediaSent == null ? null : Math.round(Number(row.mediaSent)),
    promoters: Number(row?.promoters ?? 0),
    neutrals: Number(row?.neutrals ?? 0),
    detractors: Number(row?.detractors ?? 0),
    sample: amostra,
  };
}

/** Qualidade média por agente IA (ranking 30d). `null` sem avaliação com agente. */
export async function qualidadePorAgente(tx: DbTx): Promise<TableMetricValue | null> {
  const since = start30dAgo();
  const rows = await tx
    .select({
      agentId: conversationEvaluations.agentId,
      nome: agents.name,
      media: avg(conversationEvaluations.qualityScore),
      amostra: count(),
    })
    .from(conversationEvaluations)
    .leftJoin(agents, eq(conversationEvaluations.agentId, agents.id))
    .where(
      and(
        gte(conversationEvaluations.evaluatedAt, since),
        isNotNull(conversationEvaluations.agentId),
      ),
    )
    .groupBy(conversationEvaluations.agentId, agents.name)
    .orderBy(desc(avg(conversationEvaluations.qualityScore)));
  if (rows.length === 0) return null;
  return {
    columns: [
      { key: 'nome', label: 'Agente IA' },
      { key: 'qualidade_media', label: 'Qualidade média', align: 'right' },
      { key: 'avaliacoes', label: 'Avaliações', align: 'right' },
    ],
    rows: rows.map((r) => ({
      agentId: r.agentId,
      nome: r.nome ?? 'Sem agente',
      qualidade_media: r.media == null ? null : Math.round(Number(r.media)),
      avaliacoes: Number(r.amostra ?? 0),
    })),
  };
}

/** Qualidade média por atendente humano (ranking 30d). `null` sem avaliação humana. */
export async function qualidadePorAtendente(tx: DbTx): Promise<TableMetricValue | null> {
  const since = start30dAgo();
  const rows = await tx
    .select({
      memberId: conversationEvaluations.primaryMemberId,
      nome: members.name,
      avatarUrl: members.avatarUrl,
      media: avg(conversationEvaluations.qualityScore),
      amostra: count(),
    })
    .from(conversationEvaluations)
    .leftJoin(members, eq(conversationEvaluations.primaryMemberId, members.id))
    .where(
      and(
        gte(conversationEvaluations.evaluatedAt, since),
        isNotNull(conversationEvaluations.primaryMemberId),
      ),
    )
    .groupBy(conversationEvaluations.primaryMemberId, members.name, members.avatarUrl)
    .orderBy(desc(avg(conversationEvaluations.qualityScore)));
  if (rows.length === 0) return null;
  return {
    // `avatarUrl` extra nas rows (não em `columns`) — ignorado pelo TableCard, usado pela face nova.
    columns: [
      { key: 'nome', label: 'Atendente' },
      { key: 'qualidade_media', label: 'Qualidade média', align: 'right' },
      { key: 'avaliacoes', label: 'Avaliações', align: 'right' },
    ],
    rows: rows.map((r) => ({
      memberId: r.memberId,
      nome: r.nome ?? 'Sem nome',
      avatarUrl: r.avatarUrl ?? null,
      qualidade_media: r.media == null ? null : Math.round(Number(r.media)),
      avaliacoes: Number(r.amostra ?? 0),
    })),
  };
}

/** Objeções rankeadas por categoria (30d): total + % resolvida. `null` sem objeção. */
export async function objecoesRankeadas(tx: DbTx): Promise<TableMetricValue | null> {
  const since = start30dAgo();
  const rows = await tx
    .select({
      categoria: objections.category,
      total: count(),
      resolvidas: sql<number>`count(*) filter (where ${objections.resolved})::int`,
    })
    .from(objections)
    .where(gte(objections.occurredAt, since))
    .groupBy(objections.category)
    .orderBy(desc(count()));
  if (rows.length === 0) return null;
  return {
    columns: [
      { key: 'categoria', label: 'Categoria' },
      { key: 'total', label: 'Ocorrências', align: 'right' },
      { key: 'pct_resolvida', label: '% resolvida', align: 'right' },
    ],
    rows: rows.map((r) => {
      const total = Number(r.total ?? 0);
      const resolvidas = Number(r.resolvidas ?? 0);
      return {
        categoria: r.categoria,
        total,
        resolvidas,
        pct_resolvida: total === 0 ? 0 : Math.round((resolvidas / total) * 100),
      };
    }),
  };
}

/** Exemplos de objeção de uma categoria (drill-down: excerpt + estado resolvida). */
export async function objecoesExemplos(
  tx: DbTx,
  categoria: string,
  limit = 10,
): Promise<TableMetricValue> {
  const since = start30dAgo();
  const rows = await tx
    .select({
      label: objections.label,
      excerpt: objections.excerpt,
      resolved: objections.resolved,
      occurredAt: objections.occurredAt,
    })
    .from(objections)
    .where(and(eq(objections.category, categoria), gte(objections.occurredAt, since)))
    .orderBy(desc(objections.occurredAt))
    .limit(limit);
  return {
    columns: [
      { key: 'label', label: 'Objeção' },
      { key: 'excerpt', label: 'Trecho' },
      { key: 'resolvida', label: 'Resolvida' },
    ],
    rows: rows.map((r) => ({
      label: r.label,
      excerpt: r.excerpt,
      resolvida: r.resolved,
      occurred_at: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
  };
}

// ─── F48-S02 — Command Center v2: leaderboard com avatar, leads recentes, série 30d ──
// Três novas fontes de dado (jsonb-like). Tudo sob a tx com RLS; a MV não tem RLS, então
// a leitura filtra `workspace_id` explicitamente (defesa em profundidade — DASHBOARD §5/§9.3).

/** Linha do leaderboard de produtividade (com a foto do atendente). */
export interface LeaderboardRow {
  memberId: string;
  nome: string;
  avatarUrl: string | null;
  resolvidas: number;
  abertas: number;
  tmr_seg: number | null;
}

/**
 * Leaderboard de produtividade dos atendentes (com avatar). Resolvidas hoje + abertas
 * agora + tempo médio de 1ª resposta (FRT lateral, reusando a lógica de
 * `performancePorAtendente`). Ordena por `resolvidas` desc, depois `tmr_seg` asc
 * (NULLS LAST: quem ainda não respondeu não fura a fila à frente de quem respondeu rápido).
 */
export async function leaderboardProdutividade(
  tx: DbTx,
  workspaceId: string,
): Promise<MetricValue> {
  const dayStart = startOfDay().toISOString();
  const rows = await tx.execute<{
    member_id: string;
    nome: string | null;
    avatar_url: string | null;
    resolvidas: number;
    abertas: number;
    tmr_seg: number | null;
  }>(sql`
    SELECT
      m.id AS member_id,
      m.name AS nome,
      m.avatar_url AS avatar_url,
      count(*) FILTER (
        WHERE c.status IN ('resolved', 'closed') AND c.updated_at >= ${dayStart}::timestamptz
      ) AS resolvidas,
      count(*) FILTER (WHERE c.status = 'open') AS abertas,
      avg(frt.first_response_seconds) AS tmr_seg
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
    GROUP BY m.id, m.name, m.avatar_url
    HAVING count(*) > 0
    ORDER BY resolvidas DESC, tmr_seg ASC NULLS LAST
  `);
  const list: LeaderboardRow[] = Array.from(rows).map((r) => ({
    memberId: r.member_id,
    nome: r.nome ?? 'Sem nome',
    avatarUrl: r.avatar_url ?? null,
    resolvidas: Number(r.resolvidas ?? 0),
    abertas: Number(r.abertas ?? 0),
    tmr_seg: r.tmr_seg == null ? null : Math.round(Number(r.tmr_seg)),
  }));
  return { rows: list };
}

/** Linha de lead recente (atividade mais recente do contato). */
export interface LeadRow {
  contactId: string;
  nome: string;
  avatarUrl: string | null;
  canal: string;
  lastActivityAt: string;
  preview: string | null;
}

/**
 * Leads recentes por atividade: um contato por linha (a conversa de `last_message_at`
 * mais recente), ordenados do mais recente ao mais antigo. `DISTINCT ON (contact_id)`
 * num subselect colapsa as várias conversas de um mesmo contato; o outer reordena por
 * `last_message_at DESC` (o `DISTINCT ON` obriga `contact_id` como primeiro critério).
 * Traz nome, avatar e canal do contato e o preview da última mensagem.
 */
export async function leadsRecentes(tx: DbTx, limit = 8): Promise<MetricValue> {
  const rows = await tx.execute<{
    contact_id: string;
    nome: string | null;
    avatar_url: string | null;
    canal: string;
    last_message_at: string | Date;
    preview: string | null;
  }>(sql`
    SELECT contact_id, nome, avatar_url, canal, last_message_at, preview
    FROM (
      SELECT DISTINCT ON (c.contact_id)
        c.contact_id        AS contact_id,
        ct.display_name     AS nome,
        ct.avatar_url       AS avatar_url,
        ch.provider         AS canal,
        c.last_message_at   AS last_message_at,
        c.last_message_preview AS preview
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id AND ct.deleted_at IS NULL
      JOIN channels ch ON ch.id = c.channel_id
      WHERE c.contact_id IS NOT NULL
        AND c.last_message_at IS NOT NULL
      ORDER BY c.contact_id, c.last_message_at DESC
    ) sub
    ORDER BY sub.last_message_at DESC
    LIMIT ${limit}
  `);
  const list: LeadRow[] = Array.from(rows).map((r) => ({
    contactId: r.contact_id,
    nome: r.nome ?? 'Sem nome',
    avatarUrl: r.avatar_url ?? null,
    canal: r.canal,
    lastActivityAt:
      r.last_message_at instanceof Date
        ? r.last_message_at.toISOString()
        : new Date(r.last_message_at).toISOString(),
    preview: r.preview ?? null,
  }));
  return { rows: list };
}

/** Ponto diário da série de desempenho 30d (lido da MV). */
export interface SeriePoint {
  day: string;
  resolvidas: number;
  conversoes: number;
  conversoes_valor_cents: number;
  novos_contatos: number;
}

/**
 * Série diária de desempenho dos últimos 30 dias, lida da MV `mv_dashboard_daily_30d`
 * (refresh pelo job do worker). MV não tem RLS → filtro de workspace OBRIGATÓRIO e
 * explícito. Ordenado por `day` asc (eixo temporal dos gráficos).
 */
export async function serieDesempenho30d(tx: DbTx, workspaceId: string): Promise<MetricValue> {
  const rows = await tx.execute<{
    day: string | Date;
    resolvidas: number;
    conversoes: number;
    conversoes_valor_cents: number | string;
    novos_contatos: number;
  }>(sql`
    SELECT day, resolvidas, conversoes, conversoes_valor_cents, novos_contatos
    FROM mv_dashboard_daily_30d
    WHERE workspace_id = ${workspaceId}
    ORDER BY day ASC
  `);
  const series: SeriePoint[] = Array.from(rows).map((r) => ({
    day:
      r.day instanceof Date
        ? r.day.toISOString().slice(0, 10)
        : String(r.day).slice(0, 10),
    resolvidas: Number(r.resolvidas ?? 0),
    conversoes: Number(r.conversoes ?? 0),
    conversoes_valor_cents: Number(r.conversoes_valor_cents ?? 0),
    novos_contatos: Number(r.novos_contatos ?? 0),
  }));
  return { series };
}
