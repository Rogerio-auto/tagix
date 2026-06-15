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
import { eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import type { FlowOutboundPort } from '../deps';
import type { FlowOutboundMessage, FlowPresenceAction } from '../types';

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
    async setConversationAi(workspaceId, input) {
      await withWorkspace(workspaceId, async (tx) => {
        await tx
          .update(conversations)
          .set({ aiMode: input.aiMode, agentId: input.agentId ?? null, updatedAt: new Date() })
          .where(eq(conversations.id, input.conversationId));
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
