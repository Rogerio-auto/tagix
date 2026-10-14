/**
 * Rotas do dashboard (DASHBOARD.md §8). Server-driven: o servidor decide os cards
 * por role (§8); o front nunca filtra por role (anti-padrão v1 §10).
 *
 *   GET /api/dashboard/me            cards/alerts/layout do member autenticado
 *   GET /api/dashboard/home          Home (F72-S04): KPIs + delta + atenção, por papel
 *   GET /api/dashboard/today         Hoje (F61-S02): fila + agenda; recorte pessoal p/ AGENT/READONLY
 *   GET /api/dashboard/metrics/:key  drill-down detalhado (série/tabela), role-gated
 *
 * Guard: requireAuth + withRLS (toda query roda na tx com RLS do workspace). Sem
 * requireRole específico — o GET é permitido a qualquer member; a filtragem do
 * conteúdo por role acontece no serviço (loadDashboard / drillDown), não no guard.
 * O papel da sessão passa por `parseRole` em TODAS as rotas: fora da matriz é 403
 * (fail-closed), nunca um cast. Toda resposta com dado do tenant sai com `private, no-store`.
 * Montado em app.ts pelo orchestrator (gap-fill de wiring).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { drillDown, loadDashboard, loadHome } from '../../services/dashboard';
import { homeQuerySchema, parseRole } from './home-query';
import { loadToday } from './today';
import { createTodayActionsRouter } from './today-actions';

const metricKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,64}$/, 'metric_key inválido');

// Parâmetro opcional do drill-down (ex.: categoria de objeção). Mesmo formato seguro.
const drillParamSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,64}$/);

export function createDashboardRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS] as const;

  // Ações da tela "Hoje" (F61-S12) — montadas aqui para não multiplicar pontos
  // de mount em `app.ts`. Guards próprios (a permissão varia por ação).
  router.use(createTodayActionsRouter());

  // GET /api/dashboard/today — a visão de dono (F61-S02). Uma chamada só: a tela
  // abre no 4G, muitas vezes na obra, e três requisições em cascata são meio
  // segundo a mais e três chances de a tela ficar pela metade.
  router.get('/api/dashboard/today', ...guard, async (req: Request, res: Response) => {
    const auth = req.auth!;
    const role = parseRole(auth.member.role);
    if (!role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    // F72-S04: o recorte (fila pessoal, visibilidade da inbox F30, calendários
    // acessíveis, mês só para gestão) é resolvido no servidor a partir do papel da
    // sessão — `resolveTodayScope`. A tela não filtra por papel.
    const payload = await req.scoped!((tx) =>
      loadToday(tx, {
        workspaceId: auth.workspace.id,
        viewer: { memberId: auth.member.id, role },
      }),
    );
    // Fila com nome/telefone de lead: dado do tenant, nunca em cache compartilhado.
    res.set('Cache-Control', 'private, no-store');
    res.json(payload);
  });

  // GET /api/dashboard/home — a Home (F72-S04): resultado + o que precisa de atenção.
  // O papel decide o escopo no servidor (workspace x pessoal); não há custo de IA/infra
  // neste payload para papel nenhum. Contrato: `services/dashboard/home-model.ts`.
  router.get('/api/dashboard/home', ...guard, async (req: Request, res: Response) => {
    const query = homeQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    const auth = req.auth!;
    const role = parseRole(auth.member.role);
    if (!role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const payload = await req.scoped!((tx) =>
      loadHome(tx, {
        workspaceId: auth.workspace.id,
        memberId: auth.member.id,
        role,
        periodDays: query.data.periodDays,
      }),
    );
    // Número do workspace é dado do tenant: nunca em cache compartilhado.
    res.set('Cache-Control', 'private, no-store');
    res.json(payload);
  });

  // GET /api/dashboard/me — payload role-aware completo.
  router.get('/api/dashboard/me', ...guard, async (req: Request, res: Response) => {
    const auth = req.auth!;
    const role = parseRole(auth.member.role);
    if (!role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const payload = await req.scoped!((tx) =>
      loadDashboard(tx, {
        workspaceId: auth.workspace.id,
        memberId: auth.member.id,
        role,
      }),
    );
    res.set('Cache-Control', 'private, no-store');
    res.json(payload);
  });

  // GET /api/dashboard/metrics/:key — drill-down (série/tabela).
  router.get('/api/dashboard/metrics/:key', ...guard, async (req: Request, res: Response) => {
    const parsed = metricKeySchema.safeParse(req.params['key']);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_metric_key' });
      return;
    }
    const auth = req.auth!;
    const role = parseRole(auth.member.role);
    if (!role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const rawParam = req.query['param'] ?? req.query['category'];
    const paramParsed =
      typeof rawParam === 'string' ? drillParamSchema.safeParse(rawParam) : null;
    if (typeof rawParam === 'string' && paramParsed && !paramParsed.success) {
      res.status(400).json({ error: 'invalid_param' });
      return;
    }
    const result = await req.scoped!((tx) =>
      drillDown(tx, {
        workspaceId: auth.workspace.id,
        memberId: auth.member.id,
        role,
        metricKey: parsed.data,
        param: paramParsed?.success ? paramParsed.data : undefined,
      }),
    );
    res.set('Cache-Control', 'private, no-store');
    switch (result.kind) {
      case 'ok':
        res.json({ metricKey: result.metricKey, detail: result.detail });
        return;
      case 'unknown_metric':
        res.status(404).json({ error: 'unknown_metric' });
        return;
      case 'forbidden':
        res.status(403).json({ error: 'forbidden' });
        return;
      case 'no_detail':
        res.status(204).end();
        return;
    }
  });

  return router;
}
