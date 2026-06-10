/**
 * CRUD de conversion_types (catalogo por workspace, DATA_MODEL §10.7).
 * Settings de admin -> pipeline.edit (ADMINS). PERMISSIONS.md.
 *
 * Endpoints sob /api/conversion-types, RLS via req.scoped:
 *   GET    /api/conversion-types        lista (pipeline.view)
 *   POST   /api/conversion-types        cria   (pipeline.edit)
 *   PUT    /api/conversion-types/:id    update (pipeline.edit)
 *   DELETE /api/conversion-types/:id    soft (is_active=false) (pipeline.edit)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { conversionTypes } = schema;

export function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const createTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'key deve ser snake_case'),
  label: z.string().trim().min(1).max(120),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(64).nullish(),
  valueRequired: z.boolean().optional(),
  valueLabel: z.string().trim().max(120).nullish(),
  currency: z.string().trim().length(3).optional(),
  isDefault: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const updateTypeSchema = createTypeSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export function createConversionTypesRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('pipeline.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('pipeline.edit')] as const;

  router.get('/api/conversion-types', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx.select().from(conversionTypes).orderBy(asc(conversionTypes.position)),
    );
    res.json({ conversionTypes: rows });
  });

  router.post('/api/conversion-types', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(conversionTypes)
          .values({
            workspaceId,
            key: d.key,
            label: d.label,
            color: d.color ?? '#1FFF13',
            icon: d.icon ?? null,
            valueRequired: d.valueRequired ?? false,
            valueLabel: d.valueLabel ?? null,
            currency: d.currency ?? 'BRL',
            isDefault: d.isDefault ?? false,
            position: d.position ?? 0,
          })
          .returning(),
      );
      res.status(201).json({ conversionType: created });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_key', message: 'Ja existe um tipo com essa key.' });
        return;
      }
      throw err;
    }
  });

  router.put('/api/conversion-types/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateTypeSchema.safeParse(req.body);
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
      tx.update(conversionTypes).set(patch).where(eq(conversionTypes.id, id)).returning(),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.json({ conversionType: updated });
  });

  router.delete('/api/conversion-types/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(conversionTypes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(conversionTypes.id, id))
        .returning({ id: conversionTypes.id }),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  return router;
}
