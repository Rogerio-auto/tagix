/**
 * Playground do agente (F2-S19, AGENTS_LANGGRAPH §10, UX §2/§3).
 *
 * `POST /api/agents/:id/playground` — endpoint SSE que faz **proxy** do stream do
 * `agent-runtime` (`@hm/agents-client`.`run`) para o browser. Permite testar um
 * agente em um chat ao vivo (tokens/tool calls/final em tempo real) SEM criar
 * conversas/mensagens reais:
 *
 *  - `is_playground: true` → no runtime, `load_context` trata
 *    `conversation_id`/`contact_id` como opcionais e as tools de negócio
 *    **simulam** (não escrevem); `finalize` marca `llm_usage_logs.metadata.playground=true`,
 *    então nenhuma mensagem real é persistida.
 *  - `conversation_id`/`contact_id` = `null` (sem conversa real).
 *
 * Segurança e governança (espelha o CRUD, F2-S16, e o dispatch do worker, F2-S11):
 *  - Sessão por cookie (`requireAuth` + `withRLS` + `requireRole('agent.list')`).
 *  - Agente validado como pertencente ao workspace ANTES de qualquer stream.
 *  - Policy resolvida (`resolvePolicy`) → `policy_snapshot` enviado ao runtime.
 *  - Cost-guard pré-chamada (`guardResolved`): se estouraria o cap mensal, emite
 *    um frame `budget_exceeded` e encerra — não toca o runtime.
 *  - Desconexão do cliente (`req.on('close')`) aborta o stream upstream
 *    (`AbortController`), liberando a conexão com o runtime.
 *  - Nunca propaga erro cru ao cliente: `AgentRuntimeError` (e qualquer falha)
 *    vira um frame SSE `error` seguro com `ref` correlacionável.
 *
 * O router é montado pelo orchestrator em `app.ts`/`createAgentsRouter` (fora do
 * boundary deste slot) — ver REPORT.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import {
  createAgentsClient,
  AgentRuntimeError,
  ChatMessageSchema,
  type AgentRunRequest,
  type AgentStreamEvent,
} from '@hm/agents-client';
import {
  resolvePolicy,
  guardResolved,
  estimateCostUsd,
  type ResolvedPolicy,
} from '@hm/agents-core';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Corpo aceito pelo playground: o turno do usuário + histórico opcional. */
const playgroundBodySchema = z.object({
  user_input: z.string().trim().min(1).max(20000),
  history: z.array(ChatMessageSchema).max(100).optional(),
});

/** Narrowing de `req.params['x']` (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Custo estimado (teto conservador) do turno de playground: prompt ~= histórico +
 * input em tokens grosseiros, completion = `max_tokens_per_call` da policy. O
 * pricing real é desconhecido neste boundary (sem snapshot de
 * `llm_models_whitelist`), então `estimateCostUsd` com pricing nulo devolve 0 e o
 * guard só bloqueia quando há cap E gasto já estourado. Mantém a barreira de cap
 * sem inflar. Espelha `estimateTurnCostUsd` do worker (F2-S11).
 */
function estimateTurnCostUsd(resolved: ResolvedPolicy, userInput: string, history: string): number {
  const promptChars = userInput.length + history.length;
  const promptTokens = Math.ceil(promptChars / 4); // ~4 chars/token (heurística OpenAI).
  return estimateCostUsd(
    { promptTokens, completionTokens: resolved.policy.maxTokensPerCall },
    { promptPer1m: null, completionPer1m: null },
  );
}

/**
 * Lê a config do runtime do ambiente (`AGENT_RUNTIME_URL` + `AGENT_RUNTIME_TOKEN`).
 * Lança cedo se faltar — espelha `agentRuntimeConfigFromEnv` do worker (F2-S11).
 */
function runtimeConfigFromEnv(): { baseUrl: string; token: string } {
  const baseUrl = process.env['AGENT_RUNTIME_URL'];
  const token = process.env['AGENT_RUNTIME_TOKEN'];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('playground: AGENT_RUNTIME_URL ausente no ambiente.');
  }
  if (token === undefined || token.length === 0) {
    throw new Error('playground: AGENT_RUNTIME_TOKEN ausente no ambiente.');
  }
  return { baseUrl, token };
}

/** Serializa um evento como frame SSE (`data: <json>\n\n`). */
function writeEvent(res: Response, event: AgentStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createAgentPlaygroundRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('agent.list')] as const;

  router.post(
    '/api/agents/:id/playground',
    ...guard,
    async (req: Request, res: Response): Promise<void> => {
      const agentId = param(req, 'id');
      if (!agentId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }

      const parsed = playgroundBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Entrada do playground inválida.' });
        return;
      }
      const { user_input, history = [] } = parsed.data;
      const workspaceId = req.auth!.workspace.id;

      // Valida o agente como pertencente ao workspace ANTES de qualquer stream
      // (RLS-escopado). Só precisamos confirmar existência + status.
      const [agent] = await req.scoped!((tx) =>
        tx
          .select({ id: schema.agents.id, status: schema.agents.status })
          .from(schema.agents)
          .where(eq(schema.agents.id, agentId))
          .limit(1),
      );
      if (!agent) {
        res.status(404).json({ message: 'Agente não encontrado.' });
        return;
      }

      // Policy + cost-guard (pré-stream, ainda com resposta JSON disponível).
      const resolved = await resolvePolicy(workspaceId, agentId);
      const historyChars = history.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
      const estimatedCostUsd = estimateTurnCostUsd(resolved, user_input, ' '.repeat(historyChars));
      const decision = guardResolved(resolved, estimatedCostUsd);

      // Abre o SSE. A partir daqui, todo erro vira um frame SSE (nunca status HTTP).
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // desliga buffering em proxies (nginx).
      });
      res.flushHeaders();

      // Cap mensal estourado: emite `budget_exceeded` e encerra sem tocar o runtime.
      if (!decision.ok) {
        writeEvent(res, { type: 'budget_exceeded' });
        res.end();
        return;
      }

      // Desconexão do cliente → aborta o stream upstream (libera a conexão Python).
      const controller = new AbortController();
      let clientGone = false;
      req.on('close', () => {
        clientGone = true;
        controller.abort();
      });

      try {
        const { baseUrl, token } = runtimeConfigFromEnv();
        const client = createAgentsClient({ baseUrl, token });

        const runReq: AgentRunRequest = {
          workspace_id: workspaceId,
          agent_id: agentId,
          conversation_id: null,
          contact_id: null,
          user_input,
          messages: history,
          policy_snapshot: resolved.snapshot,
          is_playground: true,
          metadata: { playground: true },
        };

        for await (const ev of client.run(runReq, { signal: controller.signal })) {
          if (clientGone) break;
          writeEvent(res, ev);
          if (ev.type === 'final') break;
        }
      } catch (err: unknown) {
        // Cliente desconectou no meio do stream: nada a fazer (conexão já fechada).
        if (clientGone) return;
        // `@hm/agents-client` converte `{ type: 'error' }` do grafo em
        // `AgentRuntimeError` (kind 'runtime'); demais falhas (rede/HTTP/contrato)
        // também. Emite um frame `error` seguro com `ref` correlacionável.
        const ref =
          err instanceof AgentRuntimeError ? err.ref : `hm-agent-internal-${Date.now().toString(36)}`;
        const message =
          err instanceof AgentRuntimeError
            ? err.message
            : 'Falha inesperada ao executar o agente.';
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
