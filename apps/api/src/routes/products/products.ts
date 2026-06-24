/**
 * CRUD do catálogo de produtos do workspace (F47-S02 / COCKPIT_CLIENT_ENRICHMENT §3/§4).
 *
 * Catálogo comercial do tenant (nome, SKU, preço unitário) — NÃO é assinatura da
 * plataforma. Consumido pelo cockpit (S07, vincular produto ao card) e pelo Settings
 * (S05, gestão do catálogo). Tudo sob RLS (`req.scoped`) + filtro explícito de
 * `workspace_id` (cinto-e-suspensório), espelhando contacts.ts:
 *
 *   GET    /api/products       lista paginada + busca (nome/sku) + filtro active (product.view)
 *   POST   /api/products       cria (product.edit) — 409 duplicate_sku no unique por workspace
 *   PATCH  /api/products/:id    edita parcial (product.edit)
 *   DELETE /api/products/:id    soft-delete (deleted_at) (product.edit)
 *
 * SKU é unique por workspace só entre linhas vivas (índice parcial em S01), então uma
 * colisão de SKU dispara 23505 → 409 `duplicate_sku`.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { products } = schema;

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(120).nullish(),
  description: z.string().trim().max(5000).nullish(),
  priceCents: z.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('BRL'),
  active: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

/** Normaliza um termo de busca livre p/ ILIKE (escapa wildcards do LIKE). */
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}

/**
 * True se `err` é a violação de unique do Postgres (SKU duplicado por workspace).
 * O Drizzle embrulha o erro do driver num `DrizzleQueryError`, expondo o original
 * em `cause` — checamos os dois níveis (mesmo padrão de `platform/plans.ts` e
 * `pipeline/deal-conversation.ts`). Sem o `cause`, SKU duplicado vazava como 500.
 */
function isUniqueViolation(err: unknown): boolean {
  const direct = (err as { code?: string } | null)?.code;
  const cause = (err as { cause?: { code?: string } } | null)?.cause?.code;
  return direct === '23505' || cause === '23505';
}

export function createProductsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('product.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('product.edit')] as const;

  // ─── GET /api/products — lista paginada + busca + filtro active ─────────────
  router.get('/api/products', ...viewGuard, async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { q, active, page, pageSize } = parsed.data;

    const conds = [isNull(products.deletedAt)];
    if (q) {
      const pat = likePattern(q);
      conds.push(or(ilike(products.name, pat), ilike(products.sku, pat))!);
    }
    if (active) conds.push(eq(products.active, active === 'true'));
    const where = and(...conds);

    const { rows, total } = await req.scoped!(async (tx) => {
      const rows = await tx
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(products.name))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(where);
      return { rows, total: countRows[0]?.count ?? 0 };
    });

    res.json({
      products: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  // ─── POST /api/products — cria ─────────────────────────────────────────────
  router.post('/api/products', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(products)
          .values({
            workspaceId,
            name: d.name,
            sku: d.sku ?? null,
            description: d.description ?? null,
            priceCents: d.priceCents,
            currency: d.currency,
            active: d.active,
          })
          .returning(),
      );
      res.status(201).json({ product: created });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'duplicate_sku', message: 'Já existe um produto com esse SKU.' });
        return;
      }
      throw err;
    }
  });

  // ─── PATCH /api/products/:id — edita parcial ───────────────────────────────
  router.patch('/api/products/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = v;
    }
    try {
      const [updated] = await req.scoped!((tx) =>
        tx
          .update(products)
          .set(patch)
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .returning(),
      );
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ product: updated });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'duplicate_sku', message: 'Já existe um produto com esse SKU.' });
        return;
      }
      throw err;
    }
  });

  // ─── DELETE /api/products/:id — soft-delete ────────────────────────────────
  router.delete('/api/products/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [deleted] = await req.scoped!((tx) =>
      tx
        .update(products)
        .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
        .where(and(eq(products.id, id), isNull(products.deletedAt)))
        .returning({ id: products.id }),
    );
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  return router;
}
