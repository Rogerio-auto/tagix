/**
 * Rotas do dashboard (DASHBOARD.md §8). Server-driven: o servidor decide os cards
 * por role (§8); o front nunca filtra por role (anti-padrão v1 §10).
 *
 *   GET /api/dashboard/me            cards/alerts/layout do member autenticado
 *   GET /api/dashboard/metrics/:key  drill-down detalhado (série/tabela), role-gated
 *
 * Guard: requireAuth + withRLS (toda query roda na tx com RLS do workspace). Sem
 * requireRole específico — o GET é permitido a qualquer member; a filtragem do
 * conteúdo por role acontece no serviço (loadDashboard / drillDown), não no guard.
 * Montado em app.ts pelo orchestrator (gap-fill de wiring).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Role } from '@hm/shared';
import { requireAuth, withRLS } from '../../middlewares/auth';
import { drillDown, loadDashboard } from '../../services/dashboard';

const metricKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,64}$/, 'metric_key inválido');

export function createDashboardRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS] as const;

  // GET /api/dashboard/me — payload role-aware completo.
  router.get('/api/dashboard/me', ...guard, async (req: Request, res: Response) => {
    const auth = req.auth!;
    const payload = await req.scoped!((tx) =>
      loadDashboard(tx, {
        workspaceId: auth.workspace.id,
        memberId: auth.member.id,
        role: auth.member.role as Role,
      }),
    );
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
    const result = await req.scoped!((tx) =>
      drillDown(tx, {
        workspaceId: auth.workspace.id,
        memberId: auth.member.id,
        role: auth.member.role as Role,
        metricKey: parsed.data,
      }),
    );
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
