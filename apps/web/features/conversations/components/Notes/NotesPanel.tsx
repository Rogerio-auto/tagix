'use client';

import { useMemo } from 'react';
import { StickyNote } from 'lucide-react';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import { NoteComposer } from './NoteComposer';
import { NoteItem } from './NoteItem';
import { useCreateNote, useNotes } from './queries';
import type { MentionableMember } from './types';

/**
 * Painel de notas internas por conversa (F1-S22 / LIVECHAT.md §7.4).
 *
 * Pensado para viver dentro do `ContactInfoPanel`. Recebe `members` para o
 * autocomplete/realce de menção (`@member`); quando vazio, o composer ainda
 * funciona como texto livre (sem resolução de menção). Mentions geram
 * notificação ao mencionado via socket `member:{id}` (backend).
 *
 * UX: empty/loading(skeleton)/error(3 partes) na lista (§3); detalhe inline no
 * painel, não modal (§2.3); feedback imediato no envio (§2.7).
 */
export function NotesPanel({
  conversationId,
  members = [],
  hideHeader = false,
}: {
  conversationId: string;
  members?: readonly MentionableMember[];
  /** Suprime o header interno quando a seção já tem header colapsável no cockpit. */
  hideHeader?: boolean;
}) {
  const { data, isLoading, isError, error, refetch } = useNotes(conversationId);
  const createNote = useCreateNote();

  const authorsById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );

  const notes = data?.notes ?? [];

  return (
    <section aria-label="Notas internas" className="flex flex-col gap-3">
      {!hideHeader && (
        <header className="flex items-center gap-2">
          <StickyNote className="size-4 text-text-low" aria-hidden />
          <h3 className="font-head text-sm font-semibold text-text">Notas internas</h3>
        </header>
      )}

      <NoteComposer
        members={members}
        pending={createNote.isPending}
        onSubmit={({ body, mentions }) =>
          createNote.mutate({ conversationId, body, mentions })
        }
      />

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : isError ? (
        <ErrorState
          title="Não foi possível carregar as notas"
          reason="A lista de notas internas desta conversa não respondeu."
          whatToDo="Tente novamente em instantes."
          reference={error instanceof ApiError ? error.ref : undefined}
        />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="Sem notas ainda"
          description="Registre contexto interno e use @ para avisar a equipe."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} authorsById={authorsById} />
          ))}
          {createNote.isError && (
            <li className="rounded-sm border border-danger/40 bg-surface-2 px-3 py-2 font-body text-xs text-danger">
              Falha ao salvar a nota. Tente novamente.
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={() => void refetch()}
              className="font-body text-xs text-text-low underline-offset-4 outline-none hover:text-text-mid focus-visible:shadow-glow-md"
            >
              Atualizar notas
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
