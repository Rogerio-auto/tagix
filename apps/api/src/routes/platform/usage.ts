/**
 * API de plataforma — rollup de custo LLM (F25-S05).
 *
 *   GET /api/platform/usage/summary?from=&to=&groupBy=workspace|model|day
 *   GET /api/platform/usage/top-spenders?period=month
 *   GET /api/platform/usage/cap-alerts
 *
 * Agrega `llm_usage_logs` cross-workspace → roda sob `getDb()` (owner, sem RLS de
 * tenant; o guard é a fronteira). Usa os índices existentes (workspace/model/created).
 * Cap-alerts cruza com `workspace_agent_policies.max_monthly_cost_usd`.
 * Gated por `requirePlatformAdmin`. Wire em app.ts é do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';

const { llmUsageLogs, workspaces, workspaceAgentPolicies } = schema;

const summaryQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupBy: z.enum(['workspace', 'model', 'day']),
});

const capQuery = z.object({
  threshold: z.coerce.number().min(0).max(1).default(0.8),
});

/** Início do mês corrente (UTC). */
function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function createPlatformUsageRouter(): Router {
  const router = Router();
  const db = getDb();

  // ─── summary ───────────────────────────────────────────────────────────────
  router.get(
    '/api/platform/usage/summary',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const parsed = summaryQuery.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
        return;
      }
      const { from, to, groupBy } = parsed.data;

      const conds = [];
      if (from) conds.push(gte(llmUsageLogs.createdAt, new Date(from)));
      if (to) conds.push(lte(llmUsageLogs.createdAt, new Date(to)));
      const where = conds.length > 0 ? and(...conds) : undefined;

      const cost = sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`;
      const tokens = sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`;
      const requests = sql<number>`count(*)::int`;

      if (groupBy === 'day') {
        const day = sql<string>`to_char(${llmUsageLogs.createdAt}, 'YYYY-MM-DD')`;
        const rows = await db
          .select({ key: day, costUsd: cost, totalTokens: tokens, requests })
          .from(llmUsageLogs)
          .where(where)
          .groupBy(day)
          .orderBy(day);
        res.json({
          buckets: rows.map((r) => ({ ...r, label: r.key })),
        });
        return;
      }

      if (groupBy === 'model') {
        const rows = await db
          .select({ key: llmUsageLogs.model, costUsd: cost, totalTokens: tokens, requests })
          .from(llmUsageLogs)
          .where(where)
          .groupBy(llmUsageLogs.model)
          .orderBy(desc(cost));
        res.json({ buckets: rows.map((r) => ({ ...r, label: r.key })) });
        return;
      }

      // groupBy === 'workspace'
      const rows = await db
        .select({
          key: llmUsageLogs.workspaceId,
          label: sql<string>`coalesce(${workspaces.name}, ${llmUsageLogs.workspaceId}::text)`,
          costUsd: cost,
          totalTokens: tokens,
          requests,
        })
        .from(llmUsageLogs)
        .leftJoin(workspaces, eq(workspaces.id, llmUsageLogs.workspaceId))
        .where(where)
        .groupBy(llmUsageLogs.workspaceId, workspaces.name)
        .orderBy(desc(cost));
      res.json({ buckets: rows });
    },
  );

  // ─── top-spenders ────────────────────────────────────────────────────────────
  router.get(
    '/api/platform/usage/top-spenders',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const limit = z.coerce.number().int().min(1).max(100).default(10).parse(req.query['limit']);
      const cost = sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`;
      const tokens = sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`;
      const rows = await db
        .select({
          workspaceId: llmUsageLogs.workspaceId,
          workspaceName: sql<string>`coalesce(${workspaces.name}, ${llmUsageLogs.workspaceId}::text)`,
          costUsd: cost,
          totalTokens: tokens,
        })
        .from(llmUsageLogs)
        .leftJoin(workspaces, eq(workspaces.id, llmUsageLogs.workspaceId))
        .where(gte(llmUsageLogs.createdAt, monthStart()))
        .groupBy(llmUsageLogs.workspaceId, workspaces.name)
        .orderBy(desc(cost))
        .limit(limit);
      res.json({ spenders: rows });
    },
  );

  // ─── cap-alerts ──────────────────────────────────────────────────────────────
  router.get(
    '/api/platform/usage/cap-alerts',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const { threshold } = capQuery.parse(req.query);

      // Gasto-mês por workspace (subquery) × policy.max_monthly_cost_usd (cap definido).
      const spend = db
        .select({
          workspaceId: llmUsageLogs.workspaceId,
          monthCost: sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`.as('month_cost'),
        })
        .from(llmUsageLogs)
        .where(gte(llmUsageLogs.createdAt, monthStart()))
        .groupBy(llmUsageLogs.workspaceId)
        .as('spend');

      const rows = await db
        .select({
          workspaceId: workspaceAgentPolicies.workspaceId,
          workspaceName: sql<string>`coalesce(${workspaces.name}, ${workspaceAgentPolicies.workspaceId}::text)`,
          monthCostUsd: sql<number>`coalesce(${spend.monthCost}, 0)::float8`,
          capUsd: sql<number>`${workspaceAgentPolicies.maxMonthlyCostUsd}::float8`,
          pctOfCap: sql<number>`(coalesce(${spend.monthCost}, 0) / nullif(${workspaceAgentPolicies.maxMonthlyCostUsd}, 0))::float8`,
        })
        .from(workspaceAgentPolicies)
        .leftJoin(workspaces, eq(workspaces.id, workspaceAgentPolicies.workspaceId))
        .leftJoin(spend, eq(spend.workspaceId, workspaceAgentPolicies.workspaceId))
        .where(
          and(
            isNotNull(workspaceAgentPolicies.maxMonthlyCostUsd),
            sql`coalesce(${spend.monthCost}, 0) >= ${threshold} * ${workspaceAgentPolicies.maxMonthlyCostUsd}`,
          ),
        )
        .orderBy(desc(sql`coalesce(${spend.monthCost}, 0) / nullif(${workspaceAgentPolicies.maxMonthlyCostUsd}, 0)`));

      res.json({ threshold, alerts: rows });
    },
  );

  return router;
}
