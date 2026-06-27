/**
 * Operações PURAS sobre a página de mensagens em cache (F52-S07).
 *
 * Mantidas fora dos hooks de socket para serem testáveis sem React/DOM (o
 * harness do @hm/web roda em ambiente `node`). Os hooks de tempo real
 * (`useConversationSocket`) só orquestram socket + `queryClient` e delegam a
 * mutação determinística do cache a estas funções.
 */

import type { MessageItem } from '../types';

/** Envelope de cache de `['conversation', id, 'messages']`. */
export interface MessagesPage {
  messages: MessageItem[];
}

/**
 * Remove bolhas duplicadas por `id`, preservando a ordem (e mantendo a primeira
 * ocorrência — a API devolve DESC, então a primeira é a mais recente).
 *
 * Dedup DEFENSIVO ao mesclar socket + refetch: mesmo com a estratégia de
 * `invalidate` (refetch substitui a página inteira), uma corrida entre a
 * reconciliação otimista e um `message:new` pode, em teoria, deixar a mesma
 * mensagem duas vezes no cache por um tick. Esta função garante que a timeline
 * nunca renderize a mesma bolha duplicada.
 */
export function dedupeMessages(messages: readonly MessageItem[]): MessageItem[] {
  const seen = new Set<string>();
  const out: MessageItem[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/**
 * Marca a mensagem-alvo como mídia falha (`mediaFailed: true`) dentro de uma
 * página em cache. Retorna a MESMA referência quando nada muda (mensagem ausente
 * ou já marcada) — assim `setQueryData` não dispara re-render redundante.
 */
export function markMediaFailed(
  data: MessagesPage | undefined,
  messageId: string,
): MessagesPage | undefined {
  if (data === undefined) return data;
  let changed = false;
  const messages = data.messages.map((m) => {
    if (m.id !== messageId || m.mediaFailed === true) return m;
    changed = true;
    return { ...m, mediaFailed: true };
  });
  return changed ? { messages } : data;
}
