'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useUIStore } from '@/shared/stores/ui.store';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { useAuthStore } from '@/shared/stores/auth.store';
import { visibleNavItems } from '@/shared/components/layout/nav';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Paleta de comandos global (UX §2.10 — Cmd/Ctrl+K). Monte uma vez no
 * AppLayout. Abre/fecha pelo `ui.store`; navegação por teclado + Esc.
 */
export function CommandPalette({ commands = [] }: { commands?: Command[] }) {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const toggle = useUIStore((s) => s.toggleCommand);
  const router = useRouter();
  const role = useAuthStore((st) => st.auth?.role);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts(
    useMemo(() => [{ key: 'k', ctrlOrMeta: true, handler: () => toggle() }], [toggle]),
  );

  const all = useMemo<Command[]>(
    () => [
      // Destinos vêm do `nav.ts` já filtrados por papel: quem não pode agir não vê.
      ...visibleNavItems(role).map((n) => ({
        id: `nav:${n.href}`,
        label: n.label,
        hint: 'Ir para',
        run: () => router.push(n.href),
      })),
      ...commands,
    ],
    [commands, router, role],
  );

  const filtered = useMemo(
    () => all.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [all, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    // Devolve o foco a quem abriu a paleta ao fechar (WCAG 2.4.3).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') {
      // Trap de foco: a paleta é um diálogo modal de um campo só; Tab não vaza para a
      // página atrás (WCAG 2.4.3). A navegação entre opções é por setas.
      e.preventDefault();
      inputRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const cmd = filtered[index];
      if (cmd) {
        cmd.run();
        setOpen(false);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-md border border-border-2 bg-surface-glass shadow-ds-3 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-border-2 px-4">
          <Search className="size-4 text-text-low" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar comando…"
            // Padrão combobox/listbox (WAI-ARIA APG): o input controla a lista e
            // aponta o item ativo, para o leitor anunciar a navegação por setas.
            role="combobox"
            aria-expanded
            aria-controls="hm-command-list"
            aria-autocomplete="list"
            aria-activedescendant={filtered[index] ? `hm-cmd-${filtered[index].id}` : undefined}
            aria-label="Buscar comando"
            className="h-12 w-full bg-transparent font-body text-text outline-none placeholder:text-text-low"
          />
        </div>
        <ul
          id="hm-command-list"
          role="listbox"
          aria-label="Comandos"
          className="max-h-80 overflow-y-auto p-2"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center font-body text-sm text-text-low">
              Nenhum comando
            </li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id} id={`hm-cmd-${c.id}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left font-body text-sm transition-colors',
                  i === index
                    ? 'bg-surface-3 text-text shadow-[inset_2px_0_0_var(--brand-text)]'
                    : 'text-text-mid',
                )}
              >
                <span>{c.label}</span>
                {c.hint && <span className="text-xs text-text-low">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 font-mono text-[0.6875rem] text-text-low">
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
