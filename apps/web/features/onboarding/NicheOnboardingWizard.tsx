'use client';

import { useState } from 'react';
import { ArrowRight, Building2, Check, Stethoscope } from 'lucide-react';
import { Button, Card, CardBody, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { NICHE_OPTIONS } from './niches';
import { useInstantiateNiche } from './queries';
import type { NicheKey } from './types';

const NICHE_ICON: Record<NicheKey, typeof Building2> = {
  real_estate: Building2,
  clinic: Stethoscope,
};

export interface NicheOnboardingWizardProps {
  /** Chamado após criar o pipeline (+ agente) — ex.: navegar para o pipeline. */
  onComplete?: (result: { pipelineId: string; agentId: string | null }) => void;
}

/**
 * Wizard de onboarding por nicho (F5-S15): escolhe imobiliária ou clínica e cria
 * o pipeline do template (+ agente opcional) no workspace atual. DS v2: tokens
 * semânticos, dark-first, zero hex em JSX.
 */
export function NicheOnboardingWizard({ onComplete }: NicheOnboardingWizardProps): React.JSX.Element {
  const [selected, setSelected] = useState<NicheKey | null>(null);
  const [createAgent, setCreateAgent] = useState(true);
  const { toast } = useToast();
  const instantiate = useInstantiateNiche();

  async function handleCreate(): Promise<void> {
    if (!selected) return;
    try {
      const result = await instantiate.mutateAsync({ niche: selected, createAgent });
      toast({ variant: 'success', title: 'Funil criado a partir do nicho.' });
      onComplete?.(result);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Não foi possível criar o funil. Tente novamente.';
      toast({ variant: 'error', title: message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-text">Comece por um nicho</h2>
        <p className="text-sm text-text-mid">
          Criamos um funil pronto (estágios + campos) e, se quiser, um agente de IA já configurado.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {NICHE_OPTIONS.map((option) => {
          const Icon = NICHE_ICON[option.key];
          const isSelected = selected === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelected(option.key)}
              aria-pressed={isSelected}
              className="text-left focus:outline-none"
            >
              <Card
                elevation={isSelected ? 3 : 1}
                className={
                  isSelected
                    ? 'border-accent ring-1 ring-accent transition'
                    : 'border-border-subtle transition hover:border-border-strong'
                }
              >
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-surface-raised text-accent">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    {isSelected ? <Check className="size-5 text-accent" aria-hidden /> : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium text-text">{option.name}</h3>
                    <p className="text-sm text-text-mid">{option.description}</p>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {option.stages.map((stage) => (
                      <li
                        key={stage}
                        className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-low"
                      >
                        {stage}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-sm text-text-mid">
        <input
          type="checkbox"
          checked={createAgent}
          onChange={(e) => setCreateAgent(e.target.checked)}
          className="size-4 accent-[var(--color-accent)]"
        />
        Criar também um agente de IA a partir do template do nicho
      </label>

      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={!selected || instantiate.isPending}
          onClick={() => void handleCreate()}
        >
          {instantiate.isPending ? 'Criando…' : 'Criar funil'}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
