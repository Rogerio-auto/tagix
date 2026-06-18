/**
 * API de plataforma — CMS da Central de Ajuda (F38-S02 / SUPPORT.md secao 1.2).
 *
 *   GET    /api/platform/help/categories            lista categorias
 *   POST   /api/platform/help/categories            cria categoria
 *   PATCH  /api/platform/help/categories/:id         atualiza categoria
 *   DELETE /api/platform/help/categories/:id         remove categoria (cascade artigos)
 *   GET    /api/platform/help/articles?category=      lista artigos (todos os status)
 *   GET    /api/platform/help/articles/:id            detalhe (qualquer status)
 *   POST   /api/platform/help/articles                cria artigo (draft)
 *   PATCH  /api/platform/help/articles/:id            atualiza artigo
 *   POST   /api/platform/help/articles/:id/publish    publica
 *   POST   /api/platform/help/articles/:id/unpublish  volta a draft
 *   POST   /api/platform/help/articles/reorder        reordena
 *   DELETE /api/platform/help/articles/:id            remove
 *
 * Conteudo e PLATFORM-LEVEL (sem workspace_id). TODAS as rotas sao gated por
 * requirePlatformAdmin — tentativa de nao-admin e negada (403) e auditada pelo
 * proprio middleware. Mutacoes registram audit_logs. Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { getDb, helpRepo, schema } from '@hm/db';
import {
  helpArticleInputSchema,
  helpArticlePatchSchema,
  helpCategoryInputSchema,
  helpCategoryPatchSchema,
  helpReorderSchema,
} from '@hm/shared';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';

const { auditLogs } = schema;

function paramId(req: Request): string {
  const raw = req.params['id'];
  return typeof raw === 'string' ? raw : '';
}

async function audit(
  req: Request,
  action: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await getDb().insert(auditLogs).values({
    workspaceId: req.auth!.member.workspaceId,
    actorMemberId: req.auth!.member.id,
    actorType: 'platform_admin',
    action,
    resourceType: 'help',
    resourceId,
    metadata,
  });
}

export function createPlatformHelpRouter(): Router {
  const router = Router();

  // ── Categorias ──────────────────────────────────────────────────────────────
  router.get('/api/platform/help/categories', ...requirePlatformAdmin, async (_req, res: Response) => {
    res.json({ categories: await helpRepo.listCategories() });
  });

  router.post('/api/platform/help/categories', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = helpCategoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const category = await helpRepo.createCategory({
      slug: parsed.data.slug,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      order: parsed.data.order ?? 0,
    });
    await audit(req, 'help.category_created', category.id, { slug: category.slug });
    res.status(201).json({ category });
  });

  router.patch('/api/platform/help/categories/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const id = paramId(req);
    const parsed = helpCategoryPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const patch: Record<string, unknown> = {};
    const d = parsed.data;
    if (d.slug !== undefined) patch['slug'] = d.slug;
    if (d.title !== undefined) patch['title'] = d.title;
    if (d.description !== undefined) patch['description'] = d.description ?? null;
    if (d.icon !== undefined) patch['icon'] = d.icon ?? null;
    if (d.order !== undefined) patch['order'] = d.order;
    const category = await helpRepo.updateCategory(id, patch);
    if (!category) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await audit(req, 'help.category_updated', id, {});
    res.json({ category });
  });

  router.delete('/api/platform/help/categories/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!(await helpRepo.findCategoryById(id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await helpRepo.deleteCategory(id);
    await audit(req, 'help.category_deleted', id, {});
    res.status(204).end();
  });

  // ── Artigos ─────────────────────────────────────────────────────────────────
  router.get('/api/platform/help/articles', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
    res.json({ articles: await helpRepo.listArticlesAdmin(category) });
  });

  // reorder ANTES de :id para nao colidir com o param.
  router.post('/api/platform/help/articles/reorder', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = helpReorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    await helpRepo.reorderArticles(parsed.data.items);
    await audit(req, 'help.articles_reordered', null, { count: parsed.data.items.length });
    res.json({ ok: true });
  });

  router.get('/api/platform/help/articles/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const article = await helpRepo.findArticleById(paramId(req));
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ article });
  });

  router.post('/api/platform/help/articles', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = helpArticleInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    if (!(await helpRepo.findCategoryById(parsed.data.categoryId))) {
      res.status(400).json({ error: 'invalid_category' });
      return;
    }
    const article = await helpRepo.createArticle({
      categoryId: parsed.data.categoryId,
      slug: parsed.data.slug,
      title: parsed.data.title,
      excerpt: parsed.data.excerpt ?? null,
      bodyMd: parsed.data.bodyMd,
      status: 'draft',
      order: parsed.data.order ?? 0,
      anchorKey: parsed.data.anchorKey ?? null,
      createdBy: req.auth!.member.id,
      updatedBy: req.auth!.member.id,
    });
    await audit(req, 'help.article_created', article.id, { slug: article.slug });
    res.status(201).json({ article });
  });

  router.patch('/api/platform/help/articles/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const id = paramId(req);
    const parsed = helpArticlePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const patch: Record<string, unknown> = { updatedBy: req.auth!.member.id };
    const d = parsed.data;
    if (d.categoryId !== undefined) patch['categoryId'] = d.categoryId;
    if (d.slug !== undefined) patch['slug'] = d.slug;
    if (d.title !== undefined) patch['title'] = d.title;
    if (d.excerpt !== undefined) patch['excerpt'] = d.excerpt ?? null;
    if (d.bodyMd !== undefined) patch['bodyMd'] = d.bodyMd;
    if (d.order !== undefined) patch['order'] = d.order;
    if (d.anchorKey !== undefined) patch['anchorKey'] = d.anchorKey ?? null;
    const article = await helpRepo.updateArticle(id, patch);
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await audit(req, 'help.article_updated', id, {});
    res.json({ article });
  });

  router.post('/api/platform/help/articles/:id/publish', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const article = await helpRepo.publishArticle(paramId(req));
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await audit(req, 'help.article_published', article.id, {});
    res.json({ article });
  });

  router.post('/api/platform/help/articles/:id/unpublish', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const article = await helpRepo.unpublishArticle(paramId(req));
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await audit(req, 'help.article_unpublished', article.id, {});
    res.json({ article });
  });

  router.delete('/api/platform/help/articles/:id', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!(await helpRepo.findArticleById(id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await helpRepo.deleteArticle(id);
    await audit(req, 'help.article_deleted', id, {});
    res.status(204).end();
  });

  return router;
}
