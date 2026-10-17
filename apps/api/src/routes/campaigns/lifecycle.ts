/**
 * Ciclo de vida da campanha: activate/pause/resume (CAMPAIGNS.md 4, 13).
 *
 * activate: re-roda validate; SO permite se safe=true (compliance dura). Marca
 * `running` (ou `scheduled` se startAt futuro) e seeda campaign_metrics. A
 * agendada e promovida a `running` pelo worker quando startAt vence (F58-S11).
 * pause/resume alternam o status. RLS via req.scoped.
 *
 * F73-S09: pause/resume (e a trilha de status) vivem em `services/campaigns/lifecycle`,
 * o mesmo servico que o Copiloto usa; a rota delega sem mudar o comportamento.
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
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  CAMPAIGN_ENDED_MESSAGE,
  hasEnded,
  pauseCampaign,
  recordMemberStatusChange,
  resumeCampaign,
  type CampaignActor,
} from '../../services/campaigns/lifecycle';
import { param } from '../conversions/types';
import { validateCampaign } from './validate';
import { buildValidationCampaign, loadCampaignChannel, makeGraphPorts } from './service';

const { campaigns, campaignMetrics } = schema;

/** Mensagens das recusas por prazo (o cliente entende sem ler documentacao). */
const ENDED_MESSAGE = CAMPAIGN_ENDED_MESSAGE;
const INVALID_WINDOW_MESSAGE = 'A data final precisa ser depois do início do envio.';

/** O membro autenticado como ator do servico de ciclo de vida. */
function actorOf(req: Request): CampaignActor {
  return {
    workspaceId: req.auth!.workspace.id,
    memberId: req.auth!.member.id,
    role: req.auth!.member.role as Role,
  };
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
        actorOf(req),
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
  // F73-S09: a transicao vive no servico de dominio (`services/campaigns/lifecycle`), o mesmo
  // que o Copiloto usa; a rota so traduz o desfecho em HTTP.
  router.post('/api/campaigns/:id/pause', ...pauseGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!((tx) => pauseCampaign(tx, actorOf(req), id));
    if (result.kind === 'not_found') {
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
    const result = await req.scoped!((tx) => resumeCampaign(tx, actorOf(req), id));
    if (result.kind === 'not_found') {
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
