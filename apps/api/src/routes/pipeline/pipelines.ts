/**
 * CRUD de pipelines (PIPELINE.md 10, PERMISSIONS pipeline.view/pipeline.edit).
 *
 * Endpoints sob /api/pipelines, RLS via req.scoped. Schemas Zod dos jsonb
 * (automation_rules/transition_rules/custom_fields) vivem aqui e sao reusados
 * por stages.ts (contrato unico, espelha @hm/db pipeline.ts).
 *
 * F35-S02: limite de 10 pipelines por workspace enforçado no POST; GET expoe meta.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { pipelines, stages, workspaceEntitlementOverrides } = schema;

const DEFAULT_PIPELINE_LIMIT = 10;

export function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export const customFieldDefSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'key deve ser snake_case'),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'currency']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  position: z.number().int().min(0),
});

export const pipelineSettingsSchema = z
  .object({ custom_fields: z.array(customFieldDefSchema).optional() })
  .passthrough();

const automationRuleConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trigger_flow'), flowId: z.string().uuid() }),
  z.object({
    kind: z.literal('send_message'),
    templateName: z.string().min(1),
    languageCode: z.string().min(2),
    channelId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('notify_members'),
    memberIds: z.array(z.string().uuid()),
    title: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    kind: z.literal('create_event'),
    calendarId: z.string().min(1),
    title: z.string().min(1),
    durationMinutes: z.number().int().positive(),
    offsetDays: z.number().int(),
  }),
  z.object({ kind: z.literal('add_tag'), tagId: z.string().uuid() }),
  z.object({ kind: z.literal('remove_tag'), tagId: z.string().uuid() }),
  z.object({
    kind: z.literal('register_conversion'),
    conversionTypeKey: z.string().min(1),
    valueFrom: z.string().min(1),
    valueCents: z.number().int().optional(),
  }),
]);

export const automationRuleSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(['on_enter', 'on_exit', 'on_stale']),
  staleAfterDays: z.number().int().positive().optional(),
  action: z.enum([
    'trigger_flow',
    'send_message',
    'notify_members',
    'create_event',
    'add_tag',
    'remove_tag',
    'register_conversion',
  ]),
  config: automationRuleConfigSchema,
  delaySeconds: z.number().int().min(0),
  enabled: z.boolean(),
});

export const transitionRulesSchema = z.object({
  allowedFromStageIds: z.array(z.string().uuid()).optional(),
  requiredFields: z.array(z.string()).optional(),
  requiredRoles: z.array(z.enum(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT'])).optional(),
  requiresApproval: z.boolean().optional(),
});

const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullish(),
  industry: z.string().trim().max(64).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  settings: pipelineSettingsSchema.optional(),
});

const updatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullish(),
  industry: z.string().trim().max(64).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  settings: pipelineSettingsSchema.optional(),
});

export function createPipelinesRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('pipeline.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('pipeline.edit')] as const;

  // GET /api/pipelines — retorna { data, meta: { limit, current } } (F35-S02)
  router.get('/api/pipelines', ...viewGuard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const [rows, overrideRows] = await req.scoped!((tx) =>
      Promise.all([
        tx.select().from(pipelines).orderBy(asc(pipelines.createdAt)),
        tx
          .select({ limits: workspaceEntitlementOverrides.limits })
          .from(workspaceEntitlementOverrides)
          .where(eq(workspaceEntitlementOverrides.workspaceId, workspaceId))
          .limit(1),
      ]),
    );
    const rawLimit = overrideRows[0]?.limits?.['max_pipelines'];
    const limit =
      typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : DEFAULT_PIPELINE_LIMIT;
    res.json({ data: rows, meta: { limit, current: rows.length } });
  });

  router.get('/api/pipelines/:id', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [pipeline] = await tx.select().from(pipelines).where(eq(pipelines.id, id)).limit(1);
      if (!pipeline) return null;
      const stageRows = await tx
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, id))
        .orderBy(asc(stages.position));
      return { pipeline, stages: stageRows };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  });

  // POST /api/pipelines — enforça limite por workspace (F35-S02)
  router.post('/api/pipelines', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createPipelineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;

    const outcome = await req.scoped!(async (tx) => {
      // 1. Ler limite do workspace (override ou default 10)
      const [overrideRow] = await tx
        .select({ limits: workspaceEntitlementOverrides.limits })
        .from(workspaceEntitlementOverrides)
        .where(eq(workspaceEntitlementOverrides.workspaceId, workspaceId))
        .limit(1);
      const rawLimit = overrideRow?.limits?.['max_pipelines'];
      const limit =
        typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : DEFAULT_PIPELINE_LIMIT;

      // 2. Contar pipelines existentes no workspace
      const [countRow] = await tx
        .select({ count: sql`count(*)` })
        .from(pipelines)
        .where(eq(pipelines.workspaceId, workspaceId));
      const current = Number(countRow?.count ?? 0);

      if (current >= limit) {
        return { ok: false as const, current, limit };
      }

      // 3. Inserir normalmente
      const [created] = await tx
        .insert(pipelines)
        .values({
          workspaceId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          industry: parsed.data.industry ?? null,
          isDefault: parsed.data.isDefault ?? false,
          isActive: parsed.data.isActive ?? true,
          settings: parsed.data.settings ?? {},
        })
        .returning();
      return { ok: true as const, pipeline: created };
    });

    if (!outcome.ok) {
      res.status(422).json({
        error: 'pipeline_limit_reached',
        current: outcome.current,
        max: outcome.limit,
      });
      return;
    }

    res.status(201).json({ pipeline: outcome.pipeline });
  });

  router.put('/api/pipelines/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updatePipelineSchema.safeParse(req.body);
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
      tx.update(pipelines).set(patch).where(eq(pipelines.id, id)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ pipeline: updated });
  });

  router.delete('/api/pipelines/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [deleted] = await req.scoped!((tx) =>
      tx.delete(pipelines).where(eq(pipelines.id, id)).returning({ id: pipelines.id }),
    );
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  return router;
}
