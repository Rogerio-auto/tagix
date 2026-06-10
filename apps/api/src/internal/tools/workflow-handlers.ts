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
 *  - register_conversion → respeita `allow_agent_conversions`; registra de verdade via o
 *    serviço de conversões (F5-S12). Fecha o stub-até-F5 de F2-S20.
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
import { registerConversion as registerConversionEvent } from '../../routes/conversions';
import { moveDealToStage, TransitionError } from '../../routes/deals';
import { and, desc, isNull } from 'drizzle-orm';

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

const registerConversionArgs = z.object({
  conversion_type_key: z.string().min(1).max(64),
  value_cents: z.number().int().min(0).nullish(),
  note: z.string().max(1000).nullish(),
  contact_id: z.string().uuid().nullish(),
});

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

  const parsed = registerConversionArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para register_conversion.');

  // Resolve o contato: explícito nos args ou a partir da conversa do contexto.
  let contactId = parsed.data.contact_id ?? null;
  if (!contactId && env.conversationId) {
    const [conv] = await tx
      .select({ contactId: schema.conversations.contactId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, env.conversationId))
      .limit(1);
    contactId = conv?.contactId ?? null;
  }
  if (!contactId) return fail('Contato ausente no contexto da conversão.');

  // Registra via o serviço único de conversões (F5-S12). source='agent_tool'.
  const result = await registerConversionEvent(tx, {
    workspaceId: env.workspaceId,
    conversionTypeKey: parsed.data.conversion_type_key,
    contactId,
    conversationId: env.conversationId,
    valueCents: parsed.data.value_cents ?? null,
    note: parsed.data.note ?? null,
    source: 'agent_tool',
    triggeredByAgentId: env.agentId,
  });

  switch (result.kind) {
    case 'created':
      return {
        ok: true,
        content: `Conversão '${parsed.data.conversion_type_key}' registrada.`,
        action: 'register_conversion',
        tableName: 'conversion_events',
        payload: { conversionEventId: result.event.id },
      };
    case 'deduped':
      return {
        ok: true,
        content: `Conversão '${parsed.data.conversion_type_key}' já registrada hoje para este contato.`,
        action: 'register_conversion',
        tableName: 'conversion_events',
        payload: { deduped: true },
      };
    case 'type_not_found':
      return fail(`Tipo de conversão '${parsed.data.conversion_type_key}' não existe.`);
    case 'value_required':
      return fail('Este tipo de conversão exige um valor.');
  }
};

const moveDealStageArgs = z.object({
  stage_id: z.string().uuid(),
  deal_id: z.string().uuid().nullish(),
});

const moveDealStage: ToolHandler = async (env, tx) => {
  const parsed = moveDealStageArgs.safeParse(env.args);
  if (!parsed.success) return fail('Argumentos inválidos para move_deal_stage.');

  // Resolve o deal: explícito ou o deal aberto mais recente do contato da conversa.
  let dealId = parsed.data.deal_id ?? null;
  if (!dealId) {
    if (!env.conversationId) return fail('Conversa ausente no contexto.');
    const [conv] = await tx
      .select({ contactId: schema.conversations.contactId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, env.conversationId))
      .limit(1);
    if (!conv?.contactId) return fail('Contato ausente no contexto.');
    const [deal] = await tx
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(and(eq(schema.deals.contactId, conv.contactId), isNull(schema.deals.closedAt)))
      .orderBy(desc(schema.deals.createdAt))
      .limit(1);
    if (!deal) return fail('Contato sem negócio aberto.');
    dealId = deal.id;
  }

  try {
    const result = await moveDealToStage(tx, {
      dealId,
      newStageId: parsed.data.stage_id,
      actor: { type: 'agent' },
      workspaceId: env.workspaceId,
    });
    return {
      ok: true,
      content: 'Negócio movido de estágio.',
      action: 'move_deal_stage',
      tableName: 'deals',
      payload: {
        dealId: result.deal.id,
        fromStageId: result.fromStageId,
        toStageId: result.toStageId,
      },
    };
  } catch (err: unknown) {
    if (err instanceof TransitionError) return fail(err.message);
    if (err instanceof Error && (err.message === 'deal_not_found' || err.message === 'stage_not_found')) {
      return fail('Negócio ou estágio não encontrado.');
    }
    throw err;
  }
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
    .register('register_conversion', registerConversion)
    .register('move_deal_stage', moveDealStage);
}
