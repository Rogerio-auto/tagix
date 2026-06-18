/**
 * Contrato do help contextual ancorado (F38-S06). O conteudo vem da API S03
 * (GET /api/help/articles/by-anchor/:anchorKey) — so artigos publicados.
 */
export interface AnchoredHelpArticle {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMd: string;
}

/**
 * Resolve um anchorKey -> artigo publicado, ou null se nao houver (fallback
 * silencioso). Injetavel para testes; o default usa fetch same-origin.
 */
export type AnchoredHelpFetcher = (anchorKey: string) => Promise<AnchoredHelpArticle | null>;
