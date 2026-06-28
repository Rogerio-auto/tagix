'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EventChangedPayload } from '@hm/shared';
import { useSocket } from './useSocket';

/** Família de queries da lista de eventos (todas as janelas/filtros). */
export const EVENTS_LIST_KEY = ['events'] as const;

/** Chave do detalhe de um evento específico. */
export function eventDetailKey(eventId: string): readonly ['event', string] {
  return ['event', eventId];
}

/**
 * Fatia mínima do `QueryClient` que este ouvinte precisa — permite testar a lógica
 * de invalidação com um fake (harness `node`), sem React/DOM.
 */
export interface EventsQueryInvalidator {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): unknown;
}

/**
 * Decide quais queries invalidar para uma mudança de compromisso. Pura e testável.
 *
 * - A lista (`['events']`) é SEMPRE invalidada: qualquer mudança pode entrar/sair da
 *   janela visível, reordenar ou alterar um cartão.
 * - `updated`/`deleted` também invalidam o detalhe (`['event', id]`) — quem estiver com
 *   o drawer/detalhe aberto recebe o estado novo (ex.: cancelado). `created` não tem
 *   detalhe aberto para esse id, então só a lista.
 */
export function invalidateForEventChange(
  queryClient: EventsQueryInvalidator,
  payload: EventChangedPayload,
): void {
  queryClient.invalidateQueries({ queryKey: EVENTS_LIST_KEY });
  if (payload.kind === 'updated' || payload.kind === 'deleted') {
    queryClient.invalidateQueries({ queryKey: eventDetailKey(payload.eventId) });
  }
}

/**
 * Ouvinte global de compromissos em tempo real (F54-S02 / AGENDA_SYNC.md §1).
 *
 * Assina `event:created|updated|deleted` (emitidos pela API em F54-S01) e invalida o
 * cache TanStack Query de eventos. Como o cache é global, invalidar de um único ponto
 * mantém Cockpit **e** Agenda Central sincronizados sem refresh — bidirecional por
 * construção (a persistência é a fonte da verdade; o cliente refaz o fetch).
 *
 * Espelha o padrão de `useAppointmentDue` / `deal:*`: consome o socket compartilhado via
 * `useSocket()` (NÃO reescreve o `SocketProvider`) e reage ao que chega à conexão
 * autenticada — o servidor já roteia para a room `ws:<workspaceId>`, sem filtragem extra.
 *
 * Montar UMA vez (no `AppLayout`), para valer em qualquer rota.
 */
export function useEventsRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    const onChange = (payload: EventChangedPayload): void => {
      invalidateForEventChange(queryClient, payload);
    };

    socket.on('event:created', onChange);
    socket.on('event:updated', onChange);
    socket.on('event:deleted', onChange);

    return () => {
      socket.off('event:created', onChange);
      socket.off('event:updated', onChange);
      socket.off('event:deleted', onChange);
    };
  }, [socket, queryClient]);
}
