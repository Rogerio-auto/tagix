'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

/** Resposta de `PUT /api/events/:id` (subconjunto usado aqui). */
interface UpdateEventResponse {
  event: { id: string; status: string };
}

/**
 * Conclui o compromisso da notificação (F53-S06): `PUT /api/events/:id` com
 * `status: 'completed'`. A central remove o item ao concluir com sucesso.
 */
export function useCompleteEvent() {
  return useMutation<UpdateEventResponse, Error, string>({
    mutationFn: (eventId) =>
      api.put<UpdateEventResponse>(`/api/events/${eventId}`, { status: 'completed' }),
  });
}
