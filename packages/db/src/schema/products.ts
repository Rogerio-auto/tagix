/**
 * Catálogo de produtos do workspace (F47-S01 / COCKPIT_CLIENT_ENRICHMENT §3).
 *
 * Workspace-scoped + soft-delete. NÃO é assinatura da plataforma (isso é `plans`/
 * `subscriptions` em base.ts) — aqui é o catálogo comercial do tenant: nome, SKU,
 * preço unitário. Itens do card (`deal_items`) referenciam estes produtos por
 * `product_id` (SET NULL = produto removido vira item ad-hoc histórico).
 *
 * Índices parciais (where deleted_at is null) garantem que linhas soft-deletadas não
 * disputem o unique de SKU nem pesem no índice de listagem.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku'),
    description: text('description'),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('BRL'),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('idx_products_workspace').on(t.workspaceId).where(sql`${t.deletedAt} is null`),
    uniqueIndex('uq_products_workspace_sku')
      .on(t.workspaceId, t.sku)
      .where(sql`${t.sku} is not null and ${t.deletedAt} is null`),
  ],
);
