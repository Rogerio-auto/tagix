/**
 * Repo da Central de Ajuda (F38-S01 / SUPPORT.md secao 1).
 * Catalogo (help_categories/help_articles) e PLATFORM-LEVEL (getDb, sem escopo).
 * Autorizacao na rota: requirePlatformAdmin para escrita; published para leitura.
 * help_article_feedback e WORKSPACE-SCOPED -> DbTx de withWorkspace (RLS).
 */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import { helpArticleFeedback, helpArticles, helpCategories } from '../schema';

export type HelpCategory = typeof helpCategories.$inferSelect;
export type HelpArticle = typeof helpArticles.$inferSelect;
export type HelpArticleFeedback = typeof helpArticleFeedback.$inferSelect;

type NewCategory = Omit<typeof helpCategories.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
type NewArticle = Omit<
  typeof helpArticles.$inferInsert,
  'id' | 'searchTsv' | 'createdAt' | 'updatedAt' | 'publishedAt'
>;

export type HelpArticleSummary = Pick<
  HelpArticle,
  'id' | 'categoryId' | 'slug' | 'title' | 'excerpt' | 'status' | 'order' | 'anchorKey' | 'updatedAt'
>;

const SUMMARY_COLS = {
  id: helpArticles.id,
  categoryId: helpArticles.categoryId,
  slug: helpArticles.slug,
  title: helpArticles.title,
  excerpt: helpArticles.excerpt,
  status: helpArticles.status,
  order: helpArticles.order,
  anchorKey: helpArticles.anchorKey,
  updatedAt: helpArticles.updatedAt,
} as const;

export const helpRepo = {
  async listCategories(): Promise<HelpCategory[]> {
    return getDb()
      .select()
      .from(helpCategories)
      .orderBy(asc(helpCategories.order), asc(helpCategories.title));
  },

  async listCategoriesWithPublishedCount(): Promise<
    Array<HelpCategory & { publishedCount: number }>
  > {
    const rows = await getDb()
      .select({
        category: helpCategories,
        publishedCount: count(
          sql`case when ${helpArticles.status} = 'published' then ${helpArticles.id} end`,
        ),
      })
      .from(helpCategories)
      .leftJoin(helpArticles, eq(helpArticles.categoryId, helpCategories.id))
      .groupBy(helpCategories.id)
      .orderBy(asc(helpCategories.order), asc(helpCategories.title));
    return rows.map((r) => ({ ...r.category, publishedCount: Number(r.publishedCount) }));
  },

  async findCategoryById(id: string): Promise<HelpCategory | null> {
    const [row] = await getDb().select().from(helpCategories).where(eq(helpCategories.id, id));
    return row ?? null;
  },

  async createCategory(input: NewCategory): Promise<HelpCategory> {
    const [row] = await getDb().insert(helpCategories).values(input).returning();
    if (!row) throw new Error('Falha ao criar help_category.');
    return row;
  },

  async updateCategory(id: string, patch: Partial<NewCategory>): Promise<HelpCategory | null> {
    const [row] = await getDb()
      .update(helpCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(helpCategories.id, id))
      .returning();
    return row ?? null;
  },

  async deleteCategory(id: string): Promise<void> {
    await getDb().delete(helpCategories).where(eq(helpCategories.id, id));
  },

  async listArticlesAdmin(categoryId?: string): Promise<HelpArticleSummary[]> {
    const where = categoryId ? eq(helpArticles.categoryId, categoryId) : undefined;
    return getDb()
      .select(SUMMARY_COLS)
      .from(helpArticles)
      .where(where)
      .orderBy(asc(helpArticles.categoryId), asc(helpArticles.order), asc(helpArticles.title));
  },

  async findArticleById(id: string): Promise<HelpArticle | null> {
    const [row] = await getDb().select().from(helpArticles).where(eq(helpArticles.id, id));
    return row ?? null;
  },

  async createArticle(input: NewArticle): Promise<HelpArticle> {
    const [row] = await getDb().insert(helpArticles).values(input).returning();
    if (!row) throw new Error('Falha ao criar help_article.');
    return row;
  },

  async updateArticle(id: string, patch: Partial<NewArticle>): Promise<HelpArticle | null> {
    const [row] = await getDb()
      .update(helpArticles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(helpArticles.id, id))
      .returning();
    return row ?? null;
  },

  async publishArticle(id: string): Promise<HelpArticle | null> {
    const [row] = await getDb()
      .update(helpArticles)
      .set({
        status: 'published',
        publishedAt: sql`coalesce(${helpArticles.publishedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(helpArticles.id, id))
      .returning();
    return row ?? null;
  },

  async unpublishArticle(id: string): Promise<HelpArticle | null> {
    const [row] = await getDb()
      .update(helpArticles)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(helpArticles.id, id))
      .returning();
    return row ?? null;
  },

  async deleteArticle(id: string): Promise<void> {
    await getDb().delete(helpArticles).where(eq(helpArticles.id, id));
  },

  async reorderArticles(items: ReadonlyArray<{ id: string; order: number }>): Promise<void> {
    if (items.length === 0) return;
    await getDb().transaction(async (tx) => {
      for (const it of items) {
        await tx
          .update(helpArticles)
          .set({ order: it.order, updatedAt: new Date() })
          .where(eq(helpArticles.id, it.id));
      }
    });
  },

  async listPublished(categoryId?: string): Promise<HelpArticleSummary[]> {
    const where = categoryId
      ? and(eq(helpArticles.status, 'published'), eq(helpArticles.categoryId, categoryId))
      : eq(helpArticles.status, 'published');
    return getDb()
      .select(SUMMARY_COLS)
      .from(helpArticles)
      .where(where)
      .orderBy(asc(helpArticles.order), asc(helpArticles.title));
  },

  async searchPublished(query: string, categoryId?: string): Promise<HelpArticleSummary[]> {
    const tsq = sql`plainto_tsquery('portuguese', ${query})`;
    const conds = [eq(helpArticles.status, 'published'), sql`${helpArticles.searchTsv} @@ ${tsq}`];
    if (categoryId) conds.push(eq(helpArticles.categoryId, categoryId));
    return getDb()
      .select(SUMMARY_COLS)
      .from(helpArticles)
      .where(and(...conds))
      .orderBy(desc(sql`ts_rank(${helpArticles.searchTsv}, ${tsq})`))
      .limit(50);
  },

  async findPublishedBySlug(slug: string): Promise<HelpArticle | null> {
    const [row] = await getDb()
      .select()
      .from(helpArticles)
      .where(and(eq(helpArticles.slug, slug), eq(helpArticles.status, 'published')));
    return row ?? null;
  },

  async findPublishedByAnchor(anchorKey: string): Promise<HelpArticle | null> {
    const [row] = await getDb()
      .select()
      .from(helpArticles)
      .where(and(eq(helpArticles.anchorKey, anchorKey), eq(helpArticles.status, 'published')));
    return row ?? null;
  },

  async upsertFeedback(
    tx: DbTx,
    input: {
      articleId: string;
      workspaceId: string;
      memberId: string;
      helpful: boolean;
      comment?: string | null;
    },
  ): Promise<HelpArticleFeedback> {
    const [row] = await tx
      .insert(helpArticleFeedback)
      .values({
        articleId: input.articleId,
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        helpful: input.helpful,
        comment: input.comment ?? null,
      })
      .onConflictDoUpdate({
        target: [helpArticleFeedback.articleId, helpArticleFeedback.memberId],
        set: { helpful: input.helpful, comment: input.comment ?? null, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error('Falha ao registrar feedback.');
    return row;
  },
};
