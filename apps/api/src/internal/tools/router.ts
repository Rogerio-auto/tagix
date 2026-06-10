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
 *   4. Roda o handler DENTRO de `withWorkspace(workspace_id, …)` (RLS escopada),
 *      cronometra a latência, e grava uma linha em `tool_logs` (best-effort:
 *      uma falha de auditoria não derruba a ação).
 *   5. Responde JSON tipado `{ ok, content?, error?, payload? }`.
 *
 * Boundary (F2-S07): este router é exportado por `createInternalToolsRouter` e
 * o orchestrator o monta em `app.ts` (vide nota no relatório). Ele NÃO entra
 * atrás de `requireAuth`/`withRLS`.
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
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
 * Grava a trilha em `tool_logs` (best-effort). Resolve `tools.id` por `key` no
 * escopo do workspace; se a tool não estiver no catálogo (ex.: handler embutido
 * `ping`), pula a auditoria — a FK `tool_id` é NOT NULL e não inventamos id.
 */
async function writeToolLog(
  tx: DbTx,
  params: {
    toolKey: string;
    envelope: ToolCallEnvelope;
    result: ToolHandlerResult;
    durationMs: number;
  },
): Promise<void> {
  const { toolKey, envelope, result, durationMs } = params;
  const [tool] = await tx
    .select({ id: schema.tools.id })
    .from(schema.tools)
    .where(eq(schema.tools.key, toolKey))
    .limit(1);
  if (!tool) return; // tool não catalogada (ex.: `ping`) → sem linha de auditoria.

  await tx.insert(schema.toolLogs).values({
    workspaceId: envelope.workspaceId,
    agentId: envelope.agentId,
    toolId: tool.id,
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

export interface InternalToolsRouterOptions {
  /** Override do registry (testes). Default: registry com os built-ins do slot. */
  readonly registry?: ToolHandlerRegistry;
  /** Override do token (testes). Default: `process.env['AGENT_RUNTIME_TOKEN']`. */
  readonly token?: string;
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
    let result: ToolHandlerResult;
    try {
      result = await withWorkspace(envelope.workspaceId, async (tx) => {
        const r = await handler(envelope, tx);
        await writeToolLog(tx, {
          toolKey,
          envelope,
          result: r,
          durationMs: Date.now() - startedAt,
        });
        return r;
      });
    } catch (err) {
      // Falha do handler ou da transação: nunca vaza stack/PII ao runtime.
      const ref = `hm_tool_${toolKey}`;
      console.error(
        JSON.stringify({
          level: 'error',
          ref,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      res.status(500).json({ ok: false, error: `Failed to execute '${toolKey}'.` });
      return;
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
