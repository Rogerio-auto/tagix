/**
 * Metricas + deliveries da campanha (CAMPAIGNS.md 11, 13).
 * GET /api/campaigns/:id/metrics    -> snapshot rolling (campaign.view_metrics)
 * GET /api/campaigns/:id/deliveries -> lista paginada (campaign.view_metrics)
 * RLS via req.scoped.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { campaignMetrics, campaignDeliveries } = schema;

const deliveriesQuery = z.object({
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'blocked']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function createCampaignsMetricsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('campaign.view_metrics')] as const;

  router.get('/api/campaigns/:id/metrics', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [metrics] = await req.scoped!((tx) =>
      tx.select().from(campaignMetrics).where(eq(campaignMetrics.campaignId, id)),
    );
    if (!metrics) {
      res.sendStatus(404);
      return;
    }
    res.json({ metrics });
  });

  router.get('/api/campaigns/:id/deliveries', ...viewGuard, async (req: Request, res: Response) => {
    const parsed = deliveriesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const filters = [eq(campaignDeliveries.campaignId, id)];
    if (parsed.data.status) filters.push(eq(campaignDeliveries.status, parsed.data.status));
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(campaignDeliveries)
        .where(and(...filters))
        .orderBy(desc(campaignDeliveries.queuedAt))
        .limit(parsed.data.limit ?? 100),
    );
    res.json({ deliveries: rows });
  });

  return router;
}
