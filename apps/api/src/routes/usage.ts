/**
 * API de uso e custo LLM do WORKSPACE (workspace-scoped). Espelha o rollup de
 * plataforma (F25-S05), porém limitado ao tenant via RLS (`req.scoped` →
 * `app.workspace_id`). Alimenta a página `/settings/usage` — destino de drill dos
 * cards "Custo IA" do dashboard (DASHBOARD.md §319, roles ADMIN_RO).
 *
 *   GET /api/usage/summary?groupBy=day|model&from=&to=
 *   GET /api/usage/totals
 *
 * Gated por `agent.view_costs` (OWNER/ADMIN/READONLY — idêntico ao público dos
 * cards). Exclui `is_test=true` (gasto do Agent Playground não é billing real,
 * espelhando o rollup de produção — ver schema `llm_usage_logs`).
 */
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { z } from 'zod';
import { requireAuth, requireRole, withRLS } from '../middlewares/auth';

const { llmUsageLogs } = schema;

const summaryQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupBy: z.enum(['day', 'model']),
});

/** Início do dia corrente (UTC). */
function dayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Início do mês corrente (UTC). */
function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function createUsageRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('agent.view_costs')] as const;

  const cost = sql<number>`coalesce(sum(${llmUsageLogs.costUsd}), 0)::float8`;
  const tokens = sql<number>`coalesce(sum(${llmUsageLogs.totalTokens}), 0)::int`;
  const requests = sql<number>`count(*)::int`;
  const notTest = eq(llmUsageLogs.isTest, false);

  // ─── summary (por dia | por modelo) ──────────────────────────────────────────
  router.get('/api/usage/summary', ...guard, async (req: Request, res: Response) => {
    const parsed = summaryQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { from, to, groupBy } = parsed.data;

    const conds = [notTest];
    if (from) conds.push(gte(llmUsageLogs.createdAt, new Date(from)));
    if (to) conds.push(lte(llmUsageLogs.createdAt, new Date(to)));
    const where = and(...conds);

    const buckets = await req.scoped!(async (tx) => {
      if (groupBy === 'model') {
        const rows = await tx
          .select({ key: llmUsageLogs.model, costUsd: cost, totalTokens: tokens, requests })
          .from(llmUsageLogs)
          .where(where)
          .groupBy(llmUsageLogs.model)
          .orderBy(desc(cost));
        return rows.map((r) => ({ ...r, label: r.key }));
      }
      const day = sql<string>`to_char(${llmUsageLogs.createdAt}, 'YYYY-MM-DD')`;
      const rows = await tx
        .select({ key: day, costUsd: cost, totalTokens: tokens, requests })
        .from(llmUsageLogs)
        .where(where)
        .groupBy(day)
        .orderBy(day);
      return rows.map((r) => ({ ...r, label: r.key }));
    });

    res.json({ buckets });
  });

  // ─── totals (hoje × mês) ─────────────────────────────────────────────────────
  router.get('/api/usage/totals', ...guard, async (req: Request, res: Response) => {
    const totals = await req.scoped!(async (tx) => {
      const sumSince = async (since: Date) => {
        const rows = await tx
          .select({ costUsd: cost, totalTokens: tokens, requests })
          .from(llmUsageLogs)
          .where(and(notTest, gte(llmUsageLogs.createdAt, since)));
        return rows[0] ?? { costUsd: 0, totalTokens: 0, requests: 0 };
      };
      // Sequencial: mesma transação RLS (tx não é concurrency-safe).
      const today = await sumSince(dayStart());
      const month = await sumSince(monthStart());
      return { today, month };
    });

    res.json(totals);
  });

  return router;
}
