'use client';

import { useMemo } from 'react';
import type { ConversationNote, MentionableMember } from './types';

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Renderiza o corpo realçando os tokens `@handle` como menção (token de marca). */
function renderBody(body: string): React.ReactNode {
  const parts = body.split(/(@[a-z0-9_]+)/gi);
  return parts.map((part, i) =>
    /^@[a-z0-9_]+$/i.test(part) ? (
      <span key={i} className="font-medium text-brand">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function NoteItem({
  note,
  authorsById,
}: {
  note: ConversationNote;
  authorsById: ReadonlyMap<string, MentionableMember>;
}) {
  const author = note.authorMemberId ? authorsById.get(note.authorMemberId) : undefined;
  const authorLabel = author?.name?.trim() || author?.email || 'Membro';
  const when = useMemo(() => timeFmt.format(new Date(note.createdAt)), [note.createdAt]);

  return (
    <li className="rounded-md border border-border-2 bg-surface-2 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate font-head text-xs font-semibold text-text-mid">{authorLabel}</span>
        <time dateTime={note.createdAt} className="shrink-0 font-body text-xs text-text-low">
          {when}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words font-body text-sm text-text">
        {renderBody(note.body)}
      </p>
    </li>
  );
}
