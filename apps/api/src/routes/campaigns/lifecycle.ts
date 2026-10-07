/**
 * Ciclo de vida da campanha: activate/pause/resume (CAMPAIGNS.md 4, 13).
 *
 * activate: re-roda validate; SO permite se safe=true (compliance dura). Marca
 * `running` (ou `scheduled` se startAt futuro) e seeda campaign_metrics. A
 * agendada e promovida a `running` pelo worker quando startAt vence (F58-S11).
 * pause/resume alternam o status. RLS via req.scoped.
 *
 * F58-S11:
 *  - prazo final (endAt) ja vencido nao ativa nem retoma: a campanha nao
 *    enviaria nada e fecharia no tick seguinte — o cliente recebe o motivo agora;
 *  - pausa so de `running`/`scheduled` (antes "pausava" ate campanha concluida);
 *  - retomar com startAt ainda no futuro volta para `scheduled`, nao `running`;
 *  - toda mudanca de status grava motivo em audit_logs (o detalhe da campanha
 *    mostra o ultimo: quem pausou, por que, o que fazer).
 */
import { Router, type Request, type Response } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';
import { validateCampaign } from './validate';
import { buildValidationCampaign, loadCampaignChannel, makeGraphPorts } from './service';

const { campaigns, campaignMetrics, campaignRecipients, auditLogs } = schema;

/** Mensagens das recusas por prazo (o cliente entende sem ler documentacao). */
const ENDED_MESSAGE =
  'O prazo final desta campanha já passou. Ajuste a data final ou duplique a campanha para enviar de novo.';
const INVALID_WINDOW_MESSAGE = 'A data final precisa ser depois do início do envio.';

/** Ação de ciclo de vida registrada pela pessoa (o worker registra as automáticas). */
type MemberStatusAction = 'campaign.started' | 'campaign.scheduled' | 'campaign.paused' | 'campaign.resumed';

async function recordMemberStatusChange(
  tx: DbTx,
  req: Request,
  campaignId: string,
  action: MemberStatusAction,
  reason: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: req.auth!.workspace.id,
    actorMemberId: req.auth!.member.id,
    actorType: 'member',
    action,
    resourceType: 'campaign',
    resourceId: campaignId,
    metadata: { reason, message, ...extra },
  });
}

/** Prazo final ja vencido em `now`? */
function hasEnded(endAt: Date | null, now: Date): boolean {
  return endAt !== null && endAt.getTime() <= now.getTime();
}

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

      const now = new Date();
      const { startAt, endAt } = snap.campaign;
      if (hasEnded(endAt, now)) return { kind: 'ended' as const };
      if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
        return { kind: 'invalid_window' as const };
      }

      const vc = await buildValidationCampaign(tx, snap);
      const ports = makeGraphPorts(snap);
      const validation = await validateCampaign(vc, ports);
      if (!validation.safe) {
        return { kind: 'unsafe' as const, validation };
      }

      const startsInFuture = startAt ? startAt.getTime() > now.getTime() : false;
      const nextStatus = startsInFuture ? 'scheduled' : 'running';

      const [updated] = await tx
        .update(campaigns)
        .set({
          status: nextStatus,
          nextTickAt: startsInFuture ? startAt : now,
          updatedAt: now,
        })
        .where(eq(campaigns.id, id))
        .returning();

      await recordMemberStatusChange(
        tx,
        req,
        id,
        startsInFuture ? 'campaign.scheduled' : 'campaign.started',
        startsInFuture ? 'scheduled' : 'activated',
        startsInFuture
          ? 'Agendada. O envio começa sozinho na data de início.'
          : 'Envio iniciado.',
        startsInFuture && startAt ? { startAt: startAt.toISOString() } : {},
      );

      // Seeda/atualiza o snapshot de metricas com o total de recipients.
      await tx
        .insert(campaignMetrics)
        .values({ campaignId: id, workspaceId, totalRecipients: vc.recipientCount })
        .onConflictDoUpdate({
          target: campaignMetrics.campaignId,
          set: { totalRecipients: vc.recipientCount, updatedAt: now },
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
      case 'ended':
        res.status(422).json({ error: 'campaign_ended', message: ENDED_MESSAGE });
        return;
      case 'invalid_window':
        res.status(422).json({ error: 'invalid_schedule', message: INVALID_WINDOW_MESSAGE });
        return;
      case 'unsafe':
        res.status(422).json({ error: 'validation_failed', ...outcome.validation });
        return;
      case 'activated':
        res.json({ campaign: outcome.campaign, validation: outcome.validation });
        return;
    }
  });

  // POST /api/campaigns/:id/pause — pausa manual (so do que esta enviando ou agendado).
  router.post('/api/campaigns/:id/pause', ...pauseGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [updated] = await tx
        .update(campaigns)
        .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
        .where(and(eq(campaigns.id, id), inArray(campaigns.status, ['running', 'scheduled'])))
        .returning();
      if (updated) {
        await recordMemberStatusChange(tx, req, id, 'campaign.paused', 'manual', 'Pausada manualmente.');
        return { kind: 'paused' as const, campaign: updated };
      }
      const [current] = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id));
      return current ? { kind: 'bad_state' as const, status: current.status } : null;
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    if (result.kind === 'bad_state') {
      res.status(409).json({
        error: 'bad_state',
        message: 'So campanhas enviando ou agendadas podem ser pausadas.',
        status: result.status,
      });
      return;
    }
    res.json({ campaign: result.campaign });
  });

  // POST /api/campaigns/:id/resume — retoma uma campanha pausada.
  router.post('/api/campaigns/:id/resume', ...pauseGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
      if (!campaign) return null;
      if (campaign.status !== 'paused') return { kind: 'bad_state' as const, status: campaign.status };
      const now = new Date();
      if (hasEnded(campaign.endAt, now)) return { kind: 'ended' as const };

      // Recipients que estavam 'sending' voltam para pending (re-tentativa segura).
      // ANTES da linha da campanha: mesma ordem de locks do dispatch do worker
      // (recipient -> campanha), sem ciclo de espera com um envio em voo.
      await tx
        .update(campaignRecipients)
        .set({ status: 'pending' })
        .where(
          and(
            eq(campaignRecipients.campaignId, id),
            eq(campaignRecipients.status, 'sending'),
          ),
        );

      const startsInFuture = campaign.startAt ? campaign.startAt.getTime() > now.getTime() : false;
      const [updated] = await tx
        .update(campaigns)
        .set({
          status: startsInFuture ? 'scheduled' : 'running',
          nextTickAt: startsInFuture ? campaign.startAt : now,
          updatedAt: now,
        })
        .where(and(eq(campaigns.id, id), eq(campaigns.status, 'paused')))
        .returning();
      if (!updated) return { kind: 'bad_state' as const, status: 'changed' };
      await recordMemberStatusChange(
        tx,
        req,
        id,
        'campaign.resumed',
        startsInFuture ? 'resumed_scheduled' : 'resumed',
        startsInFuture
          ? 'Retomada. O envio começa sozinho na data de início.'
          : 'Envio retomado.',
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
    if (result.kind === 'ended') {
      res.status(409).json({ error: 'campaign_ended', message: ENDED_MESSAGE });
      return;
    }
    res.json({ campaign: result.campaign });
  });

  return router;
}
