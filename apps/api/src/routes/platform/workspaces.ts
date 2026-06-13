/**
 * API de plataforma -- Tenants list + Workspace 360 (F26-S02).
 *
 *   GET /api/platform/tenants            lista paginavel/buscavel com agregados
 *   GET /api/platform/tenants/:id        Workspace 360 agregado
 *
 * Montado em /tenants (nao /workspaces) para nao colidir com o seletor simples
 * GET /api/platform/workspaces ja exposto pela F25 (policies.ts). Cross-workspace
 * lido como owner -- o guard requirePlatformAdmin e a fronteira. Sem schema novo.
 * INVARIANTE: a serializacao do 360 nunca inclui secrets/tokens (so metadados).
 * Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { getWorkspace360, listTenants } from '../../services/platform/workspace-360';

const listQuery = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['trial', 'active', 'past_due', 'canceled', 'expired']).optional(),
  planKey: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.string().uuid();

export function createPlatformWorkspacesRouter(): Router {
  const router = Router();

  router.get('/api/platform/tenants', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { search, status, planKey, limit, offset } = parsed.data;
    const result = await listTenants({ search, status, planKey, limit, offset });
    res.json({ tenants: result.items, total: result.total, limit, offset });
  });

  router.get(
    '/api/platform/tenants/:id',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const parsed = idParam.safeParse(req.params['id']);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const result = await getWorkspace360(parsed.data);
      if (!result) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      res.json(result);
    },
  );

  return router;
}
