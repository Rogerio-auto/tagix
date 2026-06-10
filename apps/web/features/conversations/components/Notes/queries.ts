'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { ConversationNote, CreateNoteInput } from './types';

/** Chave de cache das notas de uma conversa (fonte única). */
export function notesKey(conversationId: string) {
  return ['conversation', conversationId, 'notes'] as const;
}

/** Lista as notas internas da conversa (mais recentes primeiro). */
export function useNotes(conversationId: string | undefined) {
  return useQuery({
    queryKey: notesKey(conversationId ?? ''),
    queryFn: () =>
      api.get<{ notes: ConversationNote[] }>(`/api/conversations/${conversationId}/notes`),
    enabled: Boolean(conversationId),
  });
}

/**
 * Cria uma nota interna. Após o sucesso, invalida a lista para refletir a nova
 * nota (e as mentions resolvidas autoritativamente pelo backend — só membros
 * existentes do workspace permanecem). UX §2.7: o botão fica em loading durante
 * a chamada (feedback imediato), sem patch otimista (mentions são validadas no
 * servidor).
 */
export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation<{ note: ConversationNote }, Error, CreateNoteInput>({
    mutationFn: ({ conversationId, body, mentions }) =>
      api.post<{ note: ConversationNote }>(`/api/conversations/${conversationId}/notes`, {
        body,
        mentions,
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: notesKey(input.conversationId) });
    },
  });
}
