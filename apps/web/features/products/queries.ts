'use client';

/**
 * Hooks React Query do catálogo de produtos (F47-S05).
 *
 * Consome a API de S02 (`/api/products`). Mutations invalidam a key raiz
 * `['products']` (qualquer página/filtro) para a lista refletir o estado novo —
 * incluindo o soft-delete, que some da lista ativa.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  CreateProductInput,
  Product,
  ProductListFilters,
  ProductsPage,
  UpdateProductInput,
} from './types';

export const productKeys = {
  all: ['products'] as const,
  list: (filters: ProductListFilters) => ['products', 'list', filters] as const,
};

/** Monta a query string a partir dos filtros (omite o que está ausente). */
function toQueryString(filters: ProductListFilters): string {
  const params = new URLSearchParams();
  if (filters.q && filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.active !== undefined) params.set('active', String(filters.active));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useProducts(filters: ProductListFilters) {
  return useQuery({
    queryKey: productKeys.list(filters),
    queryFn: () => api.get<ProductsPage>(`/api/products${toQueryString(filters)}`),
    // Mantém a página anterior visível enquanto a nova chega (sem flash de skeleton
    // a cada digitação/paginação — UX §2.7).
    placeholderData: keepPreviousData,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation<{ product: Product }, Error, CreateProductInput>({
    mutationFn: (input) => api.post<{ product: Product }>('/api/products', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation<{ product: Product }, Error, { id: string; patch: UpdateProductInput }>({
    mutationFn: ({ id, patch }) => api.patch<{ product: Product }>(`/api/products/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/products/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
