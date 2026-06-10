'use client';

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
}

export function ChatListFilters({
  filters,
  onChange,
  hasActiveFilters,
  onReset,
}: ChatListFiltersProps) {
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

      {/* Selects + reset */}
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

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
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
