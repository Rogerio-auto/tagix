'use client';

import { useEffect } from 'react';
import type { AppointmentDuePayload } from '@hm/shared';
import { useSocket } from './useSocket';
import { useNotificationsStore } from '@/features/notifications/store';

/**
 * Assina o evento socket `appointment:due` (F53-S05) e empurra cada lembrete
 * para a central de notificações (F53-S06). Consome o socket compartilhado via
 * `useSocket()` — NÃO reescreve o `SocketProvider`. Montar UMA vez (na central,
 * dentro do `AppLayout`).
 *
 * O servidor roteia o evento para a room `member:<organizerId>`; o cliente apenas
 * reage ao que chega à sua conexão autenticada — sem filtragem extra aqui.
 */
export function useAppointmentDue(): void {
  const { socket } = useSocket();
  const push = useNotificationsStore((s) => s.push);

  useEffect(() => {
    if (!socket) return;
    const onDue = (p: AppointmentDuePayload): void => {
      push({
        eventId: p.eventId,
        contactId: p.contactId,
        conversationId: p.conversationId,
        title: p.title,
        type: p.type,
        priority: p.priority,
        startAt: p.startAt,
      });
    };
    socket.on('appointment:due', onDue);
    return () => {
      socket.off('appointment:due', onDue);
    };
  }, [socket, push]);
}
