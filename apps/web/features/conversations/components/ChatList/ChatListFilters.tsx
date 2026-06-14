'use client';

/**
 * Filtros da ChatList (F30-S03 / LIVECHAT_OPS §3).
 *
 * Estende os filtros existentes (status/responsável/canal) com:
 *  - Departamento e Time — coerentes com a política de visibilidade.
 *
 * Os filtros dept/time são entregues via props opcionais (departments/teams) com
 * callbacks dedicados (onDeptChange/onTeamChange), desacoplados do
 * ChatListFilterState para não depender do slot S10 (useChatList.ts).
 *
 * UX §2.10: selects navegáveis por teclado; focus ring visível.
 * DS v2: zero hex hardcoded, tokens semânticos.
 */

import { Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { ChatListFilterState } from '../../hooks/useChatList';

interface SelectFilter {
  key: 'status' | 'assigned' | 'provider';
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

const SELECT_FILTERS: readonly SelectFilter[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: '', label: 'Todos status' },
      { value: 'open', label: 'Abertas' },
      { value: 'pending', label: 'Pendentes' },
      { value: 'resolved', label: 'Resolvidas' },
      { value: 'closed', label: 'Fechadas' },
    ],
  },
  {
    key: 'assigned',
    label: 'Responsável',
    options: [
      { value: '', label: 'Qualquer um' },
      { value: 'me', label: 'Atribuídas a mim' },
      { value: 'unassigned', label: 'Sem responsável' },
    ],
  },
  {
    key: 'provider',
    label: 'Canal',
    options: [
      { value: '', label: 'Todos canais' },
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'waha', label: 'WAHA' },
    ],
  },
] as const;

export interface ChatListFiltersProps {
  filters: ChatListFilterState;
  onChange: <K extends keyof ChatListFilterState>(key: K, value: ChatListFilterState[K]) => void;
  hasActiveFilters: boolean;
  onReset: () => void;

  /**
   * F30-S03: departamentos disponíveis para filtro (política de visibilidade).
   * Quando ausente ou vazio, o select de dept não é exibido.
   */
  departments?: ReadonlyArray<{ id: string; name: string }>;
  /** Departamento atualmente selecionado (id ou vazio). */
  selectedDept?: string;
  /** Callback disparado ao selecionar/limpar departamento. */
  onDeptChange?: (deptId: string) => void;

  /**
   * F30-S03: times disponíveis para filtro. Quando ausente ou vazio, não exibido.
   */
  teams?: ReadonlyArray<{ id: string; name: string }>;
  /** Time atualmente selecionado (id ou vazio). */
  selectedTeam?: string;
  /** Callback disparado ao selecionar/limpar time. */
  onTeamChange?: (teamId: string) => void;
}

export function ChatListFilters({
  filters,
  onChange,
  hasActiveFilters,
  onReset,
  departments,
  selectedDept = '',
  onDeptChange,
  teams,
  selectedTeam = '',
  onTeamChange,
}: ChatListFiltersProps) {
  const hasDepts = departments && departments.length > 0;
  const hasTeams = teams && teams.length > 0;
  const hasExtraFilters = Boolean(selectedDept || selectedTeam);

  return (
    <div className="flex flex-col gap-2 border-b border-border-2 px-3 py-3">
      {/* Busca */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-low"
          aria-hidden
        />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => onChange('search', e.target.value)}
          placeholder="Buscar conversa…"
          aria-label="Buscar conversa"
          className={cn(
            'h-9 w-full rounded-md border border-border-2 bg-surface-inset pl-9 pr-3',
            'font-body text-sm text-text placeholder:text-text-low',
            'outline-none transition-colors focus-visible:border-border focus-visible:shadow-glow-md',
          )}
        />
      </div>

      {/* Selects principais + filtros F30 + reset */}
      <div className="flex flex-wrap items-center gap-2">
        {SELECT_FILTERS.map((f) => {
          const value = filters[f.key];
          const active = Boolean(value);
          return (
            <select
              key={f.key}
              value={value}
              onChange={(e) => onChange(f.key, e.target.value)}
              aria-label={f.label}
              className={cn(
                'h-8 rounded-pill border px-3 font-body text-xs outline-none transition-colors',
                'focus-visible:shadow-glow-md',
                active
                  ? 'border-brand bg-surface-3 text-text'
                  : 'border-border-2 bg-surface-2 text-text-mid hover:text-text',
              )}
            >
              {f.options.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value} className="bg-surface text-text">
                  {opt.label}
                </option>
              ))}
            </select>
          );
        })}

        {/* F30-S03: Filtro por departamento */}
        {hasDepts && (
          <select
            value={selectedDept}
            onChange={(e) => onDeptChange?.(e.target.value)}
            aria-label="Departamento"
            className={cn(
              'h-8 rounded-pill border px-3 font-body text-xs outline-none transition-colors',
              'focus-visible:shadow-glow-md',
              selectedDept
                ? 'border-brand bg-surface-3 text-text'
                : 'border-border-2 bg-surface-2 text-text-mid hover:text-text',
            )}
          >
            <option value="" className="bg-surface text-text">
              Todos departs.
            </option>
            {departments!.map((d) => (
              <option key={d.id} value={d.id} className="bg-surface text-text">
                {d.name}
              </option>
            ))}
          </select>
        )}

        {/* F30-S03: Filtro por time */}
        {hasTeams && (
          <select
            value={selectedTeam}
            onChange={(e) => onTeamChange?.(e.target.value)}
            aria-label="Time"
            className={cn(
              'h-8 rounded-pill border px-3 font-body text-xs outline-none transition-colors',
              'focus-visible:shadow-glow-md',
              selectedTeam
                ? 'border-brand bg-surface-3 text-text'
                : 'border-border-2 bg-surface-2 text-text-mid hover:text-text',
            )}
          >
            <option value="" className="bg-surface text-text">
              Todos times
            </option>
            {teams!.map((t) => (
              <option key={t.id} value={t.id} className="bg-surface text-text">
                {t.name}
              </option>
            ))}
          </select>
        )}

        {(hasActiveFilters || hasExtraFilters) && (
          <button
            type="button"
            onClick={() => {
              onReset();
              onDeptChange?.('');
              onTeamChange?.('');
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-pill px-2.5',
              'font-body text-xs text-text-low outline-none transition-colors',
              'hover:text-text focus-visible:shadow-glow-md',
            )}
          >
            <X className="size-3.5" aria-hidden />
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}
