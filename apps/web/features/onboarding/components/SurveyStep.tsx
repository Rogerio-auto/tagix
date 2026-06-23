'use client';

import type { ReactNode } from 'react';
import { Input } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { getNicheOption } from '../niches';
import { GOAL_OPTIONS, TEAM_SIZE_OPTIONS } from '../survey';
import type { NicheKey, SurveyAnswers, SurveyGoal, TeamSize } from '../types';

export interface SurveyStepProps {
  value: SurveyAnswers;
  onChange: (next: SurveyAnswers) => void;
  /** Nicho sugerido a partir do objetivo (exibido como dica, não obrigatório). */
  suggestedNiche: NicheKey | null;
}

/**
 * Passo da mini-pesquisa (ONBOARDING.md §3.2): tipo de negócio, tamanho do time e
 * objetivo principal. Tudo opcional — o usuário pode avançar sem responder. O
 * objetivo pode sugerir um nicho (dica viva). Acessível: grupos com `fieldset`/
 * `legend`, opções como `aria-pressed`.
 */
export function SurveyStep({ value, onChange, suggestedNiche }: SurveyStepProps): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-head text-xl font-semibold text-text">Conte um pouco sobre você</h2>
        <p className="text-sm text-text-mid">Usamos isso para sugerir a melhor configuração. Pode pular o que quiser.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="onboarding-business" className="text-sm font-medium text-text">
          Que tipo de negócio você tem?
        </label>
        <Input
          id="onboarding-business"
          placeholder="Ex.: imobiliária, clínica odontológica, loja de roupas…"
          value={value.businessType ?? ''}
          maxLength={120}
          onChange={(e) => onChange({ ...value, businessType: e.target.value || undefined })}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">Qual o tamanho do seu time?</legend>
        <div className="flex flex-wrap gap-2">
          {TEAM_SIZE_OPTIONS.map((opt) => (
            <Chip<TeamSize>
              key={opt.value}
              label={opt.label}
              value={opt.value}
              selected={value.teamSize === opt.value}
              onToggle={(v) => onChange({ ...value, teamSize: value.teamSize === v ? undefined : v })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">Qual seu principal objetivo?</legend>
        <div className="flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((opt) => (
            <Chip<SurveyGoal>
              key={opt.value}
              label={opt.label}
              value={opt.value}
              selected={value.goal === opt.value}
              onToggle={(v) => onChange({ ...value, goal: value.goal === v ? undefined : v })}
            />
          ))}
        </div>
        {suggestedNiche && (
          <p className="mt-1 text-xs text-text-low" aria-live="polite">
            Com base nisso, vamos sugerir o nicho <span className="text-text">{getNicheOption(suggestedNiche).name}</span> no
            próximo passo — você pode trocar.
          </p>
        )}
      </fieldset>
    </div>
  );
}

interface ChipProps<T extends string> {
  label: string;
  value: T;
  selected: boolean;
  onToggle: (value: T) => void;
}

function Chip<T extends string>({ label, value, selected, onToggle }: ChipProps<T>): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(value)}
      className={cn(
        'rounded-pill border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:shadow-glow-md',
        selected
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border-2 text-text-mid hover:border-border-strong hover:text-text',
      )}
    >
      {label}
    </button>
  );
}
