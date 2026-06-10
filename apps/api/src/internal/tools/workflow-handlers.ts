/**
 * Handlers Node das workflow tools (F2-S20) — registrados no endpoint interno
 * `POST /internal/tools/:toolKey` (F2-S07). Cada handler roda DENTRO de
 * `withWorkspace(workspaceId, tx)` (RLS já escopada) e devolve `ToolHandlerResult`.
 *
 * Gap-fill de orquestração: o slot F2-S20 (Python) só pode declarar os tools +
 * contrato; a execução de domínio (mutação de `conversations`, checagem de policy)
 * é Node e mora aqui.
 *
 * Cobertura desta fase:
 *  - transfer_to_human / mark_resolved / change_conversation_status → mutam `conversations`.
 *  - escalate → registrado em `tool_logs` (sem tabela de notificações ainda; auditável).
 *  - register_conversion → respeita `allow_agent_conversions`; conversões reais chegam em F5.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import {
  createDefaultRegistry,
  type ToolCallEnvelope,
  type ToolHandler,
  type ToolHandlerResult,
  type ToolHandlerRegistry,
} from './registry';
import type { DbTx } from '@hm/db';

function fail(error: string): ToolHandlerResult {
  return { ok: false, error };
}

/** Aplica um `patch` em `conversations` pelo id do envelope (RLS já no `tx`). */
async function patchConversation(
  tx: DbTx,
  env: ToolCallEnvelope,
  patch: Partial<typeof schema.conversations.$inferInsert>,
): Promise<boolean> {
  if (!env.conversationId) return false;
  const rows = await tx
    .update(schema.conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.conversations.id, env.conversationId))
    .returning({ id: schema.conversations.id });
  return rows.length > 0;
}

const transferArgs = z.object({
  reason: z.string().min(1).max(500),
  department_id: z.string().uuid().nullish(),
});

const transferToHuman: ToolHandler = async (env, tx) => {
  const parsed = transferArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para transfer_to_human.');
  if (!env.conversationId) return fail('Conversa ausente no contexto.');
  const ok = await patchConversation(tx, env, {
    aiMode: 'off',
    status: 'pending',
    ...(parsed.data.department_id ? { departmentId: parsed.data.department_id } : {}),
  });
  if (!ok) return fail('Conversa não encontrada.');
  return {
    ok: true,
    content: 'Conversa transferida para atendimento humano. Pare de responder.',
    action: 'transfer_to_human',
    tableName: 'conversations',
    payload: { aiMode: 'off', status: 'pending' },
  };
};

const escalateArgs = z.object({
  reason: z.string().min(1).max(500),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
});

const escalate: ToolHandler = async (env) => {
  const parsed = escalateArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para escalate.');
  // Sem tabela de notificações ainda — a escalada fica auditada em `tool_logs`
  // (params/result), e o agente continua atendendo. Notificação real: fase futura.
  return {
    ok: true,
    content: 'Escalada registrada para um supervisor. Continue atendendo.',
    action: 'escalate',
    payload: { severity: parsed.data.severity },
  };
};

const markResolvedArgs = z.object({ resolution: z.string().min(1).max(1000) });

const markResolved: ToolHandler = async (env, tx) => {
  const parsed = markResolvedArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para mark_resolved.');
  if (!env.conversationId) return fail('Conversa ausente no contexto.');
  const ok = await patchConversation(tx, env, { status: 'resolved', aiMode: 'off' });
  if (!ok) return fail('Conversa não encontrada.');
  return {
    ok: true,
    content: 'Conversa marcada como resolvida.',
    action: 'mark_resolved',
    tableName: 'conversations',
    payload: { status: 'resolved' },
  };
};

const changeStatusArgs = z.object({
  target_status: z.enum(['open', 'pending', 'resolved', 'closed']),
  note: z.string().max(500).nullish(),
});

const changeConversationStatus: ToolHandler = async (env, tx) => {
  const parsed = changeStatusArgs.safeParse(env.args);
  if (!parsed.success) return fail('Status de destino inválido.');
  if (!env.conversationId) return fail('Conversa ausente no contexto.');
  const ok = await patchConversation(tx, env, { status: parsed.data.target_status });
  if (!ok) return fail('Conversa não encontrada.');
  return {
    ok: true,
    content: `Status da conversa alterado para '${parsed.data.target_status}'.`,
    action: 'change_conversation_status',
    tableName: 'conversations',
    payload: { status: parsed.data.target_status },
  };
};

const registerConversion: ToolHandler = async (env, tx) => {
  // Checagem autoritativa de policy (defense-in-depth do lado Node).
  const [policy] = await tx
    .select({ allow: schema.workspaceAgentPolicies.allowAgentConversions })
    .from(schema.workspaceAgentPolicies)
    .where(eq(schema.workspaceAgentPolicies.workspaceId, env.workspaceId))
    .limit(1);
  if (!policy?.allow) {
    return fail('Registro de conversões desabilitado para este workspace.');
  }
  // O schema de conversões (conversion_events) chega em F5-S13. Até lá, o tool
  // responde explicitamente que ainda não é suportado (o callback já ocorreu).
  return fail('Registro de conversões ainda não suportado (chega na fase F5).');
};

/**
 * Registry do endpoint interno já com os handlers de workflow (F2-S20) + o `ping`
 * embutido (F2-S07). É o registry que o `app.ts` injeta em `createInternalToolsRouter`.
 */
export function buildWorkflowRegistry(): ToolHandlerRegistry {
  return createDefaultRegistry()
    .register('transfer_to_human', transferToHuman)
    .register('escalate', escalate)
    .register('mark_resolved', markResolved)
    .register('change_conversation_status', changeConversationStatus)
    .register('register_conversion', registerConversion);
}
