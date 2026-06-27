/**
 * Resync de cache ao (re)conectar o socket (F52-S07).
 *
 * Causa-raiz: o `SocketProvider` reconecta sozinho, mas no `connect` NADA era
 * rebuscado → eventos emitidos enquanto o cliente esteve offline (status,
 * mensagens novas, mudança de estado) sumiam, e a UI ficava stale até um refresh
 * manual. Ao (re)conectar, invalidamos as queries da conversa aberta + a lista
 * para fechar esse gap.
 *
 * Pura/orquestradora: recebe só a fatia `invalidateQueries` do `QueryClient`,
 * para ser testável sem React (o harness do @hm/web roda em `node`).
 */

import { conversationAgentKey, conversationDetailKey, messagesKey } from '../queries';

/** Fatia mínima do `QueryClient` usada aqui (testável com um fake). */
export interface ResyncQueryClient {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): unknown;
}

/** Chave da LISTA de conversas (igual à usada por `useConversations`). */
export const CONVERSATIONS_KEY = ['conversations'] as const;

/**
 * Invalida as queries que podem ter perdido eventos durante a desconexão.
 *
 * - Sempre: a LISTA de conversas (`['conversations']`).
 * - Com conversa aberta: mensagens, detalhe e agente daquela conversa.
 *
 * `invalidateQueries` é idempotente dentro de um tick (chamar a mesma chave por
 * mais de um hook é deduplicado pelo TanStack Query), então é seguro vários
 * hooks chamarem isto no mesmo `connect`.
 */
export function resyncConversationData(
  queryClient: ResyncQueryClient,
  conversationId: string | undefined,
): void {
  void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
  if (conversationId !== undefined && conversationId !== '') {
    void queryClient.invalidateQueries({ queryKey: messagesKey(conversationId) });
    void queryClient.invalidateQueries({ queryKey: conversationDetailKey(conversationId) });
    void queryClient.invalidateQueries({ queryKey: conversationAgentKey(conversationId) });
  }
}
