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
 *   4. Barreira de habilitação (F70-S15, `access.ts`), ANTES de executar e na mesma
 *      transação RLS da ação: a tool tem de estar habilitada para o agente e a
 *      execução tem de ser dele, da mesma conversa e estar em curso. Recusa → 403 e
 *      o handler nunca roda.
 *   5. Roda o handler DENTRO de `withWorkspace(workspace_id, …)` (RLS escopada) e
 *      cronometra a latência.
 *   6. Depois do commit, a auditoria em `tool_logs` (execução OU recusa) roda numa
 *      transação própria, best-effort: um erro no INSERT do log (ex.: FK 23503) não
 *      desfaz a ação nem vira 500. A linha aponta para o `tools.id` que a barreira
 *      resolveu (custom do workspace > global), nunca uma busca solta por `key`.
 *   7. Depois do commit, publica os eventos de domínio que o handler declarou
 *      (`result.events`, F70-S09) — webhooks de saída.
 *   8. Responde JSON tipado `{ ok, content?, error?, payload? }`.
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
  type ToolCallDecision,
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
 * Campos de texto livre que o modelo escreve (motivo, nota, resolução…). Costumam
 * repetir o que o cliente disse — CPF, telefone, e-mail. No log ficam curtos e sem
 * dígitos nem e-mail: dá para auditar a intenção sem guardar o dado (F70-S15, L8).
 */
const FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
  'reason',
  'note',
  'resolution',
  'message',
  'text',
  'summary',
  'comment',
]);
const FREE_TEXT_MAX = 120;

function maskFreeText(value: string): string {
  const masked = value.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\d/g, '#');
  return masked.length > FREE_TEXT_MAX ? `${masked.slice(0, FREE_TEXT_MAX)}…` : masked;
}

/** Args para o log: texto livre mascarado e truncado; o resto como veio. */
export function redactLogArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = FREE_TEXT_KEYS.has(key) && typeof value === 'string' ? maskFreeText(value) : value;
  }
  return out;
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
    params: summarize(redactLogArgs(envelope.args)),
    result: result.ok ? summarize(result.payload ?? { content: result.content }) : null,
    error: result.ok ? null : (result.error ?? 'unknown error'),
    durationMs,
  });
}

/** Resultado da transação da ação: recusa (nada executou) ou o que o handler devolveu. */
type CallOutcome =
  | { readonly kind: 'denied'; readonly decision: Extract<ToolCallDecision, { allowed: false }> }
  | { readonly kind: 'executed'; readonly toolId: string; readonly result: ToolHandlerResult };

/**
 * Só código/constraint do Postgres: a `message` do Drizzle embute os params da
 * query (args do modelo, possivelmente PII).
 */
function pgErrorFields(err: unknown): { code?: string; constraint?: string } {
  const cause: unknown = err instanceof Error ? err.cause : undefined;
  const pg = typeof cause === 'object' && cause !== null ? cause : {};
  return {
    ...('code' in pg ? { code: String(pg.code) } : {}),
    ...('constraint_name' in pg ? { constraint: String(pg.constraint_name) } : {}),
  };
}

export interface InternalToolsRouterOptions {
  /** Override do registry (testes). Default: registry com os built-ins do slot. */
  readonly registry?: ToolHandlerRegistry;
  /** Override do token (testes). Default: `process.env['AGENT_RUNTIME_TOKEN']`. */
  readonly token?: string;
  /** Override da barreira de habilitação (testes). Default: `authorizeToolCall` (banco). */
  readonly authorize?: ToolCallAuthorizer;
  /** Logger (testes). Default: logger do `@hm/api` (componente `internal-tools`). */
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
  const logger =
    options.logger ?? createLogger('info', { svc: '@hm/api', component: 'internal-tools' });

  /** Auditoria best-effort em transação própria: falha vira warn, nunca 500. */
  async function audit(
    toolKey: string,
    envelope: ToolCallEnvelope,
    write: (tx: DbTx) => Promise<void>,
  ): Promise<void> {
    try {
      await withWorkspace(envelope.workspaceId, write);
    } catch (logErr) {
      logger.warn('internal-tools: falha ao gravar tool_logs', {
        ref: `hm_tool_log_${toolKey}`,
        toolKey,
        executionId: envelope.executionId,
        ...pgErrorFields(logErr),
      });
    }
  }

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
        // Recusa: o handler nunca é chamado.
        if (!decision.allowed) return { kind: 'denied', decision };
        const result = await handler(envelope, tx);
        return { kind: 'executed', toolId: decision.toolId, result };
      });
    } catch (err) {
      // Falha do handler ou da transação: nunca vaza stack/PII ao runtime.
      logger.error('internal-tools: falha ao executar tool', {
        ref: `hm_tool_${toolKey}`,
        toolKey,
        workspaceId: envelope.workspaceId,
        executionId: envelope.executionId,
        errorName: err instanceof Error ? err.name : typeof err,
        ...pgErrorFields(err),
      });
      res.status(500).json({ ok: false, error: `Failed to execute '${toolKey}'.` });
      return;
    }

    if (outcome.kind === 'denied') {
      const { reason, toolId } = outcome.decision;
      logger.warn('internal-tools: chamada recusada', {
        toolKey,
        reason,
        workspaceId: envelope.workspaceId,
        agentId: envelope.agentId,
        executionId: envelope.executionId,
        conversationId: envelope.conversationId,
      });
      // Sem linha de `tools` visível ao workspace não há como auditar (FK NOT NULL).
      if (toolId !== null) {
        await audit(toolKey, envelope, (tx) =>
          writeDenialLog(tx, { toolId, toolKey, envelope, reason }),
        );
      }
      // Motivo detalhado fica no log; o runtime recebe só a recusa.
      res
        .status(403)
        .json({ ok: false, error: `Tool '${toolKey}' is not enabled for this agent.` });
      return;
    }

    const { result, toolId } = outcome;
    const durationMs = Date.now() - startedAt;
    await audit(toolKey, envelope, (tx) =>
      writeToolLog(tx, { toolId, envelope, result, durationMs }),
    );

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
