'use client';

/**
 * Reações de emoji nas bolhas (F45-S06).
 *
 * Uma reação é enviada como uma mensagem `type:'reaction'` (S02): o backend cria
 * uma linha `messages` com `reaction_emoji` + `reply_to_message_id` (= id interno
 * da mensagem-alvo) e resolve o `external_id` do alvo sob RLS. Em vez de exibir
 * essa linha como uma bolha SOLTA na timeline, dobramos a reação num "chip"
 * ancorado na própria mensagem-alvo (ver `MessageBubble`).
 *
 * Este hook é a fonte de verdade do estado visual das reações por conversa — um
 * mapa `targetMessageId → emoji` mantido no cache do TanStack Query como estado
 * client-only (sem `queryFn`: nunca vai à rede, só `setQueryData`). Duas escritas
 * alimentam o mapa:
 *
 *  1. OTIMISTA (`sendReaction`): grava o emoji escolhido antes da resposta da API
 *     e faz rollback no erro (UX §2.7 — feedback imediato + nunca um beco sem
 *     saída). Reagir com o mesmo emoji remove (envia `''`); reagir com outro troca.
 *  2. PERSISTIDO (`foldPersisted`): ao renderizar uma linha `type:'reaction'`,
 *     a `MessageBubble` dobra o emoji persistido no mapa (idempotente) — assim o
 *     chip sobrevive a refetch/recarregamento da página sem tocar o cache de
 *     mensagens nem a `ThreadMessages` (fora do escopo deste slot).
 *
 * Escopo desta entrega: reações OUTBOUND (enviadas pelo atendente). O pipeline
 * inbound ainda NÃO persiste reações recebidas como linha própria
 * (`apps/workers/src/inbound/db-ports.ts`), então não há reação do contato para
 * exibir — follow-up registrado no REPORT do slot.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { MessageItem } from '../types';

/** Estado visual das reações de uma conversa: id interno da alvo → emoji (`''` = sem reação). */
export type ReactionMap = Readonly<Record<string, string>>;

/** Chave de cache do mapa de reações de uma conversa (estado client-only). */
export function reactionsKey(conversationId: string) {
  return ['conversation', conversationId, 'reactions'] as const;
}

interface SendReactionVars {
  /** Id INTERNO (uuid) da mensagem-alvo na timeline — a rota resolve o external_id. */
  targetMessageId: string;
  /** Emoji a aplicar; `''` remove a reação. */
  emoji: string;
}

interface SendReactionContext {
  previous: ReactionMap;
}

/** Resposta da rota de envio (S02) — a bolha de reação real, que dobramos no chip. */
interface SendReactionResult {
  message: MessageItem;
}

export interface UseReactionsResult {
  /** Emoji aplicado a uma mensagem (`''` quando não há reação). Reativo. */
  reactionFor: (messageId: string) => string;
  /** Há um envio de reação em voo (UX §2.7 — desabilita re-clique). */
  isPending: boolean;
  /**
   * Aplica/troca/remove a reação a uma mensagem-alvo (otimista). Reagir com o
   * emoji já aplicado remove (envia `''`); com outro, troca.
   */
  sendReaction: (targetMessageId: string, emoji: string) => void;
  /**
   * Dobra um emoji PERSISTIDO (linha `type:'reaction'`) no mapa visual, sem
   * mutação. Idempotente: se o valor não muda, preserva a referência anterior
   * (não dispara re-render nem loop de efeito).
   */
  foldPersisted: (targetMessageId: string, emoji: string) => void;
}

/**
 * Reações da conversa: leitura reativa do mapa + envio otimista + folding de
 * reações persistidas. Compartilha o mesmo cache por `conversationId`, então
 * todas as bolhas da thread enxergam o mesmo estado.
 */
export function useReactions(conversationId: string): UseReactionsResult {
  const queryClient = useQueryClient();
  const key = reactionsKey(conversationId);

  // Estado client-only: nunca vai à rede (sem refetch), só lemos/escrevemos via
  // cache. `initialData` + `staleTime: Infinity` garantem que o `queryFn` nunca
  // dispara — ele existe apenas para satisfazer o tipo.
  const { data } = useQuery<ReactionMap>({
    queryKey: key,
    queryFn: () => ({}),
    initialData: {},
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const map = data ?? {};

  const mutation = useMutation<SendReactionResult, Error, SendReactionVars, SendReactionContext>({
    mutationFn: ({ targetMessageId, emoji }) =>
      api.post<SendReactionResult>(`/api/conversations/${conversationId}/messages`, {
        content: null,
        type: 'reaction',
        payload: { targetMessageId, emoji },
      }),

    onMutate: ({ targetMessageId, emoji }): SendReactionContext => {
      const previous = queryClient.getQueryData<ReactionMap>(key) ?? {};
      queryClient.setQueryData<ReactionMap>(key, { ...previous, [targetMessageId]: emoji });
      return { previous };
    },

    onError: (_err, _vars, context) => {
      // Rollback ao snapshot anterior — o chip volta ao estado pré-clique (§2.7).
      if (context) queryClient.setQueryData<ReactionMap>(key, context.previous);
    },
  });

  const reactionFor = useCallback((messageId: string): string => map[messageId] ?? '', [map]);

  const sendReaction = useCallback(
    (targetMessageId: string, emoji: string) => {
      const current = queryClient.getQueryData<ReactionMap>(key)?.[targetMessageId] ?? '';
      // Toggle: reagir com o mesmo emoji remove; com outro, troca.
      const next = current === emoji ? '' : emoji;
      mutation.mutate({ targetMessageId, emoji: next });
    },
    [queryClient, key, mutation],
  );

  const foldPersisted = useCallback(
    (targetMessageId: string, emoji: string) => {
      queryClient.setQueryData<ReactionMap>(key, (prev) => {
        const base = prev ?? {};
        // Sem mudança → preserva a referência (não notifica subscribers; evita loop).
        if ((base[targetMessageId] ?? '') === emoji) return base;
        return { ...base, [targetMessageId]: emoji };
      });
    },
    [queryClient, key],
  );

  return { reactionFor, isPending: mutation.isPending, sendReaction, foldPersisted };
}
