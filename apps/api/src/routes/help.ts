/**
 * API leitor da Central de Ajuda (F38-S03 / SUPPORT.md secao 1.2).
 *
 *   GET  /api/help/categories                  categorias + contagem de publicados
 *   GET  /api/help/articles?category=&q=        artigos publicados (FTS pt em q)
 *   GET  /api/help/articles/:slug               artigo publicado por slug
 *   GET  /api/help/articles/by-anchor/:anchorKey artigo publicado por ancora (help (?))
 *   POST /api/help/articles/:id/feedback         upsert do voto (workspace-scoped)
 *
 * Conteudo (categorias/artigos) e PLATFORM-LEVEL -> leitura via getDb no helpRepo,
 * SEM escopo de tenant, mas SO status='published' (o repo filtra). Liberado a
 * qualquer membro autenticado (requireAuth) — sem perm especifica.
 *
 * Feedback e WORKSPACE-SCOPED -> requer withRLS (req.scoped) para isolar o tenant.
 * Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { helpRepo } from '@hm/db';
import { helpArticlesQuerySchema, helpFeedbackSchema } from '@hm/shared';
import { requireAuth, withRLS } from '../middlewares/auth';

function param(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

export function createHelpRouter(): Router {
  const router = Router();

  // Categorias com contagem de publicados (qualquer membro autenticado).
  router.get('/api/help/categories', requireAuth, async (_req, res: Response) => {
    const categories = await helpRepo.listCategoriesWithPublishedCount();
    res.json({ categories });
  });

  // Artigos publicados; com `q` faz busca FTS (pt), senao lista por categoria.
  router.get('/api/help/articles', requireAuth, async (req: Request, res: Response) => {
    const parsed = helpArticlesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { category, q } = parsed.data;
    const articles = q
      ? await helpRepo.searchPublished(q, category)
      : await helpRepo.listPublished(category);
    res.json({ articles });
  });

  // Por ancora (deep-link do help contextual). ANTES de :slug.
  router.get('/api/help/articles/by-anchor/:anchorKey', requireAuth, async (req: Request, res: Response) => {
    const article = await helpRepo.findPublishedByAnchor(param(req, 'anchorKey'));
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ article });
  });

  // Por slug.
  router.get('/api/help/articles/:slug', requireAuth, async (req: Request, res: Response) => {
    const article = await helpRepo.findPublishedBySlug(param(req, 'slug'));
    if (!article) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ article });
  });

  // Feedback: upsert por (article, member). Workspace-scoped -> withRLS.
  router.post('/api/help/articles/:id/feedback', requireAuth, withRLS, async (req: Request, res: Response) => {
    const parsed = helpFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const articleId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;

    // O artigo precisa existir e estar publicado (nao registra feedback de rascunho).
    const article = await helpRepo.findArticleById(articleId);
    if (!article || article.status !== 'published') {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const feedback = await req.scoped!((tx) =>
      helpRepo.upsertFeedback(tx, {
        articleId,
        workspaceId,
        memberId,
        helpful: parsed.data.helpful,
        comment: parsed.data.comment ?? null,
      }),
    );
    res.status(200).json({ feedback });
  });

  return router;
}
