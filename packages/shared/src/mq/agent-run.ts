/**
 * Gatilho de turno do agente de IA em `hm.q.flows` (F1-S26 → outbox na F70-S25).
 *
 * Um gatilho diz ao worker de agentes: "rode um turno nesta conversa". Quem pode LIGAR a
 * IA não é decidido aqui: o worker relê a conversa sob RLS e só responde com `ai_mode =
 * 'on'` e origem elegível ou marca humana (`authorizeAiReply`, F70-S07/S08/S19). Este
 * módulo só fixa o contrato do envelope e o grava na outbox.
 *
 * Todo produtor grava o gatilho com {@link agentRunJobOutbox} + `enqueueOutbox(tx, …)` NA
 * transação que o motiva (mensagem do contato inserida, troca de agente, transferência,
 * retomada, follow-up). Commit grava os dois; rollback, nenhum. O relay publica depois do
 * commit, com confirms: um processo que cai entre o commit e a publicação não deixa mais
 * mensagem de cliente sem resposta.
 */
import { z } from 'zod';
import { CHANNEL_PROVIDERS } from '../index';
import { makeEnvelope } from './envelope';
import { queueJobOutbox, type OutboxMessage } from './outbox';
import { QUEUES } from './topology';

/** `type` do envelope (o worker de agentes filtra por ele). */
export const AGENT_RUN_REQUESTED_TYPE = 'flow.run.requested' as const;

/**
 * Payload do gatilho. `workspaceId` vai no envelope. `triggerExternalId` é a última
 * mensagem inbound que motivou o turno; ausente nos gatilhos proativos (troca de agente,
 * transferência, retomada, follow-up).
 *
 * O produtor valida com uuid (os ids vêm do banco); o consumidor aceita qualquer id não
 * vazio, para não descartar envelopes antigos em voo.
 */
export const agentRunRequestedPayloadSchema = z
  .object({
    conversationId: z.string().uuid(),
    contactId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.enum(CHANNEL_PROVIDERS),
    triggerExternalId: z.string().min(1).optional(),
  })
  .strict();

export type AgentRunRequestedPayload = z.infer<typeof agentRunRequestedPayloadSchema>;

/**
 * Gatilho de turno → mensagem da outbox (`hm.q.flows`, exchange padrão). Lança se o
 * payload viola o contrato: é defeito do produtor, e a transação que o motiva deve cair
 * junto em vez de gravar um gatilho que o worker descartaria.
 */
export function agentRunJobOutbox(
  workspaceId: string,
  payload: AgentRunRequestedPayload,
): OutboxMessage {
  return queueJobOutbox(
    QUEUES.flows,
    makeEnvelope(
      AGENT_RUN_REQUESTED_TYPE,
      workspaceId,
      agentRunRequestedPayloadSchema.parse(payload),
    ),
  );
}
