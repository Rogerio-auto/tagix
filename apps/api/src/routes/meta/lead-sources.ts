/**
 * Páginas que enviam leads de anúncio para o workspace (F69-S03).
 *
 *  - `GET    /api/meta/lead-sources`      — páginas ativas, páginas disponíveis e os leads recentes.
 *  - `POST   /api/meta/lead-sources`      — assina a página no campo `leadgen` e passa a receber.
 *  - `DELETE /api/meta/lead-sources/:id`  — para de receber.
 *
 * ## Assinar sem apagar o que já está assinado
 *
 * `POST /{page}/subscribed_apps` define a lista de campos do app naquela página. Se a
 * mesma página já recebe mensagens do Instagram pelo app, mandar só `leadgen`
 * trocaria a lista e cortaria o Direct do cliente sem ninguém perceber. Por isso a
 * rota lê a assinatura atual e envia a união.
 *
 * ## Parar sem desassinar
 *
 * Pelo mesmo motivo, parar de receber só desativa a fonte aqui. O webhook que ainda
 * chegar para a página é descartado pelo worker (página sem fonte ativa).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GraphClient, MetaError } from '@hm/channels';
import { decryptSecret, leadAdsRepo, metaConnectionsRepo } from '@hm/db';
import { createLogger } from '@hm/logger';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { platformSecrets } from '../../secrets';
import { permissionsFor } from '../../services/meta/permissions';

const logger = createLogger('info', { svc: '@hm/api' });

type Graph = Pick<GraphClient, 'get' | 'post'>;

const criarSchema = z.object({
  connectionId: z.string().uuid(),
  pageId: z.string().trim().regex(/^\d{1,32}$/),
});

/** Campos que o app já recebe na página + `leadgen`, sem duplicar. Puro, para teste. */
export function mergeSubscribedFields(atual: unknown, appId: string): string[] {
  const campos = new Set<string>(['leadgen']);
  const lista =
    typeof atual === 'object' && atual !== null && Array.isArray((atual as Record<string, unknown>)['data'])
      ? ((atual as Record<string, unknown>)['data'] as unknown[])
      : [];
  for (const app of lista) {
    if (typeof app !== 'object' || app === null) continue;
    const registro = app as Record<string, unknown>;
    if (String(registro['id']) !== appId) continue;
    const assinados = registro['subscribed_fields'];
    if (Array.isArray(assinados)) {
      for (const c of assinados) if (typeof c === 'string') campos.add(c);
    }
  }
  return [...campos].sort();
}

export interface LeadSourcesDeps {
  readonly graph?: Graph;
  readonly now?: () => Date;
  readonly appId?: () => string | undefined;
}

export function createLeadSourcesRouter(deps: LeadSourcesDeps = {}): Router {
  const router = Router();
  const graph: Graph = deps.graph ?? new GraphClient();
  const now = deps.now ?? (() => new Date());
  const appId = deps.appId ?? (() => platformSecrets.get('meta_app_id'));
  const guard = [requireAuth, withRLS, requireRole('channel.connect')] as const;

  router.get('/api/meta/lead-sources', ...guard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const { fontes, conexoes, recentes } = await req.scoped!(async (tx) => ({
      fontes: await leadAdsRepo.listSources(tx, workspaceId),
      conexoes: await metaConnectionsRepo.listForWorkspace(tx, workspaceId),
      recentes: await leadAdsRepo.listRecentSubmissions(tx, workspaceId, 20),
    }));

    const ativas = new Set(fontes.filter((f) => f.status === 'active').map((f) => f.pageId));
    const disponiveis = conexoes
      .filter((c) => c.status === 'active' && c.useCases.includes('leads'))
      .flatMap((c) =>
        c.assets.pages
          .filter((p) => !ativas.has(p.id))
          .map((p) => ({ connectionId: c.id, pageId: p.id, pageName: p.name })),
      );

    res.json({
      sources: fontes.map((f) => ({
        id: f.id,
        pageId: f.pageId,
        pageName: f.pageName,
        status: f.status,
        subscribedAt: f.subscribedAt?.toISOString() ?? null,
        lastReconciledAt: f.lastReconciledAt?.toISOString() ?? null,
      })),
      available: disponiveis,
      recent: recentes.map((r) => ({
        id: r.id,
        pageId: r.pageId,
        status: r.status,
        error: r.error,
        attempts: r.attempts,
        conversationId: r.conversationId,
        dealId: r.dealId,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  router.post('/api/meta/lead-sources', ...guard, async (req: Request, res: Response) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Escolha uma conexão e uma página.' });
      return;
    }
    const app = appId();
    if (app === undefined) {
      res.status(503).json({ code: 'META_APP_NOT_CONFIGURED', message: 'O app Meta não está configurado na plataforma.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const { connectionId, pageId } = parsed.data;

    const conexao = await req.scoped!((tx) => metaConnectionsRepo.getWithToken(tx, workspaceId, connectionId));
    if (conexao === null) {
      res.status(404).json({ message: 'Conexão não encontrada.' });
      return;
    }
    if (conexao.status !== 'active' || conexao.accessTokenEnc === null) {
      res.status(409).json({ code: 'META_RECONNECT_REQUIRED', message: 'O acesso foi removido. Conecte a Meta de novo.' });
      return;
    }
    const faltam = permissionsFor(['leads']).filter((p) => !conexao.grantedPermissions.includes(p));
    if (faltam.length > 0) {
      res.status(409).json({
        code: 'META_MISSING_PERMISSIONS',
        message: `Falta autorizar: ${faltam.join(', ')}. Reconecte a Meta marcando "Leads dos anúncios".`,
        missing: faltam,
      });
      return;
    }
    const pagina = conexao.assets.pages.find((p) => p.id === pageId);
    if (pagina === undefined) {
      // A página tem de ter vindo da própria conexão: impede assinar página de terceiro
      // informando um ID qualquer.
      res.status(404).json({ message: 'Esta página não aparece na conexão. Atualize a conexão e tente de novo.' });
      return;
    }

    try {
      const userToken = decryptSecret(conexao.accessTokenEnc, conexao.keyVersion);
      const tokenRes = await graph.get(`${pageId}?fields=access_token`, userToken);
      const pageToken =
        typeof tokenRes === 'object' && tokenRes !== null && typeof (tokenRes as Record<string, unknown>)['access_token'] === 'string'
          ? ((tokenRes as Record<string, unknown>)['access_token'] as string)
          : null;
      if (pageToken === null) {
        res.status(409).json({ code: 'META_PAGE_ACCESS', message: 'Sua conta não administra mais esta página.' });
        return;
      }
      const atual = await graph.get(`${pageId}/subscribed_apps`, pageToken);
      const campos = mergeSubscribedFields(atual, app);
      await graph.post(`${pageId}/subscribed_apps`, { subscribed_fields: campos.join(',') }, pageToken);
    } catch (err) {
      logger.error('meta.lead_sources.subscribe', {
        httpStatus: err instanceof MetaError ? err.httpStatus : undefined,
        graphCode: err instanceof MetaError ? err.code : undefined,
        erro: err instanceof Error ? err.message : String(err),
      });
      const detalhe = err instanceof MetaError ? `A Meta recusou: ${err.message}` : 'Falha ao falar com a Meta. Tente de novo.';
      res.status(502).json({ code: 'META_GRAPH_ERROR', message: detalhe });
      return;
    }

    const fonte = await req.scoped!((tx) =>
      leadAdsRepo.upsertSource(tx, { workspaceId, connectionId, pageId, pageName: pagina.name, now: now() }),
    );
    res.status(201).json({ source: { id: fonte.id, pageId: fonte.pageId, pageName: fonte.pageName, status: fonte.status } });
  });

  router.delete('/api/meta/lead-sources/:id', ...guard, async (req: Request, res: Response) => {
    const id = z.string().uuid().safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ message: 'Página não encontrada.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const ok = await req.scoped!((tx) => leadAdsRepo.deactivateSource(tx, workspaceId, id.data, now()));
    if (!ok) {
      res.status(404).json({ message: 'Página não encontrada.' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
