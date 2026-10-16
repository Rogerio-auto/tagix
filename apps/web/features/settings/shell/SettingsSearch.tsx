'use client';

/**
 * Busca de seções do painel (PERMISSIONS.md §5 — "busca global ⌘K localiza qualquer
 * setting por nome/keyword"), no DS 3.0 (F72-S07). Campo no topo do painel + atalho
 * ⌘/Ctrl+K (escopo do painel) que foca a busca; digitar filtra as seções por
 * label/descrição/keyword; Enter/clique seleciona. Ex.: "fuso" → Preferências.
 *
 * Só busca sobre as seções que o member pode ver (recebe a lista já gated).
 */
import { useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useKeyboardShortcuts } from '@/shared/hooks/useKeyboardShortcuts';
import { SETTINGS_GROUP_LABEL, type SettingsSection } from './registry';

interface SettingsSearchProps {
  sections: readonly SettingsSection[];
  onSelect: (section: SettingsSection) => void;
  className?: string;
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

export function SettingsSearch({ sections, onSelect, className }: SettingsSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useKeyboardShortcuts(
    useMemo(() => [{ key: 'k', ctrlOrMeta: true, handler: () => inputRef.current?.focus() }], []),
  );

  const results = useMemo(() => sections.filter((s) => matches(s, query)).slice(0, 8), [sections, query]);

  const choose = (section: SettingsSection): void => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    onSelect(section);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className={cn('relative w-72', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
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
        placeholder="Buscar configuração"
        aria-label="Buscar configuração"
        className={cn(
          'h-10 w-full rounded-sm border border-border bg-surface-2 pl-9 pr-12 font-body text-base text-text outline-none sm:text-sm',
          'placeholder:text-text-low transition-[border-color,box-shadow] duration-(--dur-base) ease-ds',
          'hover:border-border-2 focus:border-brand-text focus-visible:focus-ring',
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      <kbd
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-xs border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text-low"
      >
        ⌘K
      </kbd>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Seções encontradas"
          className="absolute right-0 z-20 mt-2 w-full min-w-72 overflow-hidden rounded-md border border-border-2 bg-bg-elevated p-1 shadow-ds-2 motion-safe:animate-[hm-rise_160ms_var(--ease)_both]"
        >
          {results.length === 0 ? (
            <li role="option" aria-selected={false} aria-disabled className="px-3 py-2 font-body text-sm text-text-low">
              Nenhuma seção encontrada.
            </li>
          ) : (
            // Opções não focáveis (o foco fica no campo; Enter escolhe a primeira): clique
            // por `mousedown` para não perder a seleção para o `blur` do campo.
            results.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={i === 0}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2',
                  i === 0 && 'bg-surface-2',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-body text-sm font-semibold text-text">{s.label}</span>
                  <span className="truncate font-body text-xs text-text-low">{s.description}</span>
                </span>
                <span className="mt-0.5 flex shrink-0 items-center gap-1 font-mono text-xs uppercase tracking-wider text-text-low">
                  {SETTINGS_GROUP_LABEL[s.group]}
                  {s.externalHref && <ArrowUpRight className="size-3" aria-hidden />}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
