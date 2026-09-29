/**
 * Respostas rápidas da cadência no inbound (F70-S34).
 *
 * Roda DENTRO da transação da persistência (`db-ports.ts`), para que o significado do
 * clique, a reabertura e o gatilho do agente commitem juntos com a mensagem:
 *
 *  1. {@link annotateQuickReplies}: antes do INSERT, cada mensagem do contato ganha em
 *     `metadata.quickReply` o que ela significa (`intent`), pela regra única da
 *     `@hm/flow-engine` (`classifyQuickReply`). É esse campo que o ponto de envio do flow
 *     e o port que liga a IA leem depois ("o contato recusou?").
 *  2. {@link reopenForQuickReply}: "Quero seguir" / "Quero retomar" / "Quero a prévia"
 *     reabrem a conversa. A IA só volta pela trava de origem do workspace
 *     (`aiOriginGateSql`, F70-S30, a mesma fonte única de todo caminho automático), e só
 *     se nenhum humano estiver com a conversa. Sem isso, a conversa reabre para o humano e
 *     a IA fica como estava.
 *
 * "Agora não" não tem passo aqui além da anotação: o gatilho do agente não nasce (o
 * chamador confere a intenção) e as automações leem a recusa gravada na mensagem.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import {
  aiOriginGateSql,
  classifyQuickReply,
  QUICK_REPLY_METADATA_KEY,
  type QuickReplyIntent,
} from '@hm/flow-engine';
import type { InboundEvent } from '@hm/channels';

type InboundMessageEvent = Extract<InboundEvent, { type: 'message' }>;

const { conversations, messages } = schema;

/** Eventos anotados + a intenção de cada um (por `externalId`). */
export interface AnnotatedQuickReplies {
  readonly events: readonly InboundMessageEvent[];
  intentOf(externalId: string): QuickReplyIntent | null;
}

/**
 * A última mensagem ENVIADA na conversa é um modelo? Decide se um texto digitado igual ao
 * do botão conta como resposta rápida (ver `classifyQuickReply`).
 */
async function lastOutboundIsTemplate(tx: DbTx, conversationId: string): Promise<boolean> {
  const [row] = await tx
    .select({ type: messages.type })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'outbound'),
        sql`${messages.deletedAt} is null`,
      ),
    )
    .orderBy(sql`coalesce(${messages.providerTimestamp}, ${messages.createdAt}) desc`)
    .limit(1);
  return row?.type === 'template';
}

/**
 * Classifica as mensagens do contato e grava o significado no metadata. A consulta ao
 * banco (última mensagem enviada) só acontece quando um texto digitado casou, e no máximo
 * uma vez por requisição.
 */
export async function annotateQuickReplies(
  tx: DbTx,
  conversationId: string,
  events: readonly InboundMessageEvent[],
): Promise<AnnotatedQuickReplies> {
  let template: Promise<boolean> | undefined;
  const repliesToTemplate = (): Promise<boolean> =>
    (template ??= lastOutboundIsTemplate(tx, conversationId));

  const intents = new Map<string, QuickReplyIntent>();
  const annotated: InboundMessageEvent[] = [];
  for (const event of events) {
    const record = await classifyQuickReply({
      click: event.metadata?.[QUICK_REPLY_METADATA_KEY],
      text: event.content,
      repliesToTemplate,
    });
    if (record === null) {
      annotated.push(event);
      continue;
    }
    intents.set(event.externalId, record.intent);
    annotated.push({
      ...event,
      metadata: { ...(event.metadata ?? {}), [QUICK_REPLY_METADATA_KEY]: record },
    });
  }
  return {
    events: annotated,
    intentOf: (externalId) => intents.get(externalId) ?? null,
  };
}

/** Por que a IA não voltou (ou voltou) com o "Quero…". */
export type QuickReplyAiOutcome =
  /** Ligada agora (trava de origem passou, ninguém humano com a conversa). */
  | 'reopened'
  /** Já estava ligada: o turno do agente segue o caminho normal do inbound. */
  | 'already_on'
  /** Um humano está com a conversa (IA pausada, ou transferida e aguardando humano). */
  | 'human_hold'
  /** Conversa sem agente de IA: não há quem religar. */
  | 'no_agent'
  /** Trava de origem do workspace (F70-S30) recusou: a conversa fica para o humano. */
  | 'origin_not_eligible'
  /** A conversa não está visível no escopo (não deveria acontecer dentro do inbound). */
  | 'conversation_not_found';

export interface QuickReplyReopenOutcome {
  readonly ai: QuickReplyAiOutcome;
  /** A conversa estava resolvida/fechada e voltou para `open`. */
  readonly statusReopened: boolean;
}

/** Status de onde "Quero…" traz a conversa de volta para a fila. */
const REOPENABLE_STATUSES = ['resolved', 'closed'] as const;

/**
 * "Quero…": reabre a conversa. Trava a linha (`FOR NO KEY UPDATE`) e decide:
 *
 *  - `ai_mode = 'on'` → nada a ligar;
 *  - `paused` (humano assumiu) ou `status = 'pending'` (transferida para humano) → não
 *    liga: a marca humana manda;
 *  - sem `agent_id` → não liga;
 *  - senão, liga SÓ se `aiOriginGateSql()` passar — repetido no WHERE do UPDATE como
 *    defesa em profundidade. O `on` automático é carimbado pelo trigger da F70-S19
 *    (`ai_auto_enabled_at`), então nunca vira marca humana.
 *
 * Em qualquer caso, conversa `resolved`/`closed` volta para `open`: o contato pediu para
 * seguir, e quem vai responder (IA ou humano) precisa vê-la na fila.
 */
export async function reopenForQuickReply(
  tx: DbTx,
  conversationId: string,
): Promise<QuickReplyReopenOutcome> {
  const byId = eq(conversations.id, conversationId);
  const [state] = await tx
    .select({
      aiMode: conversations.aiMode,
      agentId: conversations.agentId,
      status: conversations.status,
      passesOrigin: aiOriginGateSql(),
    })
    .from(conversations)
    .where(byId)
    .limit(1)
    .for('no key update');
  if (state === undefined) return { ai: 'conversation_not_found', statusReopened: false };

  let ai: QuickReplyAiOutcome;
  if (state.aiMode === 'on') ai = 'already_on';
  else if (state.aiMode === 'paused' || state.status === 'pending') ai = 'human_hold';
  else if (state.agentId === null) ai = 'no_agent';
  else if (state.passesOrigin !== true) ai = 'origin_not_eligible';
  else {
    const updated = await tx
      .update(conversations)
      .set({ aiMode: 'on', updatedAt: new Date() })
      .where(and(byId, eq(conversations.aiMode, 'off'), aiOriginGateSql()))
      .returning({ id: conversations.id });
    ai = updated.length > 0 ? 'reopened' : 'origin_not_eligible';
  }

  const reopened = await tx
    .update(conversations)
    .set({ status: 'open', updatedAt: new Date() })
    .where(and(byId, inArray(conversations.status, [...REOPENABLE_STATUSES])))
    .returning({ id: conversations.id });

  return { ai, statusReopened: reopened.length > 0 };
}
