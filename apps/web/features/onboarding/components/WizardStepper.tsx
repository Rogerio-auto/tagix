'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface WizardStepperProps {
  steps: ReadonlyArray<{ key: string; label: string }>;
  /** Índice (0-based) do passo atual. */
  current: number;
}

/**
 * Indicador de progresso do wizard (UX §2.8 — wizard com progresso visível), no DS 3.0
 * (F72-S07): números em mono, passo atual com o anel da marca (`brand-text`), concluídos
 * com check e o trilho preenchendo. Acessível: `aria-current` no passo ativo e contagem
 * textual para leitores de tela.
 */
export function WizardStepper({ steps, current }: WizardStepperProps): ReactNode {
  return (
    <nav aria-label="Progresso do onboarding">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.key} className="flex flex-1 items-center gap-2 last:flex-none">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-pill border font-mono text-xs font-semibold tabular-nums',
                  'transition-[background-color,border-color,color] duration-(--dur-base) ease-ds',
                  done && 'border-brand-text bg-brand-text text-bg',
                  active && 'border-brand-text bg-brand-text/10 text-brand-text',
                  !done && !active && 'border-border-2 text-text-low',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : index + 1}
              </span>
              <span
                className={cn(
                  'hidden truncate font-body text-sm sm:inline',
                  active ? 'font-semibold text-text' : 'text-text-low',
                )}
              >
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <span aria-hidden className="relative h-px min-w-4 flex-1 overflow-hidden bg-border-2">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 bg-brand-text motion-safe:transition-[width] motion-safe:duration-(--dur-slow) motion-safe:ease-ds',
                      done ? 'w-full' : 'w-0',
                    )}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">
        Passo {current + 1} de {steps.length}: {steps[current]?.label}
      </p>
    </nav>
  );
}
