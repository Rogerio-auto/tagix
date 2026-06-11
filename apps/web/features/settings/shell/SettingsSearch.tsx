'use client';

/**
 * Busca de seções do painel (PERMISSIONS.md §5 — "busca global Cmd+K localiza
 * qualquer setting por nome/keyword"). Input no topo do painel + atalho Cmd/Ctrl+K
 * (scoped ao painel) que foca a busca; digitar filtra as seções por label/descrição/
 * keyword; Enter/clique seleciona. Ex.: "fuso" → Preferências, "opt-in" → Compliance.
 *
 * Só busca sobre as seções que o member pode ver (recebe a lista já gated).
 */
import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import type { SettingsSection } from './registry';

interface SettingsSearchProps {
  sections: readonly SettingsSection[];
  onSelect: (section: SettingsSection) => void;
}

function matches(section: SettingsSection, q: string): boolean {
  const needle = q.toLowerCase().trim();
  if (!needle) return false;
  return (
    section.label.toLowerCase().includes(needle) ||
    section.description.toLowerCase().includes(needle) ||
    section.keywords.some((k) => k.toLowerCase().includes(needle))
  );
}

export function SettingsSearch({ sections, onSelect }: SettingsSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useKeyboardShortcuts(
    useMemo(
      () => [{ key: 'k', ctrlOrMeta: true, handler: () => inputRef.current?.focus() }],
      [],
    ),
  );

  const results = useMemo(() => sections.filter((s) => matches(s, query)).slice(0, 8), [sections, query]);

  const choose = (section: SettingsSection): void => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    onSelect(section);
  };

  return (
    <div className="relative w-72">
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-low"
      />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) choose(results[0]);
          if (e.key === 'Escape') {
            setQuery('');
            inputRef.current?.blur();
          }
        }}
        placeholder="Buscar configuração…  (⌘K)"
        aria-label="Buscar configuração"
        className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 font-body text-sm text-text placeholder:text-text-low focus:border-border-brand focus:outline-none"
      />
      {open && query.trim() && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-elev-3">
          {results.length === 0 ? (
            <li className="px-3 py-2 font-body text-sm text-text-low">Nenhuma seção encontrada.</li>
          ) : (
            results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-surface-2',
                  )}
                >
                  <span className="font-body text-sm text-text">{s.label}</span>
                  <span className="font-body text-xs text-text-low">{s.description}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
