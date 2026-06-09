'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useUIStore } from '@/shared/stores/ui.store';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// Navegação padrão. Features registram comandos extras via prop `commands`.
const NAV: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Dashboard', href: '/' },
  { label: 'Conversas', href: '/conversations' },
  { label: 'Contatos', href: '/contacts' },
  { label: 'Pipeline', href: '/pipeline' },
  { label: 'Campanhas', href: '/campaigns' },
  { label: 'Agenda', href: '/calendar' },
  { label: 'Configurações', href: '/settings' },
];

/**
 * Paleta de comandos global (UX §2.10 — Cmd/Ctrl+K). Monte uma vez no
 * AppLayout. Abre/fecha pelo `ui.store`; navegação por teclado + Esc.
 */
export function CommandPalette({ commands = [] }: { commands?: Command[] }) {
  const open = useUIStore((s) => s.commandOpen);
  const setOpen = useUIStore((s) => s.setCommandOpen);
  const toggle = useUIStore((s) => s.toggleCommand);
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts(useMemo(() => [{ key: 'k', ctrlOrMeta: true, handler: () => toggle() }], [toggle]));

  const all = useMemo<Command[]>(
    () => [
      ...NAV.map((n) => ({
        id: `nav:${n.href}`,
        label: n.label,
        hint: 'Ir para',
        run: () => router.push(n.href),
      })),
      ...commands,
    ],
    [commands, router],
  );

  const filtered = useMemo(
    () => all.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
    [all, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
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
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-elev-4"
      >
        <div className="flex items-center gap-2 border-b border-border-2 px-4">
          <Search className="size-4 text-text-low" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar comando…"
            className="h-12 w-full bg-transparent font-body text-text outline-none placeholder:text-text-low"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center font-body text-sm text-text-low">Nenhum comando</li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left font-body text-sm transition-colors',
                  i === index ? 'bg-surface-3 text-text' : 'text-text-mid',
                )}
              >
                <span>{c.label}</span>
                {c.hint && <span className="text-xs text-text-low">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
