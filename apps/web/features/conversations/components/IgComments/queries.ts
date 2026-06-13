'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

/** Comment IG como retornado por GET /api/instagram/comments?mediaId= (F15-S05). */
export interface IgComment {
  id: string;
  mediaId: string | null;
  commentId: string | null;
  parentCommentId: string | null;
  fromIgsid: string | null;
  fromUsername: string | null;
  text: string | null;
  mediaKind: string | null;
  hidden: boolean;
  createdAt: string;
}

function commentsKey(mediaId: string) {
  return ['ig-comments', mediaId] as const;
}

/** Lista a thread de comments de um post/reel (RLS no backend). */
export function useIgComments(mediaId: string | undefined) {
  return useQuery({
    queryKey: mediaId ? commentsKey(mediaId) : ['ig-comments', 'idle'],
    queryFn: () => api.get<{ comments: IgComment[] }>(`/api/instagram/comments?mediaId=${mediaId}`),
    enabled: Boolean(mediaId),
  });
}

interface ReplyVars {
  commentId: string;
  mode: 'public' | 'private';
  text: string;
}

/** Responde a um comment (publico ou por DM). Enfileira no backend. */
export function useReplyComment(mediaId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ enqueued: boolean }, Error, ReplyVars>({
    mutationFn: ({ commentId, mode, text }) =>
      api.post<{ enqueued: boolean }>(`/api/instagram/comments/${commentId}/reply`, { mode, text }),
    onSuccess: () => {
      if (mediaId) void qc.invalidateQueries({ queryKey: commentsKey(mediaId) });
    },
  });
}

/** Oculta/exibe um comment. */
export function useHideComment(mediaId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ enqueued: boolean }, Error, { commentId: string; hide: boolean }>({
    mutationFn: ({ commentId, hide }) =>
      api.post<{ enqueued: boolean }>(`/api/instagram/comments/${commentId}/hide`, { hide }),
    onSuccess: () => {
      if (mediaId) void qc.invalidateQueries({ queryKey: commentsKey(mediaId) });
    },
  });
}

/** Exclui um comment (destrutivo). */
export function useDeleteComment(mediaId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<void, Error, { commentId: string }>({
    mutationFn: ({ commentId }) => api.delete<void>(`/api/instagram/comments/${commentId}`),
    onSuccess: () => {
      if (mediaId) void qc.invalidateQueries({ queryKey: commentsKey(mediaId) });
    },
  });
}
