'use client';

import type { ReactNode } from 'react';
import { OptionCard } from './OptionCard';
import { NICHE_ICON, NICHE_OPTIONS } from '../niches';
import type { NicheKey } from '../types';

export interface NicheStepProps {
  selected: NicheKey | null;
  /** Nicho sugerido pela pesquisa (recebe um selo "Sugerido"). */
  suggested: NicheKey | null;
  onSelect: (niche: NicheKey) => void;
}

/**
 * Passo de escolha de nicho (ONBOARDING.md §3.2): grid dos 7 nichos. Cada cartão é
 * clicável por inteiro (UX §2.1), mostra o ícone, a proposta de valor e uma prévia
 * dos estágios do funil que serão criados. O nicho sugerido pela pesquisa ganha um
 * selo. Aplicar é responsabilidade do wizard (footer).
 */
export function NicheStep({ selected, suggested, onSelect }: NicheStepProps): ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-head text-xl font-semibold text-text">Escolha o seu nicho</h2>
        <p className="text-sm text-text-mid">
          Vamos criar um funil pronto, um agente de IA, etiquetas e fluxos sob medida. Você ajusta tudo depois.
        </p>
      </div>

      <div role="radiogroup" aria-label="Nichos disponíveis" className="grid gap-3 sm:grid-cols-2">
        {NICHE_OPTIONS.map((option) => {
          const Icon = NICHE_ICON[option.key];
          const isSuggested = suggested === option.key;
          return (
            <OptionCard
              key={option.key}
              selected={selected === option.key}
              onSelect={() => onSelect(option.key)}
              icon={<Icon className="size-5" aria-hidden />}
              title={option.name}
              description={
                <>
                  {isSuggested && (
                    <span className="mb-1 inline-block rounded-pill bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                      Sugerido para você
                    </span>
                  )}
                  <span className="block">{option.description}</span>
                </>
              }
            >
              <ul className="flex flex-wrap gap-1.5">
                {option.stages.map((stage) => (
                  <li key={stage} className="rounded-pill bg-surface-raised px-2 py-0.5 text-xs text-text-low">
                    {stage}
                  </li>
                ))}
              </ul>
            </OptionCard>
          );
        })}
      </div>
    </div>
  );
}
