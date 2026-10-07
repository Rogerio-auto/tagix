/**
 * Thread de e-mail → conversa existente (F60-S10).
 *
 * A régua: o cliente responde um e-mail de três semanas atrás — trocando o
 * assunto, encaminhando para um colega, respondendo de outro endereço — e a
 * conversa continua de onde parou.
 *
 * O que identifica a thread é o CABEÇALHO (`In-Reply-To`, `References`), nunca o
 * assunto. Cada mensagem de e-mail que persistimos — recebida ou enviada — tem o
 * `Message-ID` em `messages.external_id`; então uma resposta aponta, pelos
 * cabeçalhos, para uma linha que já conhecemos, e a linha diz a conversa.
 *
 * Ordem de preferência quando mais de uma mensagem conhecida aparece na cadeia:
 * `In-Reply-To` (a mensagem respondida, a mais específica) → `References` da
 * mais recente para a mais antiga → a raiz (`threadKeyFrom`). É a mesma ordem em
 * que um cliente de e-mail monta a árvore.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeMessageId, threadKeyFrom } from '@hm/channels';
import { schema, type DbTx } from '@hm/db';

/** Teto de ids consultados. Thread longa infla `References`; as pontas bastam. */
export const MAX_THREAD_CANDIDATES = 25;

export interface ThreadHeaders {
  readonly messageId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}

/**
 * Ids que, se conhecidos, dizem a qual conversa a mensagem pertence — em ordem
 * de preferência, sem repetição e sem o próprio `Message-ID` (a mensagem nova
 * não pode "achar" a si mesma numa reentrega e mascarar a falta de thread).
 */
export function threadCandidates(h: ThreadHeaders): string[] {
  const proprio = normalizeMessageId(h.messageId);
  const ordem: string[] = [];
  const add = (id: string | null | undefined): void => {
    if (id === null || id === undefined) return;
    const n = normalizeMessageId(id);
    if (n.length === 0 || n === proprio || ordem.includes(n)) return;
    ordem.push(n);
  };

  add(h.inReplyTo);
  const refs = [...h.references];
  for (let i = refs.length - 1; i >= 0 && ordem.length < MAX_THREAD_CANDIDATES - 1; i -= 1) {
    add(refs[i]);
  }
  // A raiz entra por último e sempre, mesmo com a cadeia cortada no teto.
  add(threadKeyFrom(h));
  return ordem.slice(0, MAX_THREAD_CANDIDATES);
}

/**
 * Conversa do canal a que a thread pertence, ou `null` se nenhuma mensagem da
 * cadeia é conhecida. Roda dentro do `withWorkspace` (RLS) de quem chama.
 *
 * Restrito ao canal: o mesmo `Message-ID` num canal de outro workspace é
 * invisível pela RLS, e num outro canal do mesmo workspace é outra caixa.
 */
export async function findThreadConversation(
  tx: DbTx,
  channelId: string,
  headers: ThreadHeaders,
): Promise<string | null> {
  const candidatos = threadCandidates(headers);
  if (candidatos.length === 0) return null;

  const { messages, conversations } = schema;
  const rows = await tx
    .select({ externalId: messages.externalId, conversationId: messages.conversationId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(conversations.channelId, channelId),
        inArray(messages.externalId, candidatos),
        isNull(messages.deletedAt),
      ),
    )
    .limit(MAX_THREAD_CANDIDATES * 2);

  let melhor: { rank: number; conversationId: string } | null = null;
  for (const r of rows) {
    if (r.externalId === null) continue;
    const rank = candidatos.indexOf(r.externalId);
    if (rank < 0) continue;
    if (melhor === null || rank < melhor.rank) melhor = { rank, conversationId: r.conversationId };
  }
  return melhor?.conversationId ?? null;
}
