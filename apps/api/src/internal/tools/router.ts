/**
 * Endpoint interno de tools de negócio — callback Python → Node.
 *
 *   POST /internal/tools/:toolKey
 *
 * Fluxo (F2-S07 — transporte + dispatch skeleton; tools concretas em F2-S20):
 *   1. Auth por token interno compartilhado (`AGENT_RUNTIME_TOKEN`) — NÃO sessão
 *      de usuário. Misconfig → 500; sem/!= token → 401. Ver `auth.ts`.
 *   2. Resolve o handler por `:toolKey` no registry. Desconhecido → 404.
 *   3. Valida o envelope `{ workspace_id, conversation_id, agent_id,
 *      execution_id, args }` via Zod. Inválido → 400.
 *   4. Barreira de habilitação (F70-S15, `access.ts`), na MESMA transação RLS: a
 *      tool tem de estar habilitada para o agente e a execução tem de ser dele e
 *      estar em curso. Recusa → 403, nada executa, e a recusa fica em `tool_logs`
 *      (`action='denied'`) + log estruturado.
 *   5. Roda o handler DENTRO de `withWorkspace(workspace_id, …)` (RLS escopada),
 *      cronometra a latência, e grava uma linha em `tool_logs` apontando para a
 *      linha de `tools` que a barreira resolveu (custom do workspace > global).
 *   6. Depois do commit, publica os eventos de domínio que o handler declarou
 *      (`result.events`, F70-S09) — webhooks de saída.
 *   7. Responde JSON tipado `{ ok, content?, error?, payload? }`.
 *
 * Boundary (F2-S07): este router é exportado por `createInternalToolsRouter` e
 * o orchestrator o monta em `app.ts` (vide nota no relatório). Ele NÃO entra
 * atrás de `requireAuth`/`withRLS`.
 */
import { Router, type Request, type Response } from 'express';
import { schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import { emitDomainEvents } from '@hm/shared/mq';
import {
  authorizeToolCall,
  writeDenialLog,
  type ToolCallAuthorizer,
  type ToolCallDenialReason,
} from './access';
import { createInternalTokenGuard } from './auth';
import { toolCallEnvelopeSchema } from './schema';
import {
  createDefaultRegistry,
  type ToolCallEnvelope,
  type ToolHandlerRegistry,
  type ToolHandlerResult,
} from './registry';

/** Tamanho máximo serializado dos `params`/`result` persistidos em `tool_logs`. */
const LOG_SUMMARY_MAX = 4_000;

/** Trunca um objeto JSON-serializável para caber no log (sem PII extra). */
function summarize(value: unknown): Record<string, unknown> {
  try {
    const json = JSON.stringify(value ?? {});
    if (json.length <= LOG_SUMMARY_MAX) {
      const parsed: unknown = JSON.parse(json);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    }
    return { truncated: true, length: json.length };
  } catch {
    return { unserializable: true };
  }
}

/**
 * Grava a trilha em `tool_logs`. `toolId` é a linha que a barreira de habilitação
 * resolveu (custom do workspace > global) — nunca uma busca solta por `key`, que
 * podia cair na tool custom de outro workspace (`tools` não tem RLS).
 */
async function writeToolLog(
  tx: DbTx,
  params: {
    toolId: string;
    envelope: ToolCallEnvelope;
    result: ToolHandlerResult;
    durationMs: number;
  },
): Promise<void> {
  const { toolId, envelope, result, durationMs } = params;
  await tx.insert(schema.toolLogs).values({
    workspaceId: envelope.workspaceId,
    agentId: envelope.agentId,
    toolId,
    conversationId: envelope.conversationId,
    executionId: envelope.executionId,
    action: result.action ?? 'workflow',
    tableName: result.tableName ?? null,
    params: summarize(envelope.args),
    result: result.ok ? summarize(result.payload ?? { content: result.content }) : null,
    error: result.ok ? null : (result.error ?? 'unknown error'),
    durationMs,
  });
}

/** Resultado da transação: recusa (nada executou) ou o que o handler devolveu. */
type CallOutcome =
  | { readonly kind: 'denied'; readonly reason: ToolCallDenialReason }
  | { readonly kind: 'executed'; readonly result: ToolHandlerResult };

export interface InternalToolsRouterOptions {
  /** Override do registry (testes). Default: registry com os built-ins do slot. */
  readonly registry?: ToolHandlerRegistry;
  /** Override do token (testes). Default: `process.env['AGENT_RUNTIME_TOKEN']`. */
  readonly token?: string;
  /** Override da barreira de habilitação (testes). Default: `authorizeToolCall` (banco). */
  readonly authorize?: ToolCallAuthorizer;
  /** Logger (testes). Default: `createLogger('info', { svc: '@hm/api', component: 'internal-tools' })`. */
  readonly logger?: Logger;
}

/**
 * Factory do router interno. O token é capturado AQUI (construção) — fail-closed
 * via middleware se vazio. Mantemos a checagem fora do handler para reportar
 * misconfiguração cedo, mas sem derrubar o boot (o guard responde 500).
 */
export function createInternalToolsRouter(options: InternalToolsRouterOptions = {}): Router {
  const router = Router();
  const registry = options.registry ?? createDefaultRegistry();
  const token = options.token ?? process.env['AGENT_RUNTIME_TOKEN'] ?? '';
  const guard = createInternalTokenGuard(token);
  const authorize = options.authorize ?? authorizeToolCall;
  const logger = options.logger ?? createLogger('info', { svc: '@hm/api', component: 'internal-tools' });

  router.post('/internal/tools/:toolKey', guard, async (req: Request, res: Response) => {
    const rawKey = req.params['toolKey'];
    const toolKey = typeof rawKey === 'string' ? rawKey : '';

    const handler = registry.resolve(toolKey);
    if (!handler) {
      res.status(404).json({ ok: false, error: `Unknown tool '${toolKey}'.` });
      return;
    }

    const parsed = toolCallEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid envelope.' });
      return;
    }

    const envelope: ToolCallEnvelope = {
      workspaceId: parsed.data.workspace_id,
      conversationId: parsed.data.conversation_id ?? null,
      agentId: parsed.data.agent_id,
      executionId: parsed.data.execution_id,
      args: parsed.data.args,
    };

    const startedAt = Date.now();
    let outcome: CallOutcome;
    try {
      outcome = await withWorkspace(envelope.workspaceId, async (tx): Promise<CallOutcome> => {
        const decision = await authorize(tx, toolKey, envelope);
        if (!decision.allowed) {
          // A recusa commita (o log fica); o handler nunca é chamado.
          if (decision.toolId !== null) {
            await writeDenialLog(tx, {
              toolId: decision.toolId,
              toolKey,
              envelope,
              reason: decision.reason,
            });
          }
          return { kind: 'denied', reason: decision.reason };
        }
        const r = await handler(envelope, tx);
        await writeToolLog(tx, {
          toolId: decision.toolId,
          envelope,
          result: r,
          durationMs: Date.now() - startedAt,
        });
        return { kind: 'executed', result: r };
      });
    } catch (err) {
      // Falha do handler ou da transação: nunca vaza stack/PII ao runtime.
      logger.error('internal-tools: falha ao executar tool', {
        ref: `hm_tool_${toolKey}`,
        toolKey,
        workspaceId: envelope.workspaceId,
        executionId: envelope.executionId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ ok: false, error: `Failed to execute '${toolKey}'.` });
      return;
    }

    if (outcome.kind === 'denied') {
      logger.warn('internal-tools: chamada recusada', {
        toolKey,
        reason: outcome.reason,
        workspaceId: envelope.workspaceId,
        agentId: envelope.agentId,
        executionId: envelope.executionId,
        conversationId: envelope.conversationId,
      });
      // Motivo detalhado fica no log; o runtime recebe só a recusa.
      res.status(403).json({ ok: false, error: `Tool '${toolKey}' is not enabled for this agent.` });
      return;
    }
    const { result } = outcome;

    // F70-S09: eventos de domínio da ação, só agora — a transação já commitou.
    // O emissor nunca lança; a resposta ao runtime não espera o broker falhar.
    if (result.ok && result.events && result.events.length > 0) {
      await emitDomainEvents(result.events);
    }

    res.status(result.ok ? 200 : 422).json({
      ok: result.ok,
      ...(result.content !== undefined ? { content: result.content } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.payload !== undefined ? { payload: result.payload } : {}),
    });
  });

  return router;
}
