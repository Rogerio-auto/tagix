import { Check, Cpu, Eye, Lock, Wrench } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import type { AgentModel } from '../types';

export interface ModelStepProps {
  models: AgentModel[];
  loading: boolean;
  /** Modelo default do template — usado quando o catálogo está vazio. */
  defaultModel: string;
  selected: string | undefined;
  onSelect: (slug: string) => void;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Picker de modelo filtrado pela policy do workspace. Modelos com `allowed:false`
 * aparecem bloqueados (não selecionáveis). Quando `GET /api/agents/models` não
 * está disponível (catálogo vazio), cai no modelo default do template.
 */
export function ModelStep({ models, loading, defaultModel, selected, onSelect }: ModelStepProps) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-sm text-text-mid">
          O catálogo de modelos não está disponível neste ambiente. O agente usará o modelo padrão
          do template.
        </p>
        <div className="flex items-center gap-3 rounded-md border border-brand bg-brand/10 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
            <Cpu className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block font-head text-sm font-semibold text-text">{defaultModel}</span>
            <span className="block font-body text-xs text-text-low">Modelo padrão do template</span>
          </span>
          <Check className="ml-auto size-5 text-brand" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 font-body text-sm text-text-mid">
        Escolha o modelo. Apenas os modelos permitidos pela política do workspace são selecionáveis.
      </p>
      {models.map((model) => {
        const isSelected = model.slug === selected;
        const disabled = !model.allowed;
        return (
          <button
            key={model.slug}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onSelect(model.slug)}
            className={cn(
              'flex items-center gap-3 rounded-md border px-4 py-3 text-left outline-none',
              'transition-colors duration-200 focus-visible:shadow-glow-md',
              disabled && 'cursor-not-allowed opacity-50',
              !disabled && isSelected
                ? 'border-brand bg-brand/10'
                : 'border-border bg-surface-inset',
              !disabled && !isSelected && 'hover:border-border-2 hover:bg-surface-2',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
              {disabled ? <Lock className="size-5" aria-hidden /> : <Cpu className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-head text-sm font-semibold text-text">
                  {model.displayName}
                </span>
                {model.supportsTools && <Wrench className="size-3.5 text-text-low" aria-hidden />}
                {model.supportsVision && <Eye className="size-3.5 text-text-low" aria-hidden />}
              </span>
              <span className="block truncate font-body text-xs text-text-low">
                {model.provider} · {formatUsd(model.promptUsd)}/{formatUsd(model.completionUsd)} por 1M tok ·{' '}
                {model.contextWindow.toLocaleString('pt-BR')} ctx
              </span>
            </span>
            {disabled ? (
              <span className="shrink-0 rounded-pill bg-surface-3 px-2 py-0.5 font-head text-xs font-medium text-text-low">
                Bloqueado
              </span>
            ) : isSelected ? (
              <Check className="size-5 shrink-0 text-brand" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
