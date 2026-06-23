/**
 * Repo do catálogo de produtos (F47-S01 / COCKPIT_CLIENT_ENRICHMENT §3/§4).
 *
 * Workspace-scoped + soft-delete. Todas as queries rodam DENTRO de uma transação
 * RLS-escopada (`tx` de `withWorkspace`) e recebem o `DbTx` por parâmetro — nunca
 * abrem o próprio escopo. O isolamento por workspace é garantido pela RLS + pelo
 * filtro explícito de `workspace_id` (cinto-e-suspensório).
 *
 * Consumido por S02 (CRUD da API `/api/products`) e pelo cockpit (S07, vincular
 * produto a um item do card).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DbTx } from '../client';
import { products } from '../schema';

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export const productsRepo = {
  /** Lista os produtos vivos (não soft-deletados) do workspace. */
  async list(tx: DbTx, workspaceId: string, opts?: { activeOnly?: boolean }): Promise<Product[]> {
    const predicates = [eq(products.workspaceId, workspaceId), isNull(products.deletedAt)];
    if (opts?.activeOnly) predicates.push(eq(products.active, true));
    return tx
      .select()
      .from(products)
      .where(and(...predicates))
      .orderBy(products.name);
  },

  /** Busca um produto vivo por id dentro do workspace, ou `null`. */
  async findById(tx: DbTx, workspaceId: string, id: string): Promise<Product | null> {
    const [row] = await tx
      .select()
      .from(products)
      .where(
        and(eq(products.workspaceId, workspaceId), eq(products.id, id), isNull(products.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  },

  /** Cria um produto. `workspaceId` deve casar com o escopo RLS da transação. */
  async create(tx: DbTx, input: NewProduct): Promise<Product> {
    const [row] = await tx.insert(products).values(input).returning();
    if (!row) throw new Error('Falha ao criar produto.');
    return row;
  },

  /** Atualiza campos de um produto vivo. Retorna o registro atualizado ou `null`. */
  async update(
    tx: DbTx,
    workspaceId: string,
    id: string,
    patch: Partial<Omit<NewProduct, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Product | null> {
    const [row] = await tx
      .update(products)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(products.workspaceId, workspaceId), eq(products.id, id), isNull(products.deletedAt)),
      )
      .returning();
    return row ?? null;
  },

  /** Soft-delete: marca `deleted_at`. Retorna `true` se algo foi afetado. */
  async softDelete(tx: DbTx, workspaceId: string, id: string): Promise<boolean> {
    const rows = await tx
      .update(products)
      .set({ deletedAt: new Date(), active: false })
      .where(
        and(eq(products.workspaceId, workspaceId), eq(products.id, id), isNull(products.deletedAt)),
      )
      .returning({ id: products.id });
    return rows.length > 0;
  },
};
