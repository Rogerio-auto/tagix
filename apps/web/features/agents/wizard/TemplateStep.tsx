import { Bot, Headset, HelpCircle, MessageCircle, ShoppingBag, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import type { AgentTemplate } from '../types';

/** Ícone por key/categoria de template (fallback genérico). */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  sales: ShoppingBag,
  reception: MessageCircle,
  support: Headset,
  first_touch: UserPlus,
  follow_up: HelpCircle,
};

function iconFor(template: AgentTemplate): LucideIcon {
  return TEMPLATE_ICONS[template.key] ?? Bot;
}

export interface TemplateStepProps {
  templates: AgentTemplate[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (template: AgentTemplate) => void;
}

export function TemplateStep({ templates, loading, selectedId, onSelect }: TemplateStepProps) {
  if (loading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-border-2 bg-surface-inset px-4 py-6 text-center font-body text-sm text-text-low">
        Nenhum template disponível. Os templates da plataforma ainda não foram provisionados neste
        ambiente.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 font-body text-sm text-text-mid">
        Escolha o ponto de partida. Você poderá ajustar prompt, modelo e ferramentas depois.
      </p>
      {templates.map((template) => {
        const Icon = iconFor(template);
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            aria-pressed={selected}
            className={cn(
              'flex items-center gap-3 rounded-md border px-4 py-3 text-left outline-none',
              'transition-colors duration-200 focus-visible:shadow-glow-md',
              selected
                ? 'border-brand bg-brand/10'
                : 'border-border bg-surface-inset hover:border-border-2 hover:bg-surface-2',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-head text-sm font-semibold text-text">
                {template.name}
              </span>
              {template.description && (
                <span className="block font-body text-xs text-text-low">
                  {template.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
