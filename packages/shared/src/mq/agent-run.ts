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
 *
 * ## Id estável do gatilho (F70-S26)
 *
 * A outbox entrega pelo menos uma vez: o relay que cai entre publicar e marcar a linha
 * como enviada republica o MESMO envelope, e a ladder de retry reentrega o envelope de um
 * turno que lançou. Cada gatilho carrega `triggerId`, uma chave derivada do FATO que o
 * motivou (não da gravação), e o worker reivindica o turno por ela antes de chamar o
 * runtime (`agent_executions.trigger_id`, índice único por workspace). Mesmo fato → mesma
 * chave, inclusive se o produtor o gravar duas vezes; fatos diferentes → chaves
 * diferentes. As derivações vivem em {@link agentRunTriggerId}, uma por produtor.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CHANNEL_PROVIDERS } from '../index';
import { makeEnvelope } from './envelope';
import { queueJobOutbox, type OutboxMessage } from './outbox';
import { QUEUES } from './topology';

/** `type` do envelope (o worker de agentes filtra por ele). */
export const AGENT_RUN_REQUESTED_TYPE = 'flow.run.requested' as const;

/** Teto do `triggerId` no contrato (a coluna tem o mesmo CHECK, migração 0092). */
export const AGENT_RUN_TRIGGER_ID_MAX = 256;

/**
 * Acima disto a chave vira `<tipo>:sha256:<hex>` (a parte variável do inbound é o id do
 * provider, de tamanho que não controlamos). Abaixo, fica legível para quem investiga.
 */
const TRIGGER_ID_READABLE_MAX = 200;

function boundTriggerId(raw: string): string {
  if (raw.length <= TRIGGER_ID_READABLE_MAX) return raw;
  const kind = raw.slice(0, raw.indexOf(':'));
  return `${kind}:sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

/**
 * Derivação do id estável por gatilho. Cada uma usa só o que existe na transação do
 * produtor e identifica o fato, não a gravação:
 *
 * - `inbound`: conversa + `external_id` da mensagem do contato que motivou o turno.
 *   `(conversation_id, external_id)` é único em `messages` (`uq_messages_external`), então
 *   equivale ao id da mensagem, e já existe nos envelopes antigos em voo.
 * - `reengagement`: conversa + janela (`windowBucket`, epoch-seg da âncora da pausa). É a
 *   mesma chave da marca Redis do reengajamento: uma retomada por janela.
 * - `followup`: conversa + janela (`windowBucket`, epoch-seg da última mensagem). O
 *   follow-up tem um passo só por janela (não há sequência); se ganhar passos, o passo
 *   entra na chave.
 * - `agentSwitch`: conversa + `ai_enabled_at` em microssegundos, gravado pelo mesmo UPDATE
 *   que liga a IA (`clock_timestamp()`). Cada troca manual é um fato novo.
 * - `transfer`: execução do agente que chamou a tool + agente de destino. O envelope do
 *   endpoint de tools não traz o id da tool call; repetir a mesma transferência na mesma
 *   execução (retry HTTP do runtime) é o mesmo fato e não pode gerar dois turnos.
 * - `event`: o id do envelope. Só para envelopes antigos, gravados antes da F70-S26 sem
 *   `triggerId` nem `triggerExternalId`. O relay republica a linha com o mesmo id, então
 *   ainda cobre a republicação.
 */
export const agentRunTriggerId = {
  inbound: (conversationId: string, externalId: string): string =>
    boundTriggerId(`inbound:${conversationId}:${externalId}`),
  reengagement: (conversationId: string, windowBucket: number): string =>
    boundTriggerId(`reengagement:${conversationId}:${windowBucket}`),
  followup: (conversationId: string, windowBucket: number): string =>
    boundTriggerId(`followup:${conversationId}:${windowBucket}`),
  agentSwitch: (conversationId: string, aiEnabledAtMicros: string): string =>
    boundTriggerId(`agent-switch:${conversationId}:${aiEnabledAtMicros}`),
  transfer: (executionId: string, targetAgentId: string): string =>
    boundTriggerId(`transfer:${executionId}:${targetAgentId}`),
  event: (envelopeId: string): string => boundTriggerId(`event:${envelopeId}`),
} as const;

/**
 * Payload do gatilho. `workspaceId` vai no envelope. `triggerExternalId` é a mensagem
 * inbound que motivou o turno; ausente nos gatilhos proativos (troca de agente,
 * transferência, retomada, follow-up). `triggerId` é o id estável do gatilho (F70-S26):
 * todo envelope gravado por {@link agentRunJobOutbox} o carrega.
 *
 * O produtor valida com uuid (os ids vêm do banco); o consumidor aceita qualquer id não
 * vazio e `triggerId` ausente, para não descartar envelopes antigos em voo.
 */
export const agentRunRequestedPayloadSchema = z
  .object({
    conversationId: z.string().uuid(),
    contactId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.enum(CHANNEL_PROVIDERS),
    triggerExternalId: z.string().min(1).optional(),
    triggerId: z.string().min(1).max(AGENT_RUN_TRIGGER_ID_MAX).optional(),
  })
  .strict();

export type AgentRunRequestedPayload = z.infer<typeof agentRunRequestedPayloadSchema>;

/**
 * Id do turno para um payload recebido: o `triggerId` do envelope; senão (envelope antigo)
 * o do inbound, derivado de `triggerExternalId`; senão o id do envelope. É a MESMA
 * derivação do produtor, então o envelope antigo e o novo do mesmo fato colidem.
 */
export function resolveAgentRunTriggerId(
  payload: {
    readonly conversationId: string;
    readonly triggerExternalId?: string | undefined;
    readonly triggerId?: string | undefined;
  },
  envelopeId: string,
): string {
  if (payload.triggerId !== undefined) return payload.triggerId;
  if (payload.triggerExternalId !== undefined) {
    return agentRunTriggerId.inbound(payload.conversationId, payload.triggerExternalId);
  }
  return agentRunTriggerId.event(envelopeId);
}

/**
 * Gatilho de turno → mensagem da outbox (`hm.q.flows`, exchange padrão). Lança se o
 * payload viola o contrato: é defeito do produtor, e a transação que o motiva deve cair
 * junto em vez de gravar um gatilho que o worker descartaria.
 *
 * `triggerId` é obrigatório no gatilho proativo. No inbound pode vir omitido: sai de
 * `triggerExternalId` ({@link agentRunTriggerId}.inbound). Gatilho sem nenhum dos dois
 * lança: não há fato que identifique o turno.
 */
export function agentRunJobOutbox(
  workspaceId: string,
  payload: AgentRunRequestedPayload,
): OutboxMessage {
  const parsed = agentRunRequestedPayloadSchema.parse(payload);
  let triggerId = parsed.triggerId;
  if (triggerId === undefined && parsed.triggerExternalId !== undefined) {
    triggerId = agentRunTriggerId.inbound(parsed.conversationId, parsed.triggerExternalId);
  }
  if (triggerId === undefined) {
    throw new Error(
      'agent-run: gatilho sem triggerId nem triggerExternalId; o produtor identifica o fato com agentRunTriggerId.',
    );
  }
  return queueJobOutbox(
    QUEUES.flows,
    makeEnvelope(AGENT_RUN_REQUESTED_TYPE, workspaceId, { ...parsed, triggerId }),
  );
}
