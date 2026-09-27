/**
 * Outbound port. As mutacoes de conversa (ai_mode/status) sao DB puro sob RLS — a engine
 * as possui. Ja sendMessage/sendPresence dependem do pipeline de envio: recebem um
 * `OutboundPublisher` injetado.
 *
 * F31-S01: em PRODUCAO o worker de flows injeta um publisher real
 * (`apps/workers/src/flows/outbound-publisher.ts`) que persiste a message `pending` sob
 * RLS, resolve midia via storage e enfileira o `OutboundJob` em `hm.q.outbound` — ou seja,
 * um flow agora ENVIA mensagem de verdade. O `noopPublisher` continua sendo o default
 * (engine pura / testes / API sem worker): mantem o contrato estavel sem acoplar a engine
 * ao transporte de mensagens.
 */
import { and, eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { aiOriginGateSql } from '../ai-origin-gate';
import type { FlowOutboundPort } from '../deps';
import type { FlowOutboundMessage, FlowPresenceAction, SetConversationAiResult } from '../types';

const { conversations } = schema;

export interface OutboundPublisher {
  publishMessage(workspaceId: string, message: FlowOutboundMessage): Promise<void>;
  publishPresence(workspaceId: string, action: FlowPresenceAction): Promise<void>;
}

const noopPublisher: OutboundPublisher = {
  async publishMessage() {
    /* default no-op: substituido pelo worker outbound (F4-S03/S04). */
  },
  async publishPresence() {
    /* default no-op. */
  },
};

export function createOutboundPort(publisher: OutboundPublisher = noopPublisher): FlowOutboundPort {
  return {
    async sendMessage(workspaceId, message) {
      await publisher.publishMessage(workspaceId, message);
    },
    async sendPresence(workspaceId, action) {
      await publisher.publishPresence(workspaceId, action);
    },
    async setConversationAi(workspaceId, input): Promise<SetConversationAiResult> {
      return withWorkspace(workspaceId, async (tx) => {
        const byId = eq(conversations.id, input.conversationId);
        // F70-S07/S30 — trava de origem. Ligar a IA é um UPDATE CONDICIONAL no predicado
        // único da trava (`aiOriginGateSql`): a configuração do workspace e a origem são
        // lidas no próprio UPDATE, atômico (sem janela entre ler e ligar) e fail-closed
        // (trava ligada e origem NULL não passam). Desligar/pausar não tem trava — tirar
        // a IA é sempre seguro.
        const where = input.aiMode === 'on' ? and(byId, aiOriginGateSql()) : byId;
        const updated = await tx
          .update(conversations)
          .set({ aiMode: input.aiMode, agentId: input.agentId ?? null, updatedAt: new Date() })
          .where(where)
          .returning({ id: conversations.id });
        if (updated.length > 0) return { applied: true };

        // Nada atualizado: a conversa não existe (no escopo RLS) ou a origem barrou.
        const [exists] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(byId)
          .limit(1);
        return exists === undefined
          ? { applied: false, reason: 'conversation_not_found' }
          : { applied: false, reason: 'origin_not_eligible' };
      });
    },
    async setConversationStatus(workspaceId, input) {
      await withWorkspace(workspaceId, async (tx) => {
        await tx
          .update(conversations)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(conversations.id, input.conversationId));
      });
    },
  };
}

export const flowOutboundPort: FlowOutboundPort = createOutboundPort();
