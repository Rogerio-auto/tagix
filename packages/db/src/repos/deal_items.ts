/**
 * Repo dos itens (line-items) de um card (F47-S01 / COCKPIT_CLIENT_ENRICHMENT §3/§4).
 *
 * Workspace-scoped. Todas as queries rodam DENTRO de uma transação RLS-escopada
 * (`tx` de `withWorkspace`) e recebem o `DbTx` por parâmetro. O isolamento por
 * workspace é garantido pela RLS + filtro explícito.
 *
 * `recomputeDealValue` apenas SOMA os itens (Σ qty × unit_price_cents) e RETORNA o
 * número — NÃO grava em `deals.value_cents`. Quem grava (na mesma transação, com
 * `deal_history`) é o slot S03. Isso mantém este repo livre de regra de negócio do
 * card e deixa a autoridade de escrita do valor num único lugar.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbTx } from '../client';
import { dealItems } from '../schema';

export type DealItem = typeof dealItems.$inferSelect;
export type NewDealItem = typeof dealItems.$inferInsert;

export const dealItemsRepo = {
  /** Itens de um card, em ordem de `position`. */
  async listByDeal(tx: DbTx, workspaceId: string, dealId: string): Promise<DealItem[]> {
    return tx
      .select()
      .from(dealItems)
      .where(and(eq(dealItems.workspaceId, workspaceId), eq(dealItems.dealId, dealId)))
      .orderBy(dealItems.position, dealItems.createdAt);
  },

  /** Cria um item. `workspaceId` deve casar com o escopo RLS da transação. */
  async create(tx: DbTx, input: NewDealItem): Promise<DealItem> {
    const [row] = await tx.insert(dealItems).values(input).returning();
    if (!row) throw new Error('Falha ao criar item do card.');
    return row;
  },

  /** Atualiza um item. Retorna o registro atualizado ou `null`. */
  async update(
    tx: DbTx,
    workspaceId: string,
    id: string,
    patch: Partial<Omit<NewDealItem, 'id' | 'workspaceId' | 'dealId' | 'createdAt'>>,
  ): Promise<DealItem | null> {
    const [row] = await tx
      .update(dealItems)
      .set(patch)
      .where(and(eq(dealItems.workspaceId, workspaceId), eq(dealItems.id, id)))
      .returning();
    return row ?? null;
  },

  /** Remove um item (hard-delete: line-items não têm histórico próprio). */
  async remove(tx: DbTx, workspaceId: string, id: string): Promise<boolean> {
    const rows = await tx
      .delete(dealItems)
      .where(and(eq(dealItems.workspaceId, workspaceId), eq(dealItems.id, id)))
      .returning({ id: dealItems.id });
    return rows.length > 0;
  },

  /**
   * Soma o valor dos itens do card: Σ(qty × unit_price_cents). Retorna o total em
   * centavos (0 se não houver itens). NÃO grava em `deals.value_cents` — quem grava
   * é o S03, na mesma transação.
   */
  async recomputeDealValue(tx: DbTx, dealId: string): Promise<number> {
    const [row] = await tx
      .select({
        total: sql<number>`coalesce(sum(${dealItems.qty} * ${dealItems.unitPriceCents}), 0)::bigint`,
      })
      .from(dealItems)
      .where(eq(dealItems.dealId, dealId));
    return Number(row?.total ?? 0);
  },
};
