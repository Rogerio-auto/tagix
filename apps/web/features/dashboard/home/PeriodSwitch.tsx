'use client';

/**
 * Janela da Home (7 / 30 / 90 dias) — o "30 DAYS ▾" da maquete, como controle
 * segmentado em mono. Grupo de botões com `aria-pressed` (o estado é dito, não só
 * pintado) e setas para trocar sem sair do grupo (UX §2.10). A troca é imediata e os
 * números anteriores ficam esmaecidos até os novos chegarem (UX §2.7).
 */
import type * as React from 'react';
import { useRef } from 'react';
import { cn } from '@/shared/lib/cn';
import { HOME_PERIODS, type HomePeriodDays } from './types';

export function PeriodSwitch({
  value,
  onChange,
  pending = false,
}: {
  value: HomePeriodDays;
  onChange: (days: HomePeriodDays) => void;
  pending?: boolean;
}): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = HOME_PERIODS.indexOf(value);
    const nextIndex =
      (at + (e.key === 'ArrowRight' ? 1 : -1) + HOME_PERIODS.length) % HOME_PERIODS.length;
    const next = HOME_PERIODS[nextIndex];
    if (next === undefined) return;
    onChange(next);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="group"
      aria-label="Período"
      aria-busy={pending || undefined}
      onKeyDown={onKey}
      className="inline-flex h-10 items-center rounded-md border border-border bg-surface p-0.5 sm:h-8"
    >
      {HOME_PERIODS.map((days, i) => {
        const active = days === value;
        return (
          <button
            key={days}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={active}
            aria-label={`Últimos ${days} dias`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(days)}
            className={cn(
              'h-full min-w-11 rounded-sm px-2.5 font-mono text-xs font-medium uppercase tabular-nums tracking-widest',
              'focus-visible:focus-ring motion-safe:transition-colors',
              active ? 'bg-surface-3 text-text' : 'text-text-low hover:text-text',
            )}
          >
            {days}d
          </button>
        );
      })}
    </div>
  );
}
