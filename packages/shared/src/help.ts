/**
 * Contratos compartilhados da Central de Ajuda (F38 — SUPPORT.md secao 1).
 * Fonte unica de verdade entre @hm/api (CMS S02 + leitor S03) e @hm/web (S04/S05).
 *
 * Schemas Zod validam input externo na API; os tipos derivados tipam a UI. O
 * corpo do artigo (body_md) e Markdown renderizado SANITIZADO no leitor (S05/S15).
 */
import { z } from 'zod';

export const HELP_ARTICLE_STATUSES = ['draft', 'published'] as const;
export type HelpArticleStatus = (typeof HELP_ARTICLE_STATUSES)[number];

const slug = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug deve ser kebab-case (a-z0-9 e hifens).');

const anchorKey = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'anchorKey deve ser dot/kebab (ex.: agents.create).');

// ─── Categorias (CMS) ────────────────────────────────────────────────────────
export const helpCategoryInputSchema = z.object({
  slug,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  icon: z.string().trim().max(80).nullish(),
  order: z.number().int().min(0).max(100000).optional(),
});
export type HelpCategoryInput = z.infer<typeof helpCategoryInputSchema>;

export const helpCategoryPatchSchema = helpCategoryInputSchema.partial();
export type HelpCategoryPatch = z.infer<typeof helpCategoryPatchSchema>;

// ─── Artigos (CMS) ───────────────────────────────────────────────────────────
export const helpArticleInputSchema = z.object({
  categoryId: z.string().uuid(),
  slug,
  title: z.string().trim().min(1).max(300),
  excerpt: z.string().trim().max(500).nullish(),
  bodyMd: z.string().min(1).max(100000),
  order: z.number().int().min(0).max(100000).optional(),
  anchorKey: anchorKey.nullish(),
});
export type HelpArticleInput = z.infer<typeof helpArticleInputSchema>;

export const helpArticlePatchSchema = helpArticleInputSchema.partial();
export type HelpArticlePatch = z.infer<typeof helpArticlePatchSchema>;

export const helpReorderSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), order: z.number().int().min(0).max(100000) }))
    .min(1)
    .max(500),
});
export type HelpReorderInput = z.infer<typeof helpReorderSchema>;

// ─── Feedback (leitor) ───────────────────────────────────────────────────────
export const helpFeedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(2000).nullish(),
});
export type HelpFeedbackInput = z.infer<typeof helpFeedbackSchema>;

// ─── Query do leitor ─────────────────────────────────────────────────────────
export const helpArticlesQuerySchema = z.object({
  category: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type HelpArticlesQuery = z.infer<typeof helpArticlesQuerySchema>;

// ─── DTOs de resposta (tipam a UI; serializados das rows do @hm/db) ──────────
export interface HelpCategoryDTO {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  order: number;
}

export interface HelpCategoryWithCountDTO extends HelpCategoryDTO {
  publishedCount: number;
}

export interface HelpArticleSummaryDTO {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: HelpArticleStatus;
  order: number;
  anchorKey: string | null;
}

export interface HelpArticleDTO extends HelpArticleSummaryDTO {
  bodyMd: string;
  publishedAt: string | null;
  updatedAt: string | null;
}
