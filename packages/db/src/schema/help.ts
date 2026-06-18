/**
 * Central de Ajuda (F38 — SUPPORT.md §1). Conteúdo escrito pela equipe Leadium
 * (platform-level) e lido por todos os workspaces.
 *
 * - `help_categories` / `help_articles` — GLOBAIS, sem `workspace_id` (mesma
 *   postura de `platform_secrets`): FORA do RLS de tenant. A escrita é gated por
 *   `requirePlatformAdmin` na API; a leitura é liberada a qualquer membro
 *   autenticado, mas só de artigos `status='published'` (filtro na rota/leitor).
 * - `help_article_feedback` — WORKSPACE-SCOPED (sinal por workspace): RLS de
 *   tenant direto. UNIQUE `(article_id, member_id)` → o último voto sobrescreve.
 *
 * Busca: FTS GIN em `tsvector('portuguese', title || excerpt || body_md)`. A
 * coluna `search_tsv` GENERATED + índice GIN ficam na migration custom (Drizzle
 * não modela GENERATED tsvector) — aqui declaramos só a coluna como tipo custom
 * para o tipo TS bater, ela nunca é escrita pelo app.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** `tsvector` gerado no banco (GENERATED) — read-only para o app. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ─── Central de Ajuda: catálogo global (sem RLS de tenant) ────────────────────
export const helpCategories = pgTable(
  'help_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    /** Chave de ícone lucide (ex.: 'rocket', 'book-open'). */
    icon: text('icon'),
    order: integer('order').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [index('idx_help_categories_order').on(t.order)],
);

export const helpArticles = pgTable(
  'help_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => helpCategories.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    /** Corpo em Markdown (renderizado SANITIZADO no leitor — sem HTML cru). */
    bodyMd: text('body_md').notNull(),
    status: text('status').notNull().default('draft'),
    order: integer('order').notNull().default(0),
    /** Chave estável p/ deep-link do help contextual `(?)` (ex.: 'agents.create'). */
    anchorKey: text('anchor_key'),
    /** Coluna FTS GENERATED (read-only no app; preenchida pela migration custom). */
    searchTsv: tsvector('search_tsv'),
    publishedAt: ts('published_at'),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_help_articles_status_category_order').on(t.status, t.categoryId, t.order),
    // Âncora única apenas entre artigos que a definem (deep-link determinístico).
    unique('help_articles_anchor_key_uq').on(t.anchorKey),
    check('help_articles_status_chk', sql`${t.status} in ('draft','published')`),
  ],
);

// ─── Feedback por artigo: WORKSPACE-SCOPED (RLS de tenant direto) ─────────────
export const helpArticleFeedback = pgTable(
  'help_article_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => helpArticles.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    helpful: boolean('helpful').notNull(),
    comment: text('comment'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    // Último voto por (artigo, membro) sobrescreve — upsert no repo.
    unique('help_article_feedback_article_member_uq').on(t.articleId, t.memberId),
    index('idx_help_article_feedback_article').on(t.articleId),
    index('idx_help_article_feedback_workspace').on(t.workspaceId),
  ],
);
