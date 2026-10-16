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
 * Cartão selecionável acessível (radio-like). Toda a área é clicável (UX §2.1 — ação
 * primária = clique no corpo); foco visível pelo anel do DS; estado selecionado anunciado
 * por `aria-pressed`. DS 3.0 (F72-S07): hairline em repouso, Lift no hover (só com
 * movimento permitido), selecionado com a borda e a tinta da marca (`brand-text`, que
 * passa ≥4,5:1 nos dois temas) e o check entrando em escala.
 */
export function OptionCard({ selected, onSelect, icon, title, description, children }: OptionCardProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group/option relative flex w-full flex-col gap-3 rounded-lg border p-4 text-left outline-none',
        'transition-[border-color,background-color,transform,box-shadow] duration-(--dur-slow) ease-ds-spring',
        'focus-visible:focus-ring',
        selected
          ? 'border-brand-text/60 bg-brand-text/[0.06] shadow-[inset_0_0_0_1px_var(--brand-text)]'
          : 'border-border bg-surface hover:border-border-2 hover:shadow-ds-2 motion-safe:hover:-translate-y-0.5',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {icon && (
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors duration-(--dur-base)',
              selected
                ? 'border-brand-text/30 bg-brand-text/10 text-brand-text'
                : 'border-border bg-surface-2 text-text-mid group-hover/option:text-text',
            )}
          >
            {icon}
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-pill border transition-[background-color,border-color,transform] duration-(--dur-base) ease-ds-spring',
            selected ? 'scale-100 border-brand-text bg-brand-text text-bg' : 'scale-90 border-border-2 text-transparent',
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-head text-base font-semibold text-text">{title}</h3>
        {description && <div className="font-body text-sm text-text-mid">{description}</div>}
      </div>
      {children}
    </button>
  );
}
