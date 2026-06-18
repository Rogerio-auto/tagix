'use client';

/**
 * React Query + tipos do CMS da Central de Ajuda (F38-S04) sobre a API S02
 * (/api/platform/help/*). Tipos de input/DTO vem de @hm/shared (fonte unica).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HelpArticleDTO,
  HelpArticleInput,
  HelpArticlePatch,
  HelpArticleSummaryDTO,
  HelpCategoryDTO,
  HelpCategoryInput,
  HelpCategoryPatch,
} from '@hm/shared';
import { api } from '@/shared/lib/api-client';

const CATS = ['platform', 'help', 'categories'] as const;
const ARTS = ['platform', 'help', 'articles'] as const;

// ── Categorias ───────────────────────────────────────────────────────────────
export function useHelpCategories() {
  return useQuery({
    queryKey: CATS,
    queryFn: () => api.get<{ categories: HelpCategoryDTO[] }>('/api/platform/help/categories'),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HelpCategoryInput) =>
      api.post<{ category: HelpCategoryDTO }>('/api/platform/help/categories', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATS }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: HelpCategoryPatch }) =>
      api.patch<{ category: HelpCategoryDTO }>(`/api/platform/help/categories/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATS }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/platform/help/categories/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CATS });
      void qc.invalidateQueries({ queryKey: ARTS });
    },
  });
}

// ── Artigos ──────────────────────────────────────────────────────────────────
export function useHelpArticles(categoryId?: string) {
  return useQuery({
    queryKey: [...ARTS, categoryId ?? 'all'] as const,
    queryFn: () =>
      api.get<{ articles: HelpArticleSummaryDTO[] }>(
        `/api/platform/help/articles${categoryId ? `?category=${categoryId}` : ''}`,
      ),
  });
}

export function useHelpArticle(id: string | null) {
  return useQuery({
    queryKey: [...ARTS, 'detail', id] as const,
    queryFn: () => api.get<{ article: HelpArticleDTO }>(`/api/platform/help/articles/${id ?? ''}`),
    enabled: id !== null,
  });
}

function invalidateArticles(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ARTS });
  void qc.invalidateQueries({ queryKey: CATS });
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HelpArticleInput) =>
      api.post<{ article: HelpArticleDTO }>('/api/platform/help/articles', input),
    onSuccess: () => invalidateArticles(qc),
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: HelpArticlePatch }) =>
      api.patch<{ article: HelpArticleDTO }>(`/api/platform/help/articles/${id}`, patch),
    onSuccess: () => invalidateArticles(qc),
  });
}

export function usePublishArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      api.post<{ article: HelpArticleDTO }>(
        `/api/platform/help/articles/${id}/${publish ? 'publish' : 'unpublish'}`,
      ),
    onSuccess: () => invalidateArticles(qc),
  });
}

export function useDeleteArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/platform/help/articles/${id}`),
    onSuccess: () => invalidateArticles(qc),
  });
}

export function useReorderArticles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: string; order: number }[]) =>
      api.post<{ ok: true }>('/api/platform/help/articles/reorder', { items }),
    onSuccess: () => invalidateArticles(qc),
  });
}
