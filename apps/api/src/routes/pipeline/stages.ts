/**
 * CRUD + reorder de stages (PIPELINE.md 10/3.1/4.1, PERMISSIONS pipeline.edit).
 *
 * Endpoints sob /api, RLS via req.scoped:
 *   POST   /api/pipelines/:pipelineId/stages   cria stage             (pipeline.edit)
 *   PUT    /api/stages/:id                      atualiza stage          (pipeline.edit)
 *   PATCH  /api/stages/reorder                  reordena positions      (pipeline.edit)
 *   DELETE /api/stages/:id?fallbackStageId=...  remove + realoca deals  (pipeline.edit)
 *
 * Delete: deals.stage_id e ON DELETE RESTRICT (schema) -> antes de apagar, os deals
 * sao movidos atomicamente para fallbackStageId (mesmo pipeline). reorder usa um
 * two-phase (offset temporario) p/ nao violar UNIQUE(pipeline_id, position).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { automationRuleSchema, param, transitionRulesSchema } from './pipelines';

const { stages, deals } = schema;

const createStageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(64).nullish(),
  position: z.number().int().min(0),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  probability: z.number().min(0).max(100).nullish(),
  automationRules: z.array(automationRuleSchema).optional(),
  transitionRules: transitionRulesSchema.optional(),
});

const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(64).nullish(),
  position: z.number().int().min(0).optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  probability: z.number().min(0).max(100).nullish(),
  automationRules: z.array(automationRuleSchema).optional(),
  transitionRules: transitionRulesSchema.optional(),
});

const reorderSchema = z.object({
  pipelineId: z.string().uuid(),
  order: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })).min(1),
});

export function createStagesRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('pipeline.edit')] as const;

  // PATCH /api/stages/reorder — ANTES de /:id para nao colidir.
  router.patch('/api/stages/reorder', ...editGuard, async (req: Request, res: Response) => {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { pipelineId, order } = parsed.data;
    const ids = order.map((o) => o.id);
    try {
      await req.scoped!(async (tx) => {
        const owned = await tx
          .select({ id: stages.id })
          .from(stages)
          .where(and(eq(stages.pipelineId, pipelineId), inArray(stages.id, ids)));
        if (owned.length !== ids.length) throw new Error('stage_pipeline_mismatch');
        // Two-phase: desloca p/ faixa temporaria (evita colisao no UNIQUE).
        await tx
          .update(stages)
          .set({ position: sql`${stages.position} + 100000`, updatedAt: new Date() })
          .where(eq(stages.pipelineId, pipelineId));
        for (const o of order) {
          await tx
            .update(stages)
            .set({ position: o.position, updatedAt: new Date() })
            .where(eq(stages.id, o.id));
        }
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'stage_pipeline_mismatch') {
        res.status(400).json({ error: 'stage_pipeline_mismatch' });
        return;
      }
      throw err;
    }
    res.sendStatus(204);
  });

  // POST /api/pipelines/:pipelineId/stages — cria stage.
  router.post(
    '/api/pipelines/:pipelineId/stages',
    ...editGuard,
    async (req: Request, res: Response) => {
      const parsed = createStageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const pipelineId = param(req, 'pipelineId');
      const workspaceId = req.auth!.workspace.id;
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(stages)
          .values({
            workspaceId,
            pipelineId,
            name: parsed.data.name,
            color: parsed.data.color ?? '#1FFF13',
            icon: parsed.data.icon ?? null,
            position: parsed.data.position,
            isWon: parsed.data.isWon ?? false,
            isLost: parsed.data.isLost ?? false,
            probability: parsed.data.probability == null ? null : String(parsed.data.probability),
            automationRules: parsed.data.automationRules ?? [],
            transitionRules: parsed.data.transitionRules ?? {},
          })
          .returning(),
      );
      res.status(201).json({ stage: created });
    },
  );

  // PUT /api/stages/:id — atualiza.
  router.put('/api/stages/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateStageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      patch[k] = k === 'probability' && v !== null ? String(v) : v;
    }
    const [updated] = await req.scoped!((tx) =>
      tx.update(stages).set(patch).where(eq(stages.id, id)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ stage: updated });
  });

  // DELETE /api/stages/:id — realoca deals p/ fallbackStageId e remove.
  router.delete('/api/stages/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const fallbackRaw = req.query['fallbackStageId'];
    const fallbackStageId = typeof fallbackRaw === 'string' ? fallbackRaw : '';
    const outcome = await req.scoped!(async (tx) => {
      const [target] = await tx.select().from(stages).where(eq(stages.id, id)).limit(1);
      if (!target) return { kind: 'not_found' as const };

      const [openDeal] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.stageId, id))
        .limit(1);

      if (openDeal) {
        if (!fallbackStageId) return { kind: 'needs_fallback' as const };
        const [fallback] = await tx
          .select()
          .from(stages)
          .where(and(eq(stages.id, fallbackStageId), eq(stages.pipelineId, target.pipelineId)))
          .limit(1);
        if (!fallback) return { kind: 'bad_fallback' as const };
        await tx
          .update(deals)
          .set({ stageId: fallbackStageId, updatedAt: new Date() })
          .where(eq(deals.stageId, id));
      }
      await tx.delete(stages).where(eq(stages.id, id));
      return { kind: 'ok' as const };
    });

    if (outcome.kind === 'not_found') return void res.sendStatus(404);
    if (outcome.kind === 'needs_fallback')
      return void res.status(409).json({ error: 'fallback_stage_required' });
    if (outcome.kind === 'bad_fallback')
      return void res.status(400).json({ error: 'invalid_fallback_stage' });
    res.sendStatus(204);
  });

  return router;
}
