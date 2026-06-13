/**
 * Proxy de plataforma do Agent Playground (F26-S10 wire / glue do orchestrator).
 *
 * POST /api/platform/playground -- super-admin testa um agente de QUALQUER tenant em
 * SANDBOX. Faz proxy do stream SSE do agent-runtime com `is_playground: true` -> o
 * runtime (F26-S06) roda o grafo SEM side-effect de producao: tools de negocio viram
 * mock "would-do", nada e gravado em conversations/messages/agent_executions, e o custo
 * vai com is_test=true (fora do cap de producao). Gated por requirePlatformAdmin (a
 * camada de plataforma nao tem RLS de tenant -- o guard e a fronteira; resolvemos a
 * policy do workspace-alvo como owner). Espelha routes/agents/playground.ts (F2-S19),
 * mas cross-workspace e platform-gated. Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import {
  AgentRuntimeError,
  createAgentsClient,
  type AgentRunRequest,
  type AgentStreamEvent,
} from '@hm/agents-client';
import { resolvePolicy } from '@hm/agents-core';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid(),
  userInput: z.string().trim().min(1).max(20000),
  // Override efemero (repassado como metadata ao runtime; enforcement de modelo
  // continua na policy/whitelist do workspace, igual ao live).
  model: z.string().trim().min(1).max(120).optional(),
  systemPrompt: z.string().trim().max(20000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

function runtimeConfigFromEnv(): { baseUrl: string; token: string } {
  const baseUrl = process.env['AGENT_RUNTIME_URL'];
  const token = process.env['AGENT_RUNTIME_TOKEN'];
  if (!baseUrl) throw new Error('platform playground: AGENT_RUNTIME_URL ausente.');
  if (!token) throw new Error('platform playground: AGENT_RUNTIME_TOKEN ausente.');
  return { baseUrl, token };
}

function writeEvent(res: Response, event: AgentStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createPlatformPlaygroundRouter(): Router {
  const router = Router();

  router.post(
    '/api/platform/playground',
    ...requirePlatformAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const { workspaceId, agentId, userInput, model, systemPrompt, temperature } = parsed.data;

      // Valida o agente como pertencente ao workspace-alvo (owner; o guard e a fronteira).
      const [agent] = await getDb()
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      if (!agent || (agent as { id: string }).id !== agentId) {
        res.status(404).json({ error: 'agent_not_found' });
        return;
      }
      // Confirma que o agente e do workspace informado (cross-tenant guard).
      const [owned] = await getDb()
        .select({ workspaceId: schema.agents.workspaceId })
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      if (!owned || owned.workspaceId !== workspaceId) {
        res.status(404).json({ error: 'agent_not_in_workspace' });
        return;
      }

      // Policy do workspace-alvo (enforcement de whitelist/caps vale igual ao live).
      const resolved = await resolvePolicy(workspaceId, agentId);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();

      const controller = new AbortController();
      let clientGone = false;
      req.on('close', () => {
        clientGone = true;
        controller.abort();
      });

      try {
        const { baseUrl, token } = runtimeConfigFromEnv();
        const client = createAgentsClient({ baseUrl, token });

        const metadata: Record<string, unknown> = { playground: true, sandbox: true };
        if (model) metadata['override_model'] = model;
        if (systemPrompt) metadata['override_system_prompt'] = systemPrompt;
        if (temperature !== undefined) metadata['override_temperature'] = temperature;

        const runReq: AgentRunRequest = {
          workspace_id: workspaceId,
          agent_id: agentId,
          conversation_id: null,
          contact_id: null,
          user_input: userInput,
          messages: [],
          policy_snapshot: resolved.snapshot,
          // is_playground=true -> o runtime (F26-S06) entra em sandbox: tools mockadas,
          // sem persistencia de producao, custo is_test. Zero side-effect.
          is_playground: true,
          metadata,
        };

        for await (const ev of client.run(runReq, { signal: controller.signal })) {
          if (clientGone) break;
          writeEvent(res, ev);
          if (ev.type === 'final') break;
        }
      } catch (err: unknown) {
        if (clientGone) return;
        const ref =
          err instanceof AgentRuntimeError
            ? err.ref
            : `hm-platform-pg-${Date.now().toString(36)}`;
        const message =
          err instanceof AgentRuntimeError ? err.message : 'Falha ao executar o agente em sandbox.';
        if (!res.writableEnded) {
          writeEvent(res, { type: 'error', message: `${message} (ref ${ref})` });
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
    },
  );

  return router;
}
