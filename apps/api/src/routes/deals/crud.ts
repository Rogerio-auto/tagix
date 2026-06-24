/**
 * CRUD + lifecycle de deals (PIPELINE.md 10, PERMISSIONS deal.*).
 *
 * Endpoints sob /api/deals, RLS via req.scoped:
 *   GET    /api/deals?pipelineId=&stageId=   lista filtrada           (deal.edit)
 *   POST   /api/deals                        cria deal                (deal.edit)
 *   GET    /api/deals/:id                    detalhe                  (deal.edit)
 *   PUT    /api/deals/:id                    update (nao muda stage)  (deal.edit)
 *   POST   /api/deals/:id/move-stage         move (-> moveDealToStage)(deal.move)
 *   POST   /api/deals/:id/close-won          fecha ganho              (deal.edit)
 *   POST   /api/deals/:id/close-lost         fecha perdido            (deal.edit)
 *   POST   /api/deals/:id/reopen             reabre                   (deal.edit)
 *   GET    /api/deals/:id/history            audit log                (deal.edit)
 *
 * Move usa o servico central deal-move.ts (transition rules + history + seam).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  TransitionError,
  moveDealToStage,
  type DealActor,
} from '../../services/deal-move';
import { emitDealCreated, emitDealUpdated } from '../../services/deal-events';
import { loadContactReadThrough } from '../pipeline/deal-conversation';

const { deals, dealHistory } = schema;

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

function memberActor(req: Request): DealActor {
  return {
    type: 'member',
    memberId: req.auth!.member.id,
    role: req.auth!.member.role as Role,
  };
}

const createDealSchema = z.object({
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid(),
  contactId: z.string().uuid(),
  conversationId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(200),
  valueCents: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  source: z.string().trim().max(64).nullish(),
  ownerId: z.string().uuid().nullish(),
  customFields: z.record(z.unknown()).optional(),
  notes: z.string().trim().max(5000).nullish(),
});

const updateDealSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  valueCents: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  source: z.string().trim().max(64).nullish(),
  ownerId: z.string().uuid().nullish(),
  conversationId: z.string().uuid().nullish(),
  customFields: z.record(z.unknown()).optional(),
  notes: z.string().trim().max(5000).nullish(),
});

const moveSchema = z.object({ stageId: z.string().uuid() });
const closeLostSchema = z.object({ reason: z.string().trim().max(500).optional() });

export function createDealsCrudRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('deal.edit')] as const;
  const moveGuard = [requireAuth, withRLS, requireRole('deal.move')] as const;

  // GET /api/deals?pipelineId=&stageId= — lista filtrada.
  router.get('/api/deals', ...editGuard, async (req: Request, res: Response) => {
    const pipelineId = typeof req.query['pipelineId'] === 'string' ? req.query['pipelineId'] : '';
    const stageId = typeof req.query['stageId'] === 'string' ? req.query['stageId'] : '';
    const filters: SQL[] = [];
    if (pipelineId) filters.push(eq(deals.pipelineId, pipelineId));
    if (stageId) filters.push(eq(deals.stageId, stageId));
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(deals)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(deals.stageId), asc(deals.position), desc(deals.createdAt)),
    );
    res.json({ deals: rows });
  });

  // POST /api/deals — cria.
  router.post('/api/deals', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createDealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    const result = await req.scoped!(async (tx) => {
      const [created] = await tx
        .insert(deals)
        .values({
          workspaceId,
          pipelineId: d.pipelineId,
          stageId: d.stageId,
          contactId: d.contactId,
          conversationId: d.conversationId ?? null,
          title: d.title,
          valueCents: d.valueCents ?? 0,
          currency: d.currency ?? 'BRL',
          source: d.source ?? null,
          ownerId: d.ownerId ?? null,
          customFields: d.customFields ?? {},
          notes: d.notes ?? null,
        })
        .returning();
      if (created) {
        await tx.insert(dealHistory).values({
          dealId: created.id,
          workspaceId,
          eventType: 'created',
          actorMemberId: req.auth!.member.id,
          actorType: 'member',
        });
      }
      return created;
    });
    if (result) void emitDealCreated({ workspaceId, deal: result });
    res.status(201).json({ deal: result });
  });

  // GET /api/deals/:id — detalhe + cadastro VIVO do contato (read-through, F47-S15).
  // Consolidado aqui (antes havia um shadow em pipeline/deal-conversation.ts).
  router.get('/api/deals/:id', ...editGuard, async (req: Request, res: Response) => {
    const result = await req.scoped!(async (tx) => {
      const [deal] = await tx
        .select()
        .from(deals)
        .where(eq(deals.id, param(req, 'id')))
        .limit(1);
      if (!deal) return null;
      const contact = await loadContactReadThrough(tx, deal.contactId);
      return { deal, contact };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ deal: result.deal, contact: result.contact });
  });

  // PUT /api/deals/:id — update (NAO muda stage).
  router.put('/api/deals/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateDealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = v;
    }
    const [updated] = await req.scoped!((tx) =>
      tx.update(deals).set(patch).where(eq(deals.id, id)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    void emitDealUpdated({ workspaceId: req.auth!.workspace.id, deal: updated });
    res.json({ deal: updated });
  });

  // POST /api/deals/:id/move-stage — move via servico central.
  router.post('/api/deals/:id/move-stage', ...moveGuard, async (req: Request, res: Response) => {
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    try {
      const result = await req.scoped!((tx) =>
        moveDealToStage(tx, {
          dealId: id,
          newStageId: parsed.data.stageId,
          actor: memberActor(req),
          workspaceId,
        }),
      );
      res.json({ deal: result.deal, fromStageId: result.fromStageId, toStageId: result.toStageId });
    } catch (err: unknown) {
      if (err instanceof TransitionError) {
        res.status(422).json({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof Error && (err.message === 'deal_not_found' || err.message === 'stage_not_found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // POST /api/deals/:id/close-won — fecha ganho.
  router.post('/api/deals/:id/close-won', ...editGuard, async (req: Request, res: Response) => {
    await closeDeal(req, res, true);
  });

  // POST /api/deals/:id/close-lost — fecha perdido.
  router.post('/api/deals/:id/close-lost', ...editGuard, async (req: Request, res: Response) => {
    const parsed = closeLostSchema.safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;
    await closeDeal(req, res, false, reason);
  });

  // POST /api/deals/:id/reopen — reabre.
  router.post('/api/deals/:id/reopen', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const updated = await req.scoped!(async (tx) => {
      const [row] = await tx
        .update(deals)
        .set({ closedAt: null, closedWon: null, updatedAt: new Date() })
        .where(eq(deals.id, id))
        .returning();
      if (row) {
        await tx.insert(dealHistory).values({
          dealId: id,
          workspaceId,
          eventType: 'reopened',
          actorMemberId: req.auth!.member.id,
          actorType: 'member',
        });
      }
      return row;
    });
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ deal: updated });
  });

  // GET /api/deals/:id/history — audit log.
  router.get('/api/deals/:id/history', ...editGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(dealHistory)
        .where(eq(dealHistory.dealId, param(req, 'id')))
        .orderBy(desc(dealHistory.createdAt)),
    );
    res.json({ history: rows });
  });

  return router;
}

async function closeDeal(
  req: Request,
  res: Response,
  won: boolean,
  reason?: string,
): Promise<void> {
  const id = param(req, 'id');
  const workspaceId = req.auth!.workspace.id;
  const updated = await req.scoped!(async (tx) => {
    const [row] = await tx
      .update(deals)
      .set({ closedAt: new Date(), closedWon: won, updatedAt: new Date() })
      .where(eq(deals.id, id))
      .returning();
    if (row) {
      await tx.insert(dealHistory).values({
        dealId: id,
        workspaceId,
        eventType: 'closed',
        toValue: { closedWon: won, reason: reason ?? null },
        actorMemberId: req.auth!.member.id,
        actorType: 'member',
      });
    }
    return row;
  });
  if (!updated) {
    res.sendStatus(404);
    return;
  }
  res.json({ deal: updated });
}
