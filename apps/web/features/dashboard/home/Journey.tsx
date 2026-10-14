'use client';

/**
 * Da conversa ao fechamento. Quatro números do período em sequência, ligados por uma
 * linha: leads que entraram, conversas abertas, compromissos marcados e negócios
 * ganhos. É volume por etapa, não funil de conversão: as etapas medem coisas
 * diferentes (um lead pode nunca abrir conversa), então não há barra proporcional
 * nem taxa que pareça mais precisa do que o dado.
 */
import type * as React from 'react';
import { useId } from 'react';
import Link from 'next/link';
import { Panel } from './Panel';
import { formatKpiValue } from './home-format';
import type { HomeJourney } from './types';

const STEPS: readonly { key: keyof HomeJourney; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'conversations', label: 'Conversas' },
  { key: 'booked', label: 'Agendados' },
  { key: 'won', label: 'Ganhos' },
];

export function Journey({
  journey,
  periodDays,
}: {
  journey: HomeJourney;
  periodDays: number;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <Panel
      id={titleId}
      eyebrow={`${periodDays} dias`}
      title="Da conversa ao fechamento"
      aside={
        <Link
          href="/pipeline"
          className="rounded-sm font-body text-sm font-bold text-brand-text hover:underline focus-visible:focus-ring"
        >
          Ver pipeline
        </Link>
      }
    >
      <ol className="grid grid-cols-4 gap-2 px-4 py-5 sm:px-6 sm:py-6">
        {STEPS.map((step, i) => (
          <li key={step.key} className="min-w-0">
            <div className="flex items-center" aria-hidden>
              <span
                className={
                  i === STEPS.length - 1
                    ? 'size-2.5 shrink-0 rounded-pill bg-success'
                    : 'size-2.5 shrink-0 rounded-pill border-2 border-text-low bg-surface'
                }
              />
              {i < STEPS.length - 1 && <span className="ml-2 h-px flex-1 bg-border-2" />}
            </div>
            <p className="mt-3 truncate font-mono text-h4 font-medium tabular-nums tracking-tight text-text sm:text-h3">
              {formatKpiValue({ unit: 'count', value: journey[step.key] })}
            </p>
            <p className="truncate font-mono text-xs font-medium uppercase tracking-widest text-text-low">
              {step.label}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
