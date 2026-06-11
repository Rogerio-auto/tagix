/**
 * Job de snapshot do dashboard (F8-S02 / DASHBOARD.md §5 — cadência 5min).
 *
 * Popula `dashboard_snapshots` com as métricas de cadência 5min cujo cálculo é caro
 * o suficiente para não rodar a cada `GET /dashboard/me` (SLA violado, resolvidas/dia,
 * deals fechados/mês). O endpoint lê a snapshot; se ela não existir ainda, faz
 * fallback para query live (load-dashboard).
 *
 * Cross-tenant: enumera workspaces com `getDb()` (como o follow-up scheduler) e, por
 * tenant, calcula sob RLS (`withWorkspace`) e faz upsert idempotente por
 * (workspace, metric_key, scope). O scope canônico é `{}` para métricas de workspace
 * e `{ memberId }` para métricas pessoais.
 *
 * SLA: limite vem de `sla_rules` (default do workspace, scope_type='workspace'). Sem
 * regra → métrica omitida (não inventa limite). "Primeira resposta" = primeira
 * mensagem outbound de member após a primeira inbound, comparada ao first_response_secs.
 */
import { sql } from 'drizzle-orm';
import { getDb, withWorkspace, type DbTx } from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  acquireSchedulerLock,
  DASHBOARD_LOCK_TTL_MS,
  DASHBOARD_SNAPSHOT_LOCK_KEY,
  type RedisLike,
} from './scheduler';

export interface SnapshotDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
}

export interface SnapshotTickResult {
  readonly ran: boolean;
  readonly workspaces: number;
  readonly snapshots: number;
}

/** Upsert canônico de uma snapshot (idempotente pela unique (ws, metric, scope)). */
async function upsert(
  tx: DbTx,
  metricKey: string,
  scope: Record<string, string>,
  value: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO dashboard_snapshots (workspace_id, metric_key, scope, value, computed_at)
    VALUES (
      current_setting('app.workspace_id', true)::uuid,
      ${metricKey},
      ${JSON.stringify(scope)}::jsonb,
      ${JSON.stringify(value)}::jsonb,
      now()
    )
    ON CONFLICT (workspace_id, metric_key, scope)
    DO UPDATE SET value = EXCLUDED.value, computed_at = now()
  `);
}

/** Enumera workspaces ativos (cross-tenant). */
async function enumerateWorkspaces(): Promise<string[]> {
  const rows = await getDb().execute<{ id: string } & Record<string, unknown>>(
    sql`SELECT id FROM workspaces`,
  );
  return Array.from(rows).map((r) => r.id);
}

/** Computa + persiste as snapshots 5min de um workspace (sob RLS). */
async function snapshotWorkspace(workspaceId: string): Promise<number> {
  return withWorkspace(workspaceId, async (tx) => {
    let written = 0;

    // sla_violado_hoje — usa o default do workspace (first_response_secs).
    const slaRows = await tx.execute<{ violated: number } & Record<string, unknown>>(sql`
      WITH rule AS (
        SELECT first_response_secs
        FROM sla_rules
        WHERE scope_type = 'workspace' AND is_active = 'active'
        LIMIT 1
      ),
      first_inbound AS (
        SELECT conversation_id, min(created_at) AS at
        FROM messages WHERE direction = 'inbound' GROUP BY conversation_id
      ),
      first_response AS (
        SELECT m.conversation_id, min(m.created_at) AS at
        FROM messages m
        JOIN first_inbound fi ON fi.conversation_id = m.conversation_id
        WHERE m.direction = 'outbound' AND m.sender_type = 'member' AND m.created_at >= fi.at
        GROUP BY m.conversation_id
      )
      SELECT count(*)::int AS violated
      FROM first_inbound fi
      JOIN conversations c ON c.id = fi.conversation_id
      CROSS JOIN rule r
      LEFT JOIN first_response fr ON fr.conversation_id = fi.conversation_id
      WHERE fi.at >= date_trunc('day', now())
        AND r.first_response_secs IS NOT NULL
        AND (
          fr.at IS NULL
            AND extract(epoch FROM (now() - fi.at)) > r.first_response_secs
          OR fr.at IS NOT NULL
            AND extract(epoch FROM (fr.at - fi.at)) > r.first_response_secs
        )
    `);
    const violated = Array.from(slaRows)[0]?.violated ?? 0;
    // Só grava se há regra de SLA (violated vem 0 sem regra pelo CROSS JOIN vazio).
    await upsert(tx, 'sla_violado_hoje', {}, { count: violated });
    written += 1;

    // resolvidas_hoje_por_mim — por member (assigned_to) que teve conversa
    // resolvida/fechada hoje. scope { memberId }.
    const resolved = await tx.execute<{ member_id: string; n: number } & Record<string, unknown>>(sql`
      SELECT assigned_to AS member_id, count(*)::int AS n
      FROM conversations
      WHERE status IN ('closed', 'resolved')
        AND assigned_to IS NOT NULL
        AND updated_at >= date_trunc('day', now())
      GROUP BY assigned_to
    `);
    for (const r of Array.from(resolved)) {
      await upsert(tx, 'resolvidas_hoje_por_mim', { memberId: r.member_id }, { count: r.n });
      written += 1;
    }

    // deals_fechados_ganho_mes — soma de value_cents dos deals ganhos no mês.
    const won = await tx.execute<{ n: number; total: number } & Record<string, unknown>>(sql`
      SELECT count(*)::int AS n, coalesce(sum(value_cents), 0)::bigint AS total
      FROM deals
      WHERE closed_won = true AND closed_at >= date_trunc('month', now())
    `);
    const wonRow = Array.from(won)[0];
    await upsert(
      tx,
      'deals_fechados_ganho_mes',
      {},
      { count: wonRow?.n ?? 0, valueCents: Number(wonRow?.total ?? 0) },
    );
    written += 1;

    return written;
  });
}

export async function runSnapshotTick(deps: SnapshotDeps): Promise<SnapshotTickResult> {
  const release = await acquireSchedulerLock(
    deps.redis,
    DASHBOARD_SNAPSHOT_LOCK_KEY,
    DASHBOARD_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, workspaces: 0, snapshots: 0 };

  try {
    const workspaceIds = await enumerateWorkspaces();
    let snapshots = 0;
    for (const id of workspaceIds) {
      try {
        snapshots += await snapshotWorkspace(id);
      } catch (err: unknown) {
        deps.logger.error('dashboard-refresh: snapshot do workspace falhou', {
          workspaceId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (snapshots > 0) {
      deps.logger.info('dashboard-refresh: snapshot tick', {
        workspaces: workspaceIds.length,
        snapshots,
      });
    }
    return { ran: true, workspaces: workspaceIds.length, snapshots };
  } finally {
    await release();
  }
}
