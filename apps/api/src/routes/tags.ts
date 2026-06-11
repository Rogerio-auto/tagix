/**
 * Tags do workspace (F8-S08, DATA_MODEL §5.2). CRUD sobre `tags`, RLS por scoped.
 *
 *   GET    /api/tags        lista (contact.view — qualquer member usa tags)
 *   POST   /api/tags        cria (team.edit — MANAGERS curam o catálogo)
 *   PATCH  /api/tags/:id     edita nome/cor (team.edit)
 *   DELETE /api/tags/:id     remove (team.edit) — cascade em contact_tags
 *
 * Cada tag traz `usageCount` (contatos marcados) p/ a UI mostrar uso antes de excluir.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../middlewares/auth';
import { param } from './conversions/types';

const { tags, contactTags } = schema;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'cor deve ser hex #RRGGBB')
    .optional(),
});
const updateSchema = createSchema.partial();

export function createTagsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('contact.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('team.edit')] as const;

  router.get('/api/tags', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
          createdAt: tags.createdAt,
          usageCount: sql<number>`(select count(*)::int from ${contactTags} ct where ct.tag_id = ${tags.id})`,
        })
        .from(tags)
        .orderBy(asc(tags.name)),
    );
    res.json({ tags: rows });
  });

  router.post('/api/tags', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(tags)
          .values({ workspaceId, name: parsed.data.name, color: parsed.data.color ?? '#1FFF13' })
          .returning(),
      );
      res.status(201).json({ tag: created });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_name', message: 'Já existe uma tag com esse nome.' });
        return;
      }
      throw err;
    }
  });

  router.patch('/api/tags/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch['name'] = parsed.data.name;
    if (parsed.data.color !== undefined) patch['color'] = parsed.data.color;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'empty_patch' });
      return;
    }
    try {
      const [updated] = await req.scoped!((tx) =>
        tx.update(tags).set(patch).where(eq(tags.id, id)).returning(),
      );
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ tag: updated });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_name', message: 'Já existe uma tag com esse nome.' });
        return;
      }
      throw err;
    }
  });

  router.delete('/api/tags/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [deleted] = await req.scoped!((tx) =>
      tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id }),
    );
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  return router;
}
