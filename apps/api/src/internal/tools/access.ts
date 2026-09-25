/**
 * Barreira de habilitação do endpoint interno de tools (F70-S15).
 *
 * O runtime só oferece ao modelo as tools do request, mas o request não é a última
 * palavra: um runtime com bug, um modelo que "inventa" o nome de uma tool registrada
 * ou um envelope reaproveitado não podem executar nada que o operador não habilitou.
 * Antes de qualquer handler, o router pergunta aqui, sob a RLS do workspace do
 * envelope:
 *
 *  1. **A tool está habilitada para o agente?** `agent_tools.is_enabled` ⋈ `tools`
 *     ativa com a key. `tools` não tem RLS (as globais são de todos), então o filtro
 *     é explícito: `workspace_id IS NULL OR = ws`, e a custom do workspace vence a
 *     global de mesma key — a MESMA resolução que o worker usa para montar o request
 *     (`apps/workers/src/agents/tools.ts#loadAgentToolRows`). Uma tool custom de OUTRO
 *     workspace com a mesma key nunca é vista, nem se um `agent_tools` torto apontar
 *     para ela. `agent_tools` isola por `agents` (RLS): agente de outro workspace
 *     não enxerga vínculo nenhum.
 *  2. Recusada, a linha de `tools` que vale para o workspace (se existir) vai para o
 *     log da recusa.
 *  3. **A execução é deste agente?** `envelope.execution_id` é o `agent_executions.id`
 *     criado pelo worker antes de chamar o runtime (F70-S15). A linha tem de existir
 *     sob a RLS, estar `running`, ser do mesmo agente e da mesma conversa do envelope.
 *     Isso amarra a identidade da chamada à execução real, não a campos soltos.
 *
 * A identidade (workspace/agente/execução/conversa) vem do envelope que o runtime
 * monta do seu próprio state — nunca de `args`, que é o que o modelo controla.
 *
 * O resultado também devolve o `tools.id` vencedor: é ele que o `tool_logs` usa (a
 * resolução por `key` sozinha podia apontar para a linha de outro workspace).
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import type { ToolCallEnvelope } from './registry';

/** Motivos estáveis de recusa (vão para `tool_logs.error` e para o log estruturado). */
export type ToolCallDenialReason =
  | 'tool_not_found'
  | 'tool_not_enabled'
  | 'execution_not_found'
  | 'execution_mismatch'
  | 'execution_not_running';

export type ToolCallDecision =
  | { readonly allowed: true; readonly toolId: string }
  | {
      readonly allowed: false;
      readonly reason: ToolCallDenialReason;
      /** Linha de `tools` visível ao workspace, se houver (para o log da recusa). */
      readonly toolId: string | null;
    };

/**
 * Decide se a chamada pode executar. `tx` DEVE ser RLS-escopado a
 * `envelope.workspaceId` (`withWorkspace`). Só lê.
 */
export type ToolCallAuthorizer = (
  tx: DbTx,
  toolKey: string,
  envelope: ToolCallEnvelope,
) => Promise<ToolCallDecision>;

/**
 * Linha de `tools` que vale para `(workspace, key)`: ativa, global ou do próprio
 * workspace, com a custom vencendo a global. `null` se não houver.
 */
export async function resolveWorkspaceTool(
  tx: DbTx,
  workspaceId: string,
  toolKey: string,
): Promise<string | null> {
  const { tools } = schema;
  // `ASC` põe NULL por último no Postgres: a custom do workspace vem antes da global.
  const [row] = await tx
    .select({ id: tools.id })
    .from(tools)
    .where(
      and(
        eq(tools.key, toolKey),
        eq(tools.isActive, true),
        or(isNull(tools.workspaceId), eq(tools.workspaceId, workspaceId)),
      ),
    )
    .orderBy(asc(tools.workspaceId), asc(tools.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Linha de `tools` HABILITADA para o agente com esta key — a mesma que o worker
 * mandou no request: `agent_tools` habilitada ⋈ `tools` ativa, global ou do
 * workspace, custom vencendo global (`loadAgentToolRows`). `null` se não houver.
 */
async function resolveEnabledTool(
  tx: DbTx,
  envelope: ToolCallEnvelope,
  toolKey: string,
): Promise<string | null> {
  const { agentTools, tools } = schema;
  const [row] = await tx
    .select({ id: tools.id })
    .from(agentTools)
    .innerJoin(tools, eq(tools.id, agentTools.toolId))
    .where(
      and(
        eq(agentTools.agentId, envelope.agentId),
        eq(agentTools.isEnabled, true),
        eq(tools.key, toolKey),
        eq(tools.isActive, true),
        or(isNull(tools.workspaceId), eq(tools.workspaceId, envelope.workspaceId)),
      ),
    )
    .orderBy(asc(tools.workspaceId), asc(tools.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Authorizer default, contra o banco (vide cabeçalho). */
export const authorizeToolCall: ToolCallAuthorizer = async (tx, toolKey, envelope) => {
  const toolId = await resolveEnabledTool(tx, envelope, toolKey);
  if (toolId === null) {
    // Para o log da recusa: a linha que vale para o workspace, se existir.
    const visible = await resolveWorkspaceTool(tx, envelope.workspaceId, toolKey);
    return visible === null
      ? { allowed: false, reason: 'tool_not_found', toolId: null }
      : { allowed: false, reason: 'tool_not_enabled', toolId: visible };
  }

  const { agentExecutions } = schema;
  const [execution] = await tx
    .select({
      agentId: agentExecutions.agentId,
      conversationId: agentExecutions.conversationId,
      status: agentExecutions.status,
    })
    .from(agentExecutions)
    .where(eq(agentExecutions.id, envelope.executionId))
    .limit(1);
  if (execution === undefined) {
    return { allowed: false, reason: 'execution_not_found', toolId };
  }
  if (
    execution.agentId !== envelope.agentId ||
    (execution.conversationId ?? null) !== envelope.conversationId
  ) {
    return { allowed: false, reason: 'execution_mismatch', toolId };
  }
  if (execution.status !== 'running') {
    return { allowed: false, reason: 'execution_not_running', toolId };
  }
  return { allowed: true, toolId };
};

/**
 * Grava a recusa em `tool_logs` (mesma transação RLS). Só quando há uma linha de
 * `tools` visível ao workspace (a FK é NOT NULL). `agent_id`/`conversation_id` só
 * entram se forem visíveis sob a RLS: as FKs não passam pela RLS, e um envelope com
 * ids de outro workspace não pode virar referência cruzada no log.
 */
export async function writeDenialLog(
  tx: DbTx,
  params: {
    readonly toolId: string;
    readonly toolKey: string;
    readonly envelope: ToolCallEnvelope;
    readonly reason: ToolCallDenialReason;
  },
): Promise<void> {
  const { toolId, toolKey, envelope, reason } = params;
  const { agents, conversations, toolLogs } = schema;

  const [agent] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, envelope.agentId))
    .limit(1);
  let conversationId: string | null = null;
  if (envelope.conversationId !== null) {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, envelope.conversationId))
      .limit(1);
    conversationId = conv?.id ?? null;
  }

  await tx.insert(toolLogs).values({
    workspaceId: envelope.workspaceId,
    agentId: agent?.id ?? null,
    toolId,
    conversationId,
    executionId: envelope.executionId,
    action: 'denied',
    // Os args não são registrados: a chamada não executou e o conteúdo é do modelo.
    params: { tool: toolKey },
    result: null,
    error: reason,
    durationMs: 0,
  });
}
