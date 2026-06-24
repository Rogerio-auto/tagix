/**
 * Itens (line-items) de um card + recompute autoritativo de `deals.value_cents`
 * (F47-S03, COCKPIT_CLIENT_ENRICHMENT §3/§4).
 *
 * Endpoints sob /api/deals/:id/items (montados no router de pipeline). RLS via
 * `req.scoped`:
 *   GET    /api/deals/:id/items            lista os itens do card        (pipeline.view)
 *   POST   /api/deals/:id/items            adiciona item                 (deal.edit)
 *   PATCH  /api/deals/:id/items/:itemId    edita qty/preço/nome          (deal.edit)
 *   DELETE /api/deals/:id/items/:itemId    remove                        (deal.edit)
 *
 * AUTORIDADE DO VALOR: toda mutação (POST/PATCH/DELETE) recalcula, NA MESMA
 * transação, `deals.value_cents = Σ(qty × unit_price_cents)` e grava
 * `deal_history(event_type='field_updated')` com o value_cents antigo/novo. A soma
 * NUNCA vem do cliente — o servidor é a única fonte da verdade (a conversão usa
 * `valueFrom: 'deal'`). A mesma lógica de soma do repo `dealItemsRepo.recomputeDealValue`
 * (S01) é replicada inline aqui porque a escrita do valor pertence a este slot e o
 * repo não é exposto pelo barrel `@hm/db`.
 *
 * SNAPSHOT IMUTÁVEL: `name_snapshot`/`unit_price_cents` são gravados no momento do
 * lançamento e NÃO mudam se o produto de catálogo mudar de preço ou for excluído
 * (comportamento de nota fiscal — fidelidade histórica). Um item pode referenciar um
 * produto inativo/soft-deletado; o snapshot mantém a linha exibível.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { deals, dealItems, dealHistory, products } = schema;

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Soma Σ(qty × unit_price_cents) dos itens do card. Retorna o total em centavos
 * (0 se não houver itens). Idêntico ao helper do repo (S01); o cast `::bigint`
 * evita overflow de `int` na soma e `coalesce(...,0)` cobre o card sem itens.
 */
async function recomputeDealValue(tx: DbTx, dealId: string): Promise<number> {
  const [row] = await tx
    .select({
      total: sql<number>`coalesce(sum(${dealItems.qty} * ${dealItems.unitPriceCents}), 0)::bigint`,
    })
    .from(dealItems)
    .where(eq(dealItems.dealId, dealId));
  return Number(row?.total ?? 0);
}

/**
 * Grava `deals.value_cents` recomputado + trilha em `deal_history` na MESMA
 * transação e retorna o novo valor. Lê o valor antigo dentro da tx para a trilha
 * refletir exatamente o estado pré-mutação.
 */
async function persistRecomputedValue(
  tx: DbTx,
  args: { dealId: string; workspaceId: string; previousValueCents: number; actorMemberId: string },
): Promise<number> {
  const nextValueCents = await recomputeDealValue(tx, args.dealId);
  if (nextValueCents !== args.previousValueCents) {
    await tx
      .update(deals)
      .set({ valueCents: nextValueCents, updatedAt: new Date() })
      .where(eq(deals.id, args.dealId));
    await tx.insert(dealHistory).values({
      dealId: args.dealId,
      workspaceId: args.workspaceId,
      eventType: 'field_updated',
      fromValue: { valueCents: args.previousValueCents },
      toValue: { valueCents: nextValueCents },
      actorMemberId: args.actorMemberId,
      actorType: 'member',
    });
  }
  return nextValueCents;
}

/** Carrega o deal dentro do escopo RLS; `null` se fora do workspace (→ 404). */
async function loadDeal(
  tx: DbTx,
  dealId: string,
): Promise<{ id: string; valueCents: number } | null> {
  const [row] = await tx
    .select({ id: deals.id, valueCents: deals.valueCents })
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  return row ?? null;
}

const createItemSchema = z
  .object({
    productId: z.string().uuid().nullish(),
    nameSnapshot: z.string().trim().min(1).max(200).optional(),
    unitPriceCents: z.number().int().min(0).optional(),
    qty: z.number().int().positive(),
    currency: z.string().trim().length(3).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => v.productId != null || (v.nameSnapshot != null && v.unitPriceCents != null), {
    message: 'Forneça productId ou (nameSnapshot + unitPriceCents).',
  });

const updateItemSchema = z
  .object({
    nameSnapshot: z.string().trim().min(1).max(200).optional(),
    unitPriceCents: z.number().int().min(0).optional(),
    qty: z.number().int().positive().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada para atualizar.' });

export function createDealItemsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('pipeline.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('deal.edit')] as const;

  // GET /api/deals/:id/items — lista os itens do card (RLS + visibilidade do deal).
  router.get('/api/deals/:id/items', ...viewGuard, async (req: Request, res: Response) => {
    const dealId = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const deal = await loadDeal(tx, dealId);
      if (!deal) return null;
      const items = await tx
        .select()
        .from(dealItems)
        .where(eq(dealItems.dealId, dealId))
        .orderBy(asc(dealItems.position), asc(dealItems.createdAt));
      return { items };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ items: result.items });
  });

  // POST /api/deals/:id/items — adiciona item (snapshota produto se productId vier).
  router.post('/api/deals/:id/items', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const dealId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const actorMemberId = req.auth!.member.id;
    const d = parsed.data;

    const result = await req.scoped!(async (tx) => {
      const deal = await loadDeal(tx, dealId);
      if (!deal) return { kind: 'deal_not_found' as const };

      let nameSnapshot = d.nameSnapshot ?? '';
      let unitPriceCents = d.unitPriceCents ?? 0;
      let currency = d.currency ?? 'BRL';
      const productId: string | null = d.productId ?? null;

      // Com productId, snapshota nome/preço/moeda do catálogo NO MOMENTO do
      // lançamento (imutável ao item). Aceita produto inativo (vínculo manual),
      // mas exige que exista no workspace e não esteja soft-deletado.
      if (productId) {
        const [product] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, productId), sql`${products.deletedAt} is null`))
          .limit(1);
        if (!product) return { kind: 'product_not_found' as const };
        nameSnapshot = d.nameSnapshot ?? product.name;
        unitPriceCents = d.unitPriceCents ?? product.priceCents;
        currency = d.currency ?? product.currency;
      }

      const [item] = await tx
        .insert(dealItems)
        .values({
          workspaceId,
          dealId,
          productId,
          nameSnapshot,
          qty: d.qty,
          unitPriceCents,
          currency,
          position: d.position ?? 0,
        })
        .returning();
      if (!item) return { kind: 'insert_failed' as const };

      const dealValueCents = await persistRecomputedValue(tx, {
        dealId,
        workspaceId,
        previousValueCents: deal.valueCents,
        actorMemberId,
      });
      return { kind: 'ok' as const, item, dealValueCents };
    });

    if (result.kind === 'deal_not_found') {
      res.sendStatus(404);
      return;
    }
    if (result.kind === 'product_not_found') {
      res.status(404).json({ error: 'product_not_found' });
      return;
    }
    if (result.kind !== 'ok') {
      res.status(500).json({ error: 'item_create_failed' });
      return;
    }
    res.status(201).json({ item: result.item, dealValueCents: result.dealValueCents });
  });

  // PATCH /api/deals/:id/items/:itemId — edita qty/preço/nome.
  router.patch(
    '/api/deals/:id/items/:itemId',
    ...editGuard,
    async (req: Request, res: Response) => {
      const parsed = updateItemSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const dealId = param(req, 'id');
      const itemId = param(req, 'itemId');
      const workspaceId = req.auth!.workspace.id;
      const actorMemberId = req.auth!.member.id;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed.data)) {
        if (v !== undefined) patch[k] = v;
      }

      const result = await req.scoped!(async (tx) => {
        const deal = await loadDeal(tx, dealId);
        if (!deal) return { kind: 'not_found' as const };

        const [item] = await tx
          .update(dealItems)
          .set(patch)
          .where(and(eq(dealItems.id, itemId), eq(dealItems.dealId, dealId)))
          .returning();
        if (!item) return { kind: 'not_found' as const };

        const dealValueCents = await persistRecomputedValue(tx, {
          dealId,
          workspaceId,
          previousValueCents: deal.valueCents,
          actorMemberId,
        });
        return { kind: 'ok' as const, item, dealValueCents };
      });

      if (result.kind === 'not_found') {
        res.sendStatus(404);
        return;
      }
      res.json({ item: result.item, dealValueCents: result.dealValueCents });
    },
  );

  // DELETE /api/deals/:id/items/:itemId — remove (hard-delete).
  router.delete(
    '/api/deals/:id/items/:itemId',
    ...editGuard,
    async (req: Request, res: Response) => {
      const dealId = param(req, 'id');
      const itemId = param(req, 'itemId');
      const workspaceId = req.auth!.workspace.id;
      const actorMemberId = req.auth!.member.id;

      const result = await req.scoped!(async (tx) => {
        const deal = await loadDeal(tx, dealId);
        if (!deal) return { kind: 'not_found' as const };

        const removed = await tx
          .delete(dealItems)
          .where(and(eq(dealItems.id, itemId), eq(dealItems.dealId, dealId)))
          .returning({ id: dealItems.id });
        if (removed.length === 0) return { kind: 'not_found' as const };

        const dealValueCents = await persistRecomputedValue(tx, {
          dealId,
          workspaceId,
          previousValueCents: deal.valueCents,
          actorMemberId,
        });
        return { kind: 'ok' as const, dealValueCents };
      });

      if (result.kind === 'not_found') {
        res.sendStatus(404);
        return;
      }
      res.json({ ok: true, dealValueCents: result.dealValueCents });
    },
  );

  return router;
}
