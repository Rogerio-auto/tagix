'use client';

/**
 * Grupo de cartões de escolha única (padrão WAI-ARIA radiogroup).
 *
 * Um Tab entra no grupo (no cartão escolhido), setas/Home/End movem a escolha,
 * Tab sai. O cartão inteiro é a área de clique (UX §2.1) e tem alvo ≥ 44 px no
 * toque. A marca de escolhido não usa o verde da marca — ele é do botão
 * principal do assistente.
 */
import type * as React from 'react';
import { useRef } from 'react';
import { cn } from '@/shared/lib/cn';
import { nextOptionIndex } from './model';

export interface ChoiceOption<T extends string> {
  readonly id: T;
  readonly title: string;
  readonly description?: React.ReactNode;
  /** Linha de destaque (ex.: a duração estimada). */
  readonly meta?: React.ReactNode;
}

export interface ChoiceGroupProps<T extends string> {
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T | null;
  readonly onChange: (next: T) => void;
  readonly disabled?: boolean;
  readonly columns?: 'two' | 'three' | 'four';
  readonly describedBy?: string;
}

export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  columns = 'two',
  describedBy,
}: ChoiceGroupProps<T>): React.JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((o) => o.id === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    const next = nextOptionIndex(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      className={cn(
        'grid gap-2',
        columns === 'two' && 'sm:grid-cols-2',
        columns === 'three' && 'sm:grid-cols-3',
        columns === 'four' && 'sm:grid-cols-2 xl:grid-cols-4',
      )}
    >
      {options.map((option, index) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'group relative flex min-h-11 w-full flex-col gap-1 rounded-md border p-3.5 text-left outline-none',
              'transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none',
              'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50',
              checked
                ? 'border-text-mid bg-surface-2 shadow-elev-1'
                : 'border-border bg-surface hover:border-border-2 hover:bg-surface-2',
            )}
          >
            <span className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-pill border transition-colors duration-150 motion-reduce:transition-none',
                  checked ? 'border-text bg-text' : 'border-border-2 bg-surface-inset',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-pill bg-surface transition-transform duration-150 motion-reduce:transition-none',
                    checked ? 'scale-100' : 'scale-0',
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-text">{option.title}</span>
                {option.description ? (
                  <span className="text-xs text-text-low">{option.description}</span>
                ) : null}
              </span>
            </span>
            {option.meta ? (
              <span className="pl-6.5 text-xs text-text-mid">{option.meta}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
