/**
 * CRUD + ciclo de vida de flows (FLOW_BUILDER.md secao 7/10, PERMISSIONS flow.*).
 *
 * Endpoints (todos sob `/api/flows`, RLS via `req.scoped`):
 *   GET    /api/flows                 lista flows do workspace            (flow.list)
 *   GET    /api/flows/:id             detalhe + versions                  (flow.list)
 *   POST   /api/flows                 cria flow draft                     (flow.edit)
 *   PUT    /api/flows/:id             atualiza draft (nao publica)        (flow.edit)
 *   POST   /api/flows/:id/publish     valida -> nova version + ativa      (flow.publish)
 *   POST   /api/flows/:id/unpublish   status=paused (nao cancela exec)    (flow.publish)
 *   POST   /api/flows/:id/archive     status=archived                     (flow.edit)
 *   DELETE /api/flows/:id             exclui definitivamente + historico  (flow.edit)
 *   POST   /api/flows/:id/trigger     dispara manual                      (flow.trigger)
 *   GET    /api/flows/:id/versions    historico de versions               (flow.list)
 *   PATCH  /api/flows/manual-order    atualiza manual_position (FX-029a)  (flow.edit)
 *
 * publish referencia secao 7: snapshot imutavel em flow_versions; execucoes em curso
 * apontam para flow_version_id e nao sao afetadas por re-publish.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, desc, eq, max } from 'drizzle-orm';
import { schema } from '@hm/db';
import { validateFlow } from '@hm/flow-engine';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { flowEngine } from './engine';

const { flows, flowVersions, flowExecutions } = schema;

/** Narrowing de req.params (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const TRIGGER_TYPES = [
  'manual',
  'stage_change',
  'tag_added',
  'keyword',
  'new_lead',
  'new_message',
  'system_event',
  'flow_submission',
] as const;

const nodeSchema = z.object({}).passthrough();
const edgeSchema = z.object({}).passthrough();

const createFlowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullish(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).optional(),
  channelIds: z.array(z.string().uuid()).optional(),
});

const updateFlowSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullish(),
  triggerType: z.enum(TRIGGER_TYPES).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  filterStatus: z.array(z.string()).nullish(),
  filterStageIds: z.array(z.string().uuid()).nullish(),
  filterTagIds: z.array(z.string().uuid()).nullish(),
  channelIds: z.array(z.string().uuid()).nullish(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

const triggerSchema = z.object({
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  triggerData: z.record(z.unknown()).optional(),
});

const manualOrderSchema = z.object({
  order: z
    .array(z.object({ id: z.string().uuid(), manualPosition: z.number().int().min(0) }))
    .min(1),
});

export function createFlowsCrudRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('flow.list')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('flow.edit')] as const;
  const publishGuard = [requireAuth, withRLS, requireRole('flow.publish')] as const;
  const triggerGuard = [requireAuth, withRLS, requireRole('flow.trigger')] as const;

  // PATCH /api/flows/manual-order — ANTES de /:id rotas para nao colidir.
  router.patch('/api/flows/manual-order', ...editGuard, async (req: Request, res: Response) => {
    const parsed = manualOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    await req.scoped!(async (tx) => {
      for (const item of parsed.data.order) {
        await tx
          .update(flows)
          .set({ manualPosition: item.manualPosition, updatedAt: new Date() })
          .where(eq(flows.id, item.id));
      }
    });
    res.sendStatus(204);
  });

  // GET /api/flows — lista.
  router.get('/api/flows', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx.select().from(flows).orderBy(asc(flows.manualPosition), desc(flows.createdAt)),
    );
    res.json({ flows: rows });
  });

  // GET /api/flows/:id — detalhe + versions.
  router.get('/api/flows/:id', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [flow] = await tx.select().from(flows).where(eq(flows.id, id)).limit(1);
      if (!flow) return null;
      const versions = await tx
        .select()
        .from(flowVersions)
        .where(eq(flowVersions.flowId, id))
        .orderBy(desc(flowVersions.version));
      return { flow, versions };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  });

  // POST /api/flows — cria draft.
  router.post('/api/flows', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createFlowSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    const [created] = await req.scoped!((tx) =>
      tx
        .insert(flows)
        .values({
          workspaceId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          status: 'draft',
          triggerType: parsed.data.triggerType,
          triggerConfig: parsed.data.triggerConfig ?? {},
          channelIds: parsed.data.channelIds ?? null,
          createdBy: memberId,
        })
        .returning(),
    );
    res.status(201).json({ flow: created });
  });

  // PUT /api/flows/:id — atualiza draft (nao publica).
  router.put('/api/flows/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateFlowSchema.safeParse(req.body);
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
      tx.update(flows).set(patch).where(eq(flows.id, id)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ flow: updated });
  });

  // POST /api/flows/:id/publish — valida -> nova version + ativa.
  router.post('/api/flows/:id/publish', ...publishGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const memberId = req.auth!.member.id;
    const result = await req.scoped!(async (tx) => {
      const [flow] = await tx.select().from(flows).where(eq(flows.id, id)).limit(1);
      if (!flow) return { kind: 'not_found' as const };

      const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
      const edges = Array.isArray(flow.edges) ? flow.edges : [];
      const validation = validateFlow({ nodes: nodes as never, edges: edges as never });
      if (!validation.valid) {
        return { kind: 'invalid' as const, issues: validation.issues };
      }

      const [agg] = await tx
        .select({ maxVersion: max(flowVersions.version) })
        .from(flowVersions)
        .where(eq(flowVersions.flowId, id));
      const nextVersion = (agg?.maxVersion ?? 0) + 1;

      const [version] = await tx
        .insert(flowVersions)
        .values({
          flowId: id,
          version: nextVersion,
          nodes: flow.nodes,
          edges: flow.edges,
          triggerConfig: flow.triggerConfig,
          publishedBy: memberId,
        })
        .returning();

      const [activated] = await tx
        .update(flows)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(flows.id, id))
        .returning();

      return { kind: 'ok' as const, flow: activated, version };
    });

    if (result.kind === 'not_found') {
      res.sendStatus(404);
      return;
    }
    if (result.kind === 'invalid') {
      res.status(422).json({ error: 'validation_failed', issues: result.issues });
      return;
    }
    res.json({ flow: result.flow, version: result.version });
  });

  // POST /api/flows/:id/unpublish — status=paused (nao cancela execucoes).
  router.post('/api/flows/:id/unpublish', ...publishGuard, async (req: Request, res: Response) => {
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(flows)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(flows.id, param(req, 'id')))
        .returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ flow: updated });
  });

  // POST /api/flows/:id/archive — status=archived.
  router.post('/api/flows/:id/archive', ...editGuard, async (req: Request, res: Response) => {
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(flows)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(flows.id, param(req, 'id')))
        .returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ flow: updated });
  });

  // DELETE /api/flows/:id — exclui o flow definitivamente (e seu historico).
  router.delete('/api/flows/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const deleted = await req.scoped!(async (tx) => {
      const [flow] = await tx.select({ id: flows.id }).from(flows).where(eq(flows.id, id)).limit(1);
      if (!flow) return null;
      // flow_executions.flow_version_id e ON DELETE RESTRICT: apaga as execucoes (flow_logs
      // cascateiam por execution_id) ANTES do flow — cujo delete cascateia flow_versions.
      await tx.delete(flowExecutions).where(eq(flowExecutions.flowId, id));
      await tx.delete(flows).where(eq(flows.id, id));
      return flow;
    });
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  // GET /api/flows/:id/versions — historico.
  router.get('/api/flows/:id/versions', ...viewGuard, async (req: Request, res: Response) => {
    const versions = await req.scoped!((tx) =>
      tx
        .select()
        .from(flowVersions)
        .where(eq(flowVersions.flowId, param(req, 'id')))
        .orderBy(desc(flowVersions.version)),
    );
    res.json({ versions });
  });

  // POST /api/flows/:id/trigger — dispara manual.
  router.post('/api/flows/:id/trigger', ...triggerGuard, async (req: Request, res: Response) => {
    const parsed = triggerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;

    // So dispara flow ATIVO (precisa de version publicada).
    const flow = await req.scoped!(async (tx) => {
      const [row] = await tx.select().from(flows).where(eq(flows.id, id)).limit(1);
      return row ?? null;
    });
    if (!flow) {
      res.sendStatus(404);
      return;
    }
    if (flow.status !== 'active') {
      res.status(409).json({ error: 'flow_not_active' });
      return;
    }

    const { executionId } = await flowEngine.triggerFlow({
      workspaceId,
      flowId: id,
      conversationId: parsed.data.conversationId,
      contactId: parsed.data.contactId,
      triggerData: parsed.data.triggerData,
      triggeredBy: 'manual',
    });
    res.status(202).json({ executionId });
  });

  return router;
}
