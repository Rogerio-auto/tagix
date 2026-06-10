/**
 * Executions de flows (FLOW_BUILDER.md secao 10, PERMISSIONS flow.*).
 *
 *   GET    /api/flows/:id/executions        executions de um flow            (flow.list)
 *   GET    /api/flow-executions/:id          detalhe + logs                   (flow.view_logs)
 *   POST   /api/flow-executions/:id/cancel   cancela execucao                 (flow.cancel)
 */
import { Router, type Request, type Response } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { cancelFlowExecution } from '@hm/flow-engine';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { flowExecutions, flowLogs } = schema;

/** Narrowing de req.params (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export function createFlowExecutionsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('flow.list')] as const;
  const logsGuard = [requireAuth, withRLS, requireRole('flow.view_logs')] as const;
  const cancelGuard = [requireAuth, withRLS, requireRole('flow.cancel')] as const;

  // GET /api/flows/:id/executions
  router.get('/api/flows/:id/executions', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.flowId, param(req, 'id')))
        .orderBy(desc(flowExecutions.startedAt)),
    );
    res.json({ executions: rows });
  });

  // GET /api/flow-executions/:id — detalhe + logs.
  router.get('/api/flow-executions/:id', ...logsGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [execution] = await tx
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.id, id))
        .limit(1);
      if (!execution) return null;
      const logs = await tx
        .select()
        .from(flowLogs)
        .where(eq(flowLogs.executionId, id))
        .orderBy(asc(flowLogs.createdAt));
      return { execution, logs };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  });

  // POST /api/flow-executions/:id/cancel
  router.post(
    '/api/flow-executions/:id/cancel',
    ...cancelGuard,
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      const workspaceId = req.auth!.workspace.id;

      // 404 se a execucao nao existe no workspace (RLS).
      const exists = await req.scoped!(async (tx) => {
        const [row] = await tx
          .select({ id: flowExecutions.id })
          .from(flowExecutions)
          .where(eq(flowExecutions.id, id))
          .limit(1);
        return row !== undefined;
      });
      if (!exists) {
        res.sendStatus(404);
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;
      await cancelFlowExecution(workspaceId, id, reason);
      res.sendStatus(204);
    },
  );

  return router;
}
