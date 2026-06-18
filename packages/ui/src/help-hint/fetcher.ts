import type { AnchoredHelpArticle, AnchoredHelpFetcher } from './types';

/**
 * Fetcher default do help ancorado: consulta a API de leitura (S03) na mesma
 * origem (o web proxia /api -> @hm/api, cookie first-party). 404 -> null
 * (fallback silencioso); qualquer outra falha tambem vira null para nunca
 * quebrar a tela que hospeda o `?`.
 */
export const defaultAnchoredHelpFetcher: AnchoredHelpFetcher = async (anchorKey) => {
  try {
    const res = await fetch(`/api/help/articles/by-anchor/${encodeURIComponent(anchorKey)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { article?: AnchoredHelpArticle };
    return data.article ?? null;
  } catch {
    return null;
  }
};
