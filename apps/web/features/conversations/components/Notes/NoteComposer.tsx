'use client';

import { useMemo, useRef, useState } from 'react';
import { AtSign, Send } from 'lucide-react';
import { Button } from '@hm/ui';
import {
  activeMentionQuery,
  applyMention,
  memberHandle,
  memberLabel,
  resolveMentions,
} from './mentions';
import type { MentionableMember } from './types';

const MAX_BODY = 5000;

/**
 * Editor de nota interna com autocomplete de menção `@member` (F1-S22).
 *
 * UX aplicado: §2.7 feedback imediato (botão em loading durante o POST), §2.10
 * atalhos (Cmd/Ctrl+Enter envia; Esc fecha o popover de menção), §2.12
 * notificação por evento relevante (mention → socket member:{id}). Sem hex —
 * tokens semânticos do DS v2.
 */
export function NoteComposer({
  members,
  pending,
  onSubmit,
}: {
  members: readonly MentionableMember[];
  pending: boolean;
  onSubmit: (input: { body: string; mentions: string[] }) => void;
}) {
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const query = activeMentionQuery(value, caret);

  const suggestions = useMemo(() => {
    if (query === null || members.length === 0) return [];
    const q = query.toLowerCase();
    return members
      .filter((m) => !q || memberHandle(m).includes(q) || memberLabel(m).toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, members]);

  const menuOpen = showMenu && query !== null && suggestions.length > 0;

  function syncCaret(el: HTMLTextAreaElement): void {
    setCaret(el.selectionStart);
    setShowMenu(true);
    setActiveIndex(0);
  }

  function choose(member: MentionableMember): void {
    const { next, caret: nextCaret } = applyMention(value, caret, member);
    setValue(next);
    setCaret(nextCaret);
    setShowMenu(false);
    // Reposiciona o cursor após a inserção.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function submit(): void {
    const body = value.trim();
    if (!body || pending) return;
    onSubmit({ body, mentions: resolveMentions(body, members) });
    setValue('');
    setCaret(0);
    setShowMenu(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = suggestions[activeIndex];
        if (picked) {
          event.preventDefault();
          choose(picked);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowMenu(false);
        return;
      }
    }
    // Cmd/Ctrl+Enter envia (UX §2.10).
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative">
      {menuOpen && (
        <ul
          role="listbox"
          aria-label="Mencionar membro"
          className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-surface-2 p-1 shadow-glow-md"
        >
          {suggestions.map((member, index) => (
            <li key={member.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(member);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-body text-sm outline-none ${
                  index === activeIndex ? 'bg-surface-3 text-text' : 'text-text-mid'
                }`}
              >
                <AtSign className="size-3.5 text-text-low" aria-hidden />
                <span className="truncate">{memberLabel(member)}</span>
                <span className="ml-auto truncate font-body text-xs text-text-low">
                  @{memberHandle(member)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-inset p-2 focus-within:border-brand focus-within:shadow-glow-sm">
        <textarea
          ref={textareaRef}
          value={value}
          rows={3}
          maxLength={MAX_BODY}
          placeholder="Escreva uma nota interna… use @ para mencionar a equipe"
          aria-label="Nova nota interna"
          onChange={(e) => {
            setValue(e.target.value);
            syncCaret(e.currentTarget);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          className="w-full resize-none bg-transparent font-body text-sm text-text outline-none placeholder:text-text-low"
        />
        <div className="flex items-center justify-between">
          <span className="font-body text-xs text-text-low">⌘/Ctrl + Enter para enviar</span>
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={pending}
            disabled={!value.trim()}
            leftIcon={<Send className="size-3.5" aria-hidden />}
            onClick={submit}
          >
            Adicionar nota
          </Button>
        </div>
      </div>
    </div>
  );
}
