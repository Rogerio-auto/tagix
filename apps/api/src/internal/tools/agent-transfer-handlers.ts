/**
 * Handler Node da tool `transfer_to_agent` (F34-S05 / AGENT_DEPARTMENT_ROUTING_PLAN D3)
 * — transferência autônoma IA→IA.
 *
 * Roda DENTRO do endpoint interno de tools (`POST /internal/tools/:toolKey`),
 * server-to-server por token de runtime — NÃO por membro humano. A salvaguarda do
 * sistema é a **authz de alvo**: o agente atual (`envelope.agentId`) e o
 * `targetAgentId` só podem se transferir se compartilharem ≥1 departamento
 * (`agentDepartmentsRepo.areAgentsInSameDepartment`). NÃO confundir com
 * `conversation.assign_agent` (troca manual via cockpit — F34-S04, matriz de roles).
 *
 * Efeito (só se elegível): fixa `conversations.agent_id = targetAgentId` (sticky) na
 * tx RLS e re-engaja a IA enfileirando `flow.run.requested` em `hm.q.flows` (mesmo
 * contrato do inbound). O worker de agentes (F2-S11) resolve o `agent_id` já fixado —
 * o envelope só carrega o gatilho `{ conversationId, contactId, channelId, provider }`.
 *
 * Idempotência: transferir para o agente já atual é no-op gracioso (`ok:true`, sem
 * mutação e sem enqueue).
 *
 * Trava de origem (F70-S08): a transferência é AUTOMÁTICA (decidida pela IA), então
 * não pode LIGAR a IA numa conversa sem origem comprovada. O UPDATE é condicional e
 * atômico: aplica se a origem é elegível (`AI_ELIGIBLE_CONVERSATION_ORIGINS`, a regra
 * do flow `ai_action`) OU se a IA já está `on` (a transferência só troca o agente —
 * a conversa já foi ligada por caminho travado ou à mão por um humano). Uma conversa
 * `off`/`paused` sem origem nunca volta a `on` por aqui: nada muda, nada é
 * enfileirado, o agente recebe a recusa e o evento é logado.
 *
 * Cross-dept / escalonamento (D3): ainda não há flag de config de departamento-destino
 * de escalonamento. Por ora restringimos a same-dept; o gancho cross-dept fica como
 * TODO honesto abaixo, para casar com a evolução do plano sem afrouxar a authz agora.
 *
 * CONTRATO DE ARGS (fonte da verdade para a tool Python da S06):
 *   { targetAgentId: string (uuid), reason?: string (1..500) }
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { and, eq, inArray, or } from 'drizzle-orm';
import { agentDepartmentsRepo, schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import { AI_ELIGIBLE_CONVERSATION_ORIGINS } from '@hm/flow-engine';
import { createLogger, type Logger } from '@hm/logger';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import { CHANNEL_PROVIDERS, type ChannelProvider } from '@hm/shared';
import type { ToolCallEnvelope, ToolHandler, ToolHandlerResult } from './registry';

/** Fila de gatilho de flow/agente (mesma de `apps/api/src/routes/conversations/agent.ts`). */
const FLOWS_QUEUE = 'hm.q.flows' as const;
/** Tipo do envelope de disparo (espelha `INBOUND_FLOW_TYPE` de F1-S26). */
const INBOUND_FLOW_TYPE = 'flow.run.requested' as const;

/**
 * Args da tool `transfer_to_agent`. ESTE SHAPE É A FONTE DA VERDADE para a tool
 * Python da S06 — qualquer mudança aqui precisa ser refletida lá.
 */
export const transferToAgentArgs = z.object({
  targetAgentId: z.string().uuid(),
  reason: z.string().min(1).max(500).optional(),
});

export type TransferToAgentArgs = z.infer<typeof transferToAgentArgs>;

const defaultLogger: Logger = createLogger('info', { svc: '@hm/api', tool: 'transfer_to_agent' });

function fail(error: string): ToolHandlerResult {
  return { ok: false, error };
}

// ── Publisher MQ (canal AMQP lazy, compartilhado por processo) ──────────────────
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

/**
 * Re-engaja a IA enfileirando `flow.run.requested` em `hm.q.flows` — mesmo contrato
 * do inbound (`{ conversationId, contactId, channelId, provider }`). O worker de
 * agentes resolve o `agent_id` já fixado. Best-effort: a transferência já está
 * persistida (commit da tx RLS) quando o gatilho é publicado.
 */
async function enqueueReengage(
  workspaceId: string,
  trigger: {
    conversationId: string;
    contactId: string;
    channelId: string;
    provider: ChannelProvider;
  },
): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope(INBOUND_FLOW_TYPE, workspaceId, {
    conversationId: trigger.conversationId,
    contactId: trigger.contactId,
    channelId: trigger.channelId,
    provider: trigger.provider,
  });
  channel.sendToQueue(FLOWS_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

/**
 * Handler da tool `transfer_to_agent`. Override do publisher de re-engaje via
 * `deps.reengage` para testes (sem AMQP real).
 */
export function makeTransferToAgentHandler(deps?: {
  reengage?: typeof enqueueReengage;
  logger?: Logger;
}): ToolHandler {
  const reengage = deps?.reengage ?? enqueueReengage;
  const logger = deps?.logger ?? defaultLogger;

  return async (env: ToolCallEnvelope, tx: DbTx): Promise<ToolHandlerResult> => {
    const parsed = transferToAgentArgs.safeParse(env.args);
    if (!parsed.success) return fail('Argumentos inválidos para transfer_to_agent.');
    if (!env.conversationId) return fail('Conversa ausente no contexto.');

    const { targetAgentId } = parsed.data;

    // No-op gracioso: transferir para o agente já atual não muta nem re-engaja.
    if (targetAgentId === env.agentId) {
      return {
        ok: true,
        content: 'A conversa já está com o agente de destino. Nenhuma transferência necessária.',
        action: 'transfer_to_agent',
        tableName: 'conversations',
        payload: { noop: true, targetAgentId },
      };
    }

    // ── Authz de ALVO (salvaguarda do sistema) ──────────────────────────────────
    // O agente atual e o alvo precisam compartilhar ≥1 departamento. Sem isso, a
    // transferência é rejeitada SEM efeito.
    //
    // TODO(D3 cross-dept): quando houver flag de departamento-destino de escalonamento,
    // permitir o alvo que atenda esse dept marcado mesmo sem dept em comum. Até lá,
    // restringimos a same-dept para não afrouxar a authz.
    const sameDept = await agentDepartmentsRepo.areAgentsInSameDepartment(
      tx,
      env.agentId,
      targetAgentId,
    );
    if (!sameDept) {
      return fail('Agente de destino não compartilha departamento com o agente atual.');
    }

    // Carrega o gatilho de re-engaje a partir da conversa do contexto.
    const [conversation] = await tx
      .select({
        contactId: schema.conversations.contactId,
        channelId: schema.conversations.channelId,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, env.conversationId))
      .limit(1);
    if (!conversation) return fail('Conversa não encontrada.');

    // Provider do canal — exigido pelo worker de agentes no envelope de re-engaje.
    const [channel] = await tx
      .select({ provider: schema.channels.provider })
      .from(schema.channels)
      .where(eq(schema.channels.id, conversation.channelId))
      .limit(1);

    // ── Efeito: fixa o agente de destino (sticky) e reativa a IA ─────────────────
    const updated = await tx
      .update(schema.conversations)
      .set({
        agentId: targetAgentId,
        // Transferência reativa a IA e limpa qualquer pausa pendente (handoff IA→IA).
        aiMode: 'on',
        aiPausedReason: null,
        aiPausedAt: null,
        aiPausedBy: null,
        aiResumeAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversations.id, env.conversationId),
          // F70-S08 — trava de origem (ver cabeçalho): nunca LIGA a IA sem origem.
          or(
            inArray(schema.conversations.origin, [...AI_ELIGIBLE_CONVERSATION_ORIGINS]),
            eq(schema.conversations.aiMode, 'on'),
          ),
        ),
      )
      .returning({ id: schema.conversations.id });
    if (updated.length === 0) {
      // A conversa existe (lida acima na mesma tx): quem barrou foi a trava.
      logger.warn('transfer_to_agent recusado pela trava de origem da IA', {
        workspaceId: env.workspaceId,
        conversationId: env.conversationId,
        fromAgentId: env.agentId,
        targetAgentId,
        reason: 'origin_not_eligible',
      });
      return fail(
        'Transferência recusada: esta conversa não tem origem comprovada para atendimento automático.',
      );
    }

    // Re-engaje só dispara com gatilho válido (contato + provider conhecidos).
    const provider = channel?.provider ?? null;
    const canReengage =
      conversation.contactId !== null &&
      provider !== null &&
      (CHANNEL_PROVIDERS as readonly string[]).includes(provider);

    if (canReengage) {
      await reengage(env.workspaceId, {
        conversationId: env.conversationId,
        contactId: conversation.contactId!,
        channelId: conversation.channelId,
        provider: provider as ChannelProvider,
      });
    }

    return {
      ok: true,
      content: 'Conversa transferida para o agente de destino. Pare de responder.',
      action: 'transfer_to_agent',
      tableName: 'conversations',
      payload: { targetAgentId, reengaged: canReengage },
    };
  };
}

/** Handler default (publisher AMQP real) registrado no registry de produção. */
export const transferToAgent: ToolHandler = makeTransferToAgentHandler();
