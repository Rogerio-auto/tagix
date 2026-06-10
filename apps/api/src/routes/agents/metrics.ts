/**
 * Métricas agregadas de um agente para a aba Metrics do detalhe (F2-S18).
 *
 * `GET /api/agents/:id/metrics` devolve as linhas de `agent_metrics` (day/week/month,
 * RLS-escopadas) do agente, mais recentes primeiro. `numeric`/`bigint` são
 * normalizados para `number` no payload.
 *
 * Gap-fill de orquestração: complementa o F2-S16; a aba Metrics (F2-S18) consome
 * este contrato.
 */
import { Router, type Request, type Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export function createAgentMetricsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;

  router.get('/api/agents/:id/metrics', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }

    const rows = await req.scoped!((tx) =>
      tx
        .select({
          period: schema.agentMetrics.period,
          periodStart: schema.agentMetrics.periodStart,
          totalConversations: schema.agentMetrics.totalConversations,
          totalMessages: schema.agentMetrics.totalMessages,
          totalTokens: schema.agentMetrics.totalTokens,
          totalCostUsd: schema.agentMetrics.totalCostUsd,
          avgLatencyMs: schema.agentMetrics.avgLatencyMs,
          handoffCount: schema.agentMetrics.handoffCount,
          errorCount: schema.agentMetrics.errorCount,
        })
        .from(schema.agentMetrics)
        .where(eq(schema.agentMetrics.agentId, id))
        .orderBy(desc(schema.agentMetrics.periodStart)),
    );

    const metrics = rows.map((m) => ({
      period: m.period,
      periodStart: m.periodStart,
      totalConversations: m.totalConversations,
      totalMessages: m.totalMessages,
      totalTokens: m.totalTokens, // bigint mode:'number'
      totalCostUsd: Number(m.totalCostUsd), // numeric → string → number
      avgLatencyMs: m.avgLatencyMs,
      handoffCount: m.handoffCount,
      errorCount: m.errorCount,
    }));

    res.json({ metrics });
  });

  return router;
}
