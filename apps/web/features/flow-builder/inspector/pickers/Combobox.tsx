'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto secundário (ex.: e-mail, nome do pipeline, tipo do campo). */
  hint?: string;
  /** Cor da entidade (tag/stage/conversão) — renderiza um swatch. Vem de dados, não literal. */
  color?: string;
}

export interface ComboboxProps {
  value: string | undefined;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  label?: string;
  hint?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Texto do estado vazio (sem resultados / sem dados). */
  emptyLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Permite confirmar um valor digitado que não está na lista (ex.: Meta Flow ID). */
  allowCustom?: boolean;
  /** Rótulo da opção de valor livre. Default: `Usar "<query>"`. */
  customLabel?: (query: string) => string;
  id?: string;
  ariaLabel?: string;
}

/**
 * Combobox pesquisável (WAI-ARIA APG combobox+listbox) — base de todos os pickers
 * do inspector de flows (F31-S03). Controlado por value/onChange. DS v2, sem hex
 * em JSX (swatches usam cor vinda de dados). Teclado: ↑/↓ navega, Enter seleciona,
 * Esc fecha e devolve o foco ao gatilho; clique-fora fecha.
 */
export function Combobox({
  value,
  onChange,
  options,
  label,
  hint,
  placeholder = 'Selecionar…',
  searchPlaceholder = 'Buscar…',
  emptyLabel = 'Nenhum resultado',
  loading = false,
  disabled = false,
  allowCustom = false,
  customLabel,
  id,
  ariaLabel,
}: ComboboxProps) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const listId = `${baseId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  // Opção de valor livre quando nada casa exatamente.
  const trimmed = query.trim();
  const showCustom =
    allowCustom &&
    trimmed.length > 0 &&
    !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase());
  const customRowIndex = showCustom ? filtered.length : -1;
  const rowCount = filtered.length + (showCustom ? 1 : 0);

  // Reposiciona o cursor ao filtrar; mantém dentro dos limites.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Foca o campo de busca ao abrir; devolve o foco ao gatilho ao fechar.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Clique-fora fecha o painel.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };

  const commit = (next: string) => {
    onChange(next);
    close();
  };

  const selectRow = (index: number) => {
    if (index === customRowIndex && showCustom) {
      commit(trimmed);
      return;
    }
    const opt = filtered[index];
    if (opt) commit(opt.value);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectRow(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const displayLabel = selected?.label ?? (value ? value : '');
  const isPlaceholder = displayLabel.length === 0;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span id={`${baseId}-label`} className="text-xs font-medium text-text-low">
          {label}
        </span>
      )}
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={baseId}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={label ? `${baseId}-label ${baseId}` : undefined}
          aria-label={ariaLabel}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-left text-sm transition-colors',
            'focus:border-accent focus:shadow-glow-sm focus:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-40',
            open && 'border-accent',
          )}
        >
          {selected?.color && (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
              aria-hidden
            />
          )}
          <span className={cn('flex-1 truncate', isPlaceholder ? 'text-text-low' : 'text-text')}>
            {isPlaceholder ? placeholder : displayLabel}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-text-low" aria-hidden />
        </button>

        {open && (
          <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border-2 bg-surface-1 shadow-elev-3">
            <div className="flex items-center gap-2 border-b border-border-2 px-2.5">
              <Search className="size-3.5 text-text-low" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={rowCount > 0 ? `${baseId}-opt-${active}` : undefined}
                aria-label={ariaLabel ?? searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-low"
              />
            </div>
            <ul id={listId} role="listbox" aria-label={ariaLabel ?? label} className="max-h-56 overflow-y-auto p-1">
              {loading && <li className="px-2.5 py-3 text-center text-xs text-text-low">Carregando…</li>}

              {!loading && rowCount === 0 && (
                <li className="px-2.5 py-3 text-center text-xs text-text-low">{emptyLabel}</li>
              )}

              {!loading &&
                filtered.map((opt, i) => {
                  const isSel = opt.value === value;
                  return (
                    <ComboboxRow
                      key={opt.value}
                      id={`${baseId}-opt-${i}`}
                      active={i === active}
                      selected={isSel}
                      onHover={() => setActive(i)}
                      onSelect={() => selectRow(i)}
                    >
                      {opt.color && (
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.color }}
                          aria-hidden
                        />
                      )}
                      <span className="flex-1 truncate">{opt.label}</span>
                      {opt.hint && <span className="shrink-0 text-[11px] text-text-low">{opt.hint}</span>}
                    </ComboboxRow>
                  );
                })}

              {!loading && showCustom && (
                <ComboboxRow
                  id={`${baseId}-opt-${customRowIndex}`}
                  active={active === customRowIndex}
                  selected={false}
                  onHover={() => setActive(customRowIndex)}
                  onSelect={() => selectRow(customRowIndex)}
                >
                  <span className="flex-1 truncate font-mono text-[12px]">
                    {customLabel ? customLabel(trimmed) : `Usar “${trimmed}”`}
                  </span>
                </ComboboxRow>
              )}
            </ul>
          </div>
        )}
      </div>
      {hint && <span className="text-[11px] text-text-low">{hint}</span>}
    </div>
  );
}

function ComboboxRow({
  id,
  active,
  selected,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <li id={id} role="option" aria-selected={selected}>
      <button
        type="button"
        tabIndex={-1}
        onMouseEnter={onHover}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors',
          active ? 'bg-surface-3 text-text' : 'text-text-mid',
        )}
      >
        {children}
        {selected && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
      </button>
    </li>
  );
}
