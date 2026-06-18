'use client';

/**
 * React Query do leitor da Central de Ajuda (F38-S05) sobre a API S03
 * (/api/help/*). Tipos vem de @hm/shared. So conteudo publicado e servido.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HelpArticleDTO,
  HelpArticleSummaryDTO,
  HelpCategoryWithCountDTO,
  HelpFeedbackInput,
} from '@hm/shared';
import { api } from '@/shared/lib/api-client';

export function useHelpCategories() {
  return useQuery({
    queryKey: ['help', 'categories'],
    queryFn: () => api.get<{ categories: HelpCategoryWithCountDTO[] }>('/api/help/categories'),
  });
}

export function useHelpArticles(params: { category?: string; q?: string }) {
  const search = new URLSearchParams();
  if (params.category) search.set('category', params.category);
  if (params.q) search.set('q', params.q);
  const qs = search.toString();
  return useQuery({
    queryKey: ['help', 'articles', params.category ?? '', params.q ?? ''],
    queryFn: () =>
      api.get<{ articles: HelpArticleSummaryDTO[] }>(`/api/help/articles${qs ? `?${qs}` : ''}`),
  });
}

export function useHelpArticle(slug: string) {
  return useQuery({
    queryKey: ['help', 'article', slug],
    queryFn: () => api.get<{ article: HelpArticleDTO }>(`/api/help/articles/${slug}`),
    enabled: slug !== '',
  });
}

export function useSubmitFeedback(articleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HelpFeedbackInput) =>
      api.post<{ feedback: unknown }>(`/api/help/articles/${articleId}/feedback`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['help', 'article'] }),
  });
}
