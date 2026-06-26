/**
 * Executions de flows (FLOW_BUILDER.md secao 10, PERMISSIONS flow.*).
 *
 *   GET    /api/flows/:id/executions        executions de um flow            (flow.list)
 *   GET    /api/flow-executions/:id          detalhe + logs                   (flow.view_logs)
 *   POST   /api/flow-executions/:id/cancel   cancela execucao                 (flow.cancel)
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { cancelFlowExecution } from '@hm/flow-engine';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { FlowExecutionUpdatedPayload } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { flowExecutions, flowLogs, flows } = schema;

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

// ── Publisher MQ (canal AMQP lazy, compartilhado por processo) ────────────────
let handlePromise: Promise<MqHandle> | null = null;
async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Publica `flow_execution:updated` nas rooms da conversa + workspace. Best-effort. */
async function emitFlowExecutionUpdated(
  workspaceId: string,
  data: FlowExecutionUpdatedPayload,
): Promise<void> {
  try {
    const { channel } = await getMqHandle();
    const envelope = makeEnvelope('socket.relay', workspaceId, {
      event: 'flow_execution:updated',
      target: { conversationId: data.conversationId ?? undefined, workspace: true },
      data,
    });
    channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch {
    // best-effort: o cancel já persistiu; um relay perdido é coberto pelo polling do front.
  }
}

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
  // Badge do inbox (FlowExecutionsBadge): execuções de flow de UMA conversa. Read-only e
  // workspace-scoped por RLS — qualquer membro que vê a conversa pode ver (sem flow.list,
  // pra não gerar 403 a atendentes). REGISTRADA ANTES de `/api/flows/:id` (crud) para o
  // literal `executions` não cair na rota paramétrica.
  const convExecGuard = [requireAuth, withRLS] as const;

  // GET /api/flows/executions?conversationId=<uuid> — execuções de flow de uma conversa.
  router.get('/api/flows/executions', ...convExecGuard, async (req: Request, res: Response) => {
    const conversationId = typeof req.query['conversationId'] === 'string' ? req.query['conversationId'] : '';
    if (!conversationId) {
      res.json({ executions: [] });
      return;
    }
    // leftJoin em flows p/ o nome (cockpit F51). leftJoin: flow deletado → flowName null.
    const rows = await req.scoped!((tx) =>
      tx
        .select({
          id: flowExecutions.id,
          flowId: flowExecutions.flowId,
          flowName: flows.name,
          status: flowExecutions.status,
          currentNodeId: flowExecutions.currentNodeId,
          startedAt: flowExecutions.startedAt,
          nextStepAt: flowExecutions.nextStepAt,
          completedAt: flowExecutions.completedAt,
          lastError: flowExecutions.lastError,
        })
        .from(flowExecutions)
        .leftJoin(flows, eq(flows.id, flowExecutions.flowId))
        .where(eq(flowExecutions.conversationId, conversationId))
        .orderBy(desc(flowExecutions.startedAt)),
    );
    res.json({ executions: rows });
  });

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

      // 404 se a execucao nao existe no workspace (RLS). Traz conversa/flow p/ o evento.
      const target = await req.scoped!(async (tx) => {
        const [row] = await tx
          .select({
            id: flowExecutions.id,
            conversationId: flowExecutions.conversationId,
            flowId: flowExecutions.flowId,
          })
          .from(flowExecutions)
          .where(eq(flowExecutions.id, id))
          .limit(1);
        return row;
      });
      if (!target) {
        res.sendStatus(404);
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;
      await cancelFlowExecution(workspaceId, id, reason);

      // F51: notifica o cockpit em tempo real (defaultEngine da API não tem events port).
      await emitFlowExecutionUpdated(workspaceId, {
        conversationId: target.conversationId,
        flowId: target.flowId,
        executionId: id,
        status: 'cancelled',
        nextStepAt: null,
      });

      res.sendStatus(204);
    },
  );

  return router;
}
