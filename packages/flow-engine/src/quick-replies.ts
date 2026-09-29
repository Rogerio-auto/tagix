/**
 * Respostas rápidas da cadência (F70-S34) — fonte única de "o que o contato respondeu".
 *
 * Os modelos de Marketing da cadência (F70-S06) têm duas respostas rápidas cada:
 * "Quero seguir" / "Quero retomar" / "Quero a prévia" (**reabrir**) e "Agora não"
 * (**recusar**). Este módulo responde três perguntas, e só ele:
 *
 *  1. **O clique/texto significa o quê?** ({@link matchQuickReply}, puro). Pelo `payload`
 *     do botão quando existir e for conhecido; senão pelo texto normalizado (sem acento,
 *     minúsculas, espaços colapsados, pontuação das pontas removida). Igualdade exata, nunca
 *     "contém": "agora não posso, me chama amanhã" não é recusa.
 *  2. **Conta como resposta rápida?** ({@link classifyQuickReply}, puro). Clique (modelo ou
 *     interativa) conta sempre. Texto DIGITADO igual ao do botão conta só quando responde a
 *     um modelo — a última mensagem enviada na conversa é um `template`. Assim "agora não"
 *     digitado no meio de um papo com a IA ("quer agendar agora?") não encerra nada.
 *  3. **O contato recusou a automação?** ({@link contactDeclinedSql} /
 *     {@link hasContactDeclined}). Sim quando a ÚLTIMA mensagem do contato na conversa é
 *     uma recusa. É estado derivado, não flag: não há o que limpar, é idempotente por
 *     construção e se desfaz sozinho quando o contato volta a escrever. Consultado:
 *       - no ponto de envio do flow (`apps/workers/src/flows/outbound-publisher.ts`):
 *         nenhuma mensagem de flow sai; a execução é CANCELADA
 *         (`FlowSendSuppressedError`, `send-suppressed.ts`, tratado no dispatcher). Vale para o lembrete que
 *         já estava agendado quando a recusa chegou;
 *       - no port que liga a IA automaticamente (`ports/outbound.port.ts`): flow
 *         `ai_action` e handoff de campanha não ligam a IA depois de "Agora não".
 *
 * O significado fica gravado na própria mensagem, em `messages.metadata.quickReply.intent`
 * (o inbound grava na inserção). O predicado SQL lê só isso.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DbTx } from '@hm/db';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const { conversations, messages } = schema;

/** O que uma resposta rápida pede. */
export const QUICK_REPLY_INTENTS = ['reopen', 'decline'] as const;
export type QuickReplyIntent = (typeof QUICK_REPLY_INTENTS)[number];

/** Chave em `messages.metadata` onde o clique (e o significado) ficam. */
export const QUICK_REPLY_METADATA_KEY = 'quickReply' as const;

/**
 * Textos dos botões dos modelos aprovados (29/09), já normalizados. A tabela é a lista
 * fechada: botão novo nos modelos = linha nova aqui (e teste).
 */
const QUICK_REPLY_TEXTS: ReadonlyMap<string, QuickReplyIntent> = new Map([
  ['quero seguir', 'reopen'], // arcada_lembrete_dia_3
  ['quero retomar', 'reopen'], // arcada_lembrete_dia_7
  ['quero a previa', 'reopen'], // arcada_toque_30_dias
  ['agora nao', 'decline'], // os três
]);

/**
 * Payloads canônicos, para quando o envio do modelo passar `payload` próprio no componente
 * `button`. Sem isso a Meta devolve o texto do botão como payload, que cai na tabela acima.
 */
const QUICK_REPLY_PAYLOADS: ReadonlyMap<string, QuickReplyIntent> = new Map([
  ['cadence.reopen', 'reopen'],
  ['cadence.decline', 'decline'],
]);

/** Pontuação/símbolos que o contato (ou o teclado) põe nas pontas: "Agora não." "agora não!" */
const EDGE_NOISE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;

/** Sem acento, minúsculas, espaços colapsados, sem pontuação/emoji nas pontas. */
export function normalizeQuickReplyText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(EDGE_NOISE, '')
    .trim();
}

/** Casamento de um botão/texto com uma intenção. */
export interface QuickReplyMatch {
  readonly intent: QuickReplyIntent;
  /** O que decidiu: o `payload` do botão ou o texto. */
  readonly via: 'payload' | 'text';
}

/**
 * Decide a intenção pelo `payload` (quando existir e for conhecido) e, na falta dele, pelo
 * texto. Payload desconhecido cai para o texto: o botão de outro modelo com o texto "Agora
 * não" continua sendo o contato dizendo "agora não".
 */
export function matchQuickReply(input: {
  readonly payload?: string | null;
  readonly text?: string | null;
}): QuickReplyMatch | null {
  if (input.payload !== undefined && input.payload !== null && input.payload !== '') {
    const p = normalizeQuickReplyText(input.payload);
    const byPayload = QUICK_REPLY_PAYLOADS.get(p) ?? QUICK_REPLY_TEXTS.get(p);
    if (byPayload !== undefined) return { intent: byPayload, via: 'payload' };
  }
  if (input.text === undefined || input.text === null) return null;
  const byText = QUICK_REPLY_TEXTS.get(normalizeQuickReplyText(input.text));
  return byText === undefined ? null : { intent: byText, via: 'text' };
}

/** Clique cru gravado pelo parser do canal (`@hm/channels`, `metadata.quickReply`). */
export const quickReplyClickSchema = z.object({
  source: z.enum(['button', 'interactive']),
  text: z.string().min(1),
  payload: z.string().min(1).optional(),
});
export type QuickReplyClick = z.infer<typeof quickReplyClickSchema>;

/** O que o inbound grava em `metadata.quickReply` de uma resposta rápida reconhecida. */
export interface QuickReplyRecord {
  /** `typed` = o contato digitou o texto do botão em resposta a um modelo. */
  readonly source: 'button' | 'interactive' | 'typed';
  readonly text: string;
  readonly payload?: string;
  readonly intent: QuickReplyIntent;
  readonly via: 'payload' | 'text';
}

/** Entrada da classificação de UMA mensagem do contato. */
export interface QuickReplyInput {
  /** `metadata.quickReply` cru do parser (desconhecido: validado aqui). */
  readonly click: unknown;
  /** Texto da mensagem. */
  readonly text: string | null | undefined;
  /**
   * A última mensagem ENVIADA na conversa é um modelo? Só pesa para texto digitado. Função
   * para o chamador só ir ao banco quando o texto casou.
   */
  readonly repliesToTemplate: () => Promise<boolean>;
}

/**
 * Classifica uma mensagem do contato. Clique reconhecido → registro com a intenção. Clique
 * não reconhecido → `null` (o clique cru continua no metadata, só não tem significado aqui).
 * Texto digitado → só quando responde a um modelo.
 */
export async function classifyQuickReply(input: QuickReplyInput): Promise<QuickReplyRecord | null> {
  const click = quickReplyClickSchema.safeParse(input.click);
  if (click.success) {
    const match = matchQuickReply({ payload: click.data.payload, text: click.data.text });
    if (match === null) return null;
    return {
      source: click.data.source,
      text: click.data.text,
      ...(click.data.payload !== undefined ? { payload: click.data.payload } : {}),
      ...match,
    };
  }
  const text = input.text;
  if (text === null || text === undefined) return null;
  const match = matchQuickReply({ text });
  if (match === null) return null;
  if (!(await input.repliesToTemplate())) return null;
  return { source: 'typed', text, ...match };
}

/**
 * A última mensagem do contato na conversa é uma recusa ("Agora não")? Predicado SQL para
 * usar em WHERE/SELECT (`conversationId` é uma coluna ou um valor). Sempre booleano:
 * conversa sem mensagem do contato = `false`.
 *
 * Ordem: `coalesce(provider_timestamp, created_at)` — a mesma da timeline, servida pelo
 * índice `idx_messages_conversation_provider_ts`.
 *
 * O subselect vai ANINHADO num `sql` externo de propósito: num SELECT de tabela única o
 * Drizzle tira a qualificação das colunas que estão no primeiro nível de um campo `sql`, e
 * `"conversation_id" = "id"` passaria a comparar com `messages.id` (sempre falso).
 */
export function contactDeclinedSql(conversationId: SQL | AnyPgColumn | string): SQL<boolean> {
  const latestIsDecline = sql`(
    select (${messages.metadata} -> ${QUICK_REPLY_METADATA_KEY} ->> 'intent') = 'decline'
    from ${messages}
    where ${messages.conversationId} = ${conversationId}
      and ${messages.direction} = 'inbound'
      and ${messages.senderType} = 'contact'
      and ${messages.deletedAt} is null
    order by coalesce(${messages.providerTimestamp}, ${messages.createdAt}) desc,
             ${messages.createdAt} desc
    limit 1
  )`;
  return sql<boolean>`coalesce(${latestIsDecline}, false)`;
}

/**
 * {@link contactDeclinedSql} numa leitura, dentro da transação do chamador (e da RLS dela).
 * Conversa invisível ou inexistente = `false`: quem decide o que fazer com ela é o chamador.
 */
export async function hasContactDeclined(tx: DbTx, conversationId: string): Promise<boolean> {
  const [row] = await tx
    .select({ declined: contactDeclinedSql(conversations.id) })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row?.declined === true;
}
