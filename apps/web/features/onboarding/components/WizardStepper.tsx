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
 * Indicador de progresso do wizard (UX §2.8 — wizard com progresso visível).
 * Acessível: `aria-current` no passo ativo e contagem textual para leitores de
 * tela. Passos concluídos mostram check; o atual é destacado; os futuros, suaves.
 */
export function WizardStepper({ steps, current }: WizardStepperProps): ReactNode {
  return (
    <nav aria-label="Progresso do onboarding">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.key} className="flex flex-1 items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                  done && 'border-accent bg-accent text-bg',
                  active && 'border-accent text-accent',
                  !done && !active && 'border-border-2 text-text-low',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <span
                className={cn(
                  'hidden truncate text-xs sm:inline',
                  active ? 'text-text' : 'text-text-low',
                )}
              >
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <span className={cn('h-px flex-1', done ? 'bg-accent' : 'bg-border-2')} aria-hidden />
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
