import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export interface StepperProps {
  steps: readonly string[];
  /** Índice do passo atual (0-based). */
  current: number;
}

/** Indicador de progresso do wizard multi-step (UX §2.3). */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progresso">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-pill font-head text-xs font-semibold',
                'transition-colors duration-200',
                done && 'bg-brand text-text-on-brand',
                active && 'bg-brand/20 text-brand ring-1 ring-brand',
                !done && !active && 'bg-surface-3 text-text-low',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden font-head text-xs font-medium sm:inline',
                active ? 'text-text' : 'text-text-low',
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px w-4 sm:w-6', done ? 'bg-brand' : 'bg-border-2')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
