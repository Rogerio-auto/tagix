/**
 * Tipos do catálogo de produtos (F47-S05 / COCKPIT_CLIENT_ENRICHMENT §3/§4).
 *
 * Espelham o contrato da API de S02 (`/api/products`). O backend é a autoridade
 * (RLS + perms `product.*`); estes shapes são só a projeção tipada no cliente.
 */

/** Produto do catálogo do workspace, como devolvido por `GET/POST/PATCH /api/products`. */
export interface Product {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly description: string | null;
  readonly priceCents: number;
  readonly currency: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly deletedAt: string | null;
}

/** Resposta paginada de `GET /api/products`. */
export interface ProductsPage {
  readonly products: readonly Product[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

/** Filtros suportados pela listagem (mapeiam direto na query string). */
export interface ProductListFilters {
  /** Busca livre por nome ou SKU. */
  readonly q?: string;
  /** `true` só ativos, `false` só inativos, ausente = todos. */
  readonly active?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Payload de criação (`POST /api/products`). */
export interface CreateProductInput {
  readonly name: string;
  readonly sku?: string | null;
  readonly description?: string | null;
  readonly priceCents: number;
  readonly active: boolean;
}

/** Payload de edição parcial (`PATCH /api/products/:id`). */
export type UpdateProductInput = Partial<CreateProductInput>;
