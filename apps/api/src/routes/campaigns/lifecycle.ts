/**
 * Ciclo de vida da campanha: activate/pause/resume (CAMPAIGNS.md 4, 13).
 *
 * activate: re-roda validate; SO permite se safe=true (compliance dura). Marca
 * status running (ou scheduled se startAt futuro) e seeda campaign_metrics +
 * agenda next_tick_at=now() para o worker (F6-S05) pegar no proximo tick.
 * pause/resume alternam o status. RLS via req.scoped.
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';
import { validateCampaign } from './validate';
import { buildValidationCampaign, loadCampaignChannel, makeGraphPorts } from './service';

const { campaigns, campaignMetrics, campaignRecipients } = schema;

export function createCampaignsLifecycleRouter(): Router {
  const router = Router();
  const activateGuard = [requireAuth, withRLS, requireRole('campaign.activate')] as const;
  const pauseGuard = [requireAuth, withRLS, requireRole('campaign.pause')] as const;

  // POST /api/campaigns/:id/activate — valida e inicia (barra se safe=false).
  router.post('/api/campaigns/:id/activate', ...activateGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;

    const outcome = await req.scoped!(async (tx) => {
      const snap = await loadCampaignChannel(tx, id);
      if (!snap) return { kind: 'not_found' as const };
      if (!['draft', 'scheduled', 'paused'].includes(snap.campaign.status)) {
        return { kind: 'bad_state' as const, status: snap.campaign.status };
      }

      const vc = await buildValidationCampaign(tx, snap);
      const ports = makeGraphPorts(snap);
      const validation = await validateCampaign(vc, ports);
      if (!validation.safe) {
        return { kind: 'unsafe' as const, validation };
      }

      const startsInFuture = snap.campaign.startAt ? snap.campaign.startAt.getTime() > Date.now() : false;
      const nextStatus = startsInFuture ? 'scheduled' : 'running';

      const [updated] = await tx
        .update(campaigns)
        .set({
          status: nextStatus,
          nextTickAt: startsInFuture ? snap.campaign.startAt : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(campaigns.id, id))
        .returning();

      // Seeda/atualiza o snapshot de metricas com o total de recipients.
      await tx
        .insert(campaignMetrics)
        .values({ campaignId: id, workspaceId, totalRecipients: vc.recipientCount })
        .onConflictDoUpdate({
          target: campaignMetrics.campaignId,
          set: { totalRecipients: vc.recipientCount, updatedAt: new Date() },
        });

      return { kind: 'activated' as const, campaign: updated, validation };
    });

    switch (outcome.kind) {
      case 'not_found':
        res.sendStatus(404);
        return;
      case 'bad_state':
        res
          .status(409)
          .json({ error: 'bad_state', message: 'Campanha nao pode ser ativada no estado ' + outcome.status });
        return;
      case 'unsafe':
        res.status(422).json({ error: 'validation_failed', ...outcome.validation });
        return;
      case 'activated':
        res.json({ campaign: outcome.campaign, validation: outcome.validation });
        return;
    }
  });

  // POST /api/campaigns/:id/pause — pausa manual.
  router.post('/api/campaigns/:id/pause', ...pauseGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(campaigns)
        .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ campaign: updated });
  });

  // POST /api/campaigns/:id/resume — retoma uma campanha pausada.
  router.post('/api/campaigns/:id/resume', ...pauseGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
      if (!campaign) return null;
      if (campaign.status !== 'paused') return { kind: 'bad_state' as const, status: campaign.status };
      const [updated] = await tx
        .update(campaigns)
        .set({ status: 'running', nextTickAt: new Date(), updatedAt: new Date() })
        .where(eq(campaigns.id, id))
        .returning();
      // Recipients que estavam 'sending' voltam para pending (re-tentativa segura).
      await tx
        .update(campaignRecipients)
        .set({ status: 'pending' })
        .where(
          and(
            eq(campaignRecipients.campaignId, id),
            eq(campaignRecipients.status, 'sending'),
          ),
        );
      return { kind: 'resumed' as const, campaign: updated };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    if (result.kind === 'bad_state') {
      res.status(409).json({ error: 'bad_state', message: 'So campanhas pausadas podem ser retomadas.' });
      return;
    }
    res.json({ campaign: result.campaign });
  });

  return router;
}
