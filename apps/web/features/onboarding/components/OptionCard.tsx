'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  /** Ícone à esquerda (lucide já dimensionado pelo chamador). */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Conteúdo extra (ex.: chips de estágios do funil). */
  children?: ReactNode;
}

/**
 * Cartão selecionável acessível (radio-like). Toda a área é clicável (UX §2.1 —
 * ação primária = clique no corpo); foco visível via `shadow-glow-md`; estado
 * selecionado anunciado por `aria-pressed`. DS v2: tokens semânticos, zero hex.
 */
export function OptionCard({ selected, onSelect, icon, title, description, children }: OptionCardProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full flex-col gap-3 rounded-lg border bg-surface p-4 text-left outline-none transition-colors',
        'focus-visible:shadow-glow-md',
        selected
          ? 'border-accent ring-1 ring-accent'
          : 'border-border-subtle hover:border-border-strong',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {icon && (
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
              selected ? 'bg-accent/10 text-accent' : 'bg-surface-raised text-text-mid',
            )}
          >
            {icon}
          </span>
        )}
        {selected && <Check className="size-5 shrink-0 text-accent" aria-hidden />}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-text">{title}</h3>
        {description && <p className="text-sm text-text-mid">{description}</p>}
      </div>
      {children}
    </button>
  );
}
