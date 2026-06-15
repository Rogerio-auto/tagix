'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Braces, Search } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface VarItem {
  /** Token sem as chaves (ex.: `contact.name`). */
  token: string;
  label: string;
}

interface VarGroup {
  id: string;
  title: string;
  items: VarItem[];
}

/**
 * Catálogo de variáveis interpoláveis pelo flow-engine (`{{ var.path }}`).
 * Fundamentado nas variáveis realmente semeadas em runtime (dispatcher +
 * handlers): namespace do contato/conversa, `trigger`, respostas de nodes
 * anteriores e `webhook_response`. Variáveis de `set_variable` entram via
 * `flowVariables`.
 */
const BASE_GROUPS: readonly VarGroup[] = [
  {
    id: 'contact',
    title: 'Contato',
    items: [
      { token: 'contact.name', label: 'Nome do contato' },
      { token: 'contact.phone', label: 'Telefone' },
      { token: 'contact.email', label: 'E-mail' },
    ],
  },
  {
    id: 'conversation',
    title: 'Conversa',
    items: [{ token: 'conversation.status', label: 'Status da conversa' }],
  },
  {
    id: 'trigger',
    title: 'Gatilho',
    items: [{ token: 'trigger.message', label: 'Mensagem que disparou o flow' }],
  },
  {
    id: 'responses',
    title: 'Respostas de nodes anteriores',
    items: [
      { token: 'last_response', label: 'Última resposta do contato' },
      { token: 'last_response_type', label: 'Tipo da última resposta' },
      { token: 'webhook_response.body', label: 'Corpo da resposta HTTP' },
      { token: 'webhook_response.status', label: 'Status HTTP' },
      { token: 'webhook_response.headers', label: 'Cabeçalhos HTTP' },
      { token: 'webhook_error', label: 'Erro do último HTTP' },
    ],
  },
] as const;

export interface VariablesPickerProps {
  /** Recebe o token JÁ com as chaves, ex.: `{{contact.name}}`. */
  onPick: (token: string) => void;
  /**
   * Variáveis definidas no flow por nodes `set_variable`. Aparecem no grupo
   * "Variáveis do flow". Se não houver fonte, o grupo mostra um aviso extensível.
   */
  flowVariables?: readonly string[];
}

/** Picker de variáveis para inputs do inspector (FLOW_BUILDER §8/§9.2). */
export function VariablesPicker({ onPick, flowVariables }: VariablesPickerProps) {
  const baseId = useId();
  const listId = `${baseId}-vars`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo<VarGroup[]>(() => {
    const flowItems: VarItem[] = (flowVariables ?? []).map((v) => ({ token: v, label: v }));
    return [...BASE_GROUPS, { id: 'flow', title: 'Variáveis do flow', items: flowItems }];
  }, [flowVariables]);

  const filteredGroups = useMemo<VarGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) => it.token.toLowerCase().includes(q) || it.label.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);

  // Lista achatada das opções visíveis para navegação por teclado.
  const flat = useMemo<VarItem[]>(() => filteredGroups.flatMap((g) => g.items), [filteredGroups]);

  const trimmed = query.trim();
  const showCustom = trimmed.length > 0 && !flat.some((it) => it.token === trimmed);
  const customIndex = showCustom ? flat.length : -1;
  const rowCount = flat.length + (showCustom ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Insere o token. Mantém o popover aberto para inserções múltiplas.
  const insert = (rawToken: string) => {
    onPick(`{{${rawToken}}}`);
  };

  const selectRow = (index: number) => {
    if (index === customIndex && showCustom) {
      insert(trimmed);
      return;
    }
    const it = flat[index];
    if (it) insert(it.token);
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
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Índice absoluto de um item para mapear ao cursor da navegação por teclado.
  let runningIndex = -1;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-low transition-colors',
          'hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none',
          open && 'border-accent text-text',
        )}
      >
        <Braces className="size-3.5" aria-hidden />
        Inserir variável
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-md border border-border-2 bg-surface-1 shadow-elev-3">
          <div className="flex items-center gap-2 border-b border-border-2 px-2.5">
            <Search className="size-3.5 text-text-low" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar variável…"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rowCount > 0 ? `${baseId}-row-${active}` : undefined}
              aria-label="Buscar variável"
              className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-low"
            />
          </div>

          <div id={listId} role="listbox" aria-label="Variáveis" className="max-h-64 overflow-y-auto p-1">
            {filteredGroups.length === 0 && !showCustom && (
              <p className="px-2.5 py-3 text-center text-xs text-text-low">Nenhuma variável</p>
            )}

            {filteredGroups.map((g) => (
              <div key={g.id} role="group" aria-label={g.title} className="mb-1 last:mb-0">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-low">
                  {g.title}
                </p>
                {g.id === 'flow' && g.items.length === 0 ? (
                  <p className="px-2.5 pb-1 text-[11px] text-text-low">
                    Defina variáveis com o node “Definir variável”.
                  </p>
                ) : (
                  g.items.map((it) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    return (
                      <VarRow
                        key={it.token}
                        id={`${baseId}-row-${idx}`}
                        active={idx === active}
                        token={it.token}
                        label={it.label}
                        onHover={() => setActive(idx)}
                        onPick={() => selectRow(idx)}
                      />
                    );
                  })
                )}
              </div>
            ))}

            {showCustom && (
              <button
                id={`${baseId}-row-${customIndex}`}
                type="button"
                role="option"
                aria-selected={active === customIndex}
                tabIndex={-1}
                onMouseEnter={() => setActive(customIndex)}
                onClick={() => selectRow(customIndex)}
                className={cn(
                  'mt-1 flex w-full items-center gap-2 rounded-sm border-t border-border-2 px-2.5 py-2 text-left transition-colors',
                  active === customIndex ? 'bg-surface-3 text-text' : 'text-text-mid',
                )}
              >
                <span className="text-[11px] text-text-low">Inserir</span>
                <span className="font-mono text-[12px] text-text">{`{{${trimmed}}}`}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VarRow({
  id,
  active,
  token,
  label,
  onHover,
  onPick,
}: {
  id: string;
  active: boolean;
  token: string;
  label: string;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left transition-colors',
        active ? 'bg-surface-3' : '',
      )}
    >
      <span className={cn('truncate text-sm', active ? 'text-text' : 'text-text-mid')}>{label}</span>
      <span className="shrink-0 font-mono text-[11px] text-text-low">{`{{${token}}}`}</span>
    </button>
  );
}
