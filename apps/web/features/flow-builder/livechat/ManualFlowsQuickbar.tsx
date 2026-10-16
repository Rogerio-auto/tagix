'use client';

import { useId, useState } from 'react';
import { Workflow, Zap } from 'lucide-react';
import { can } from '@hm/shared';
import {
  READ_ONLY_CLASS,
  READ_ONLY_TOOLTIP,
  readOnlyActionProps,
  useIsReadOnly,
} from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useManualFlows, type ManualFlow } from './queries';
import { TriggerConfirmModal } from './TriggerConfirmModal';

/**
 * Quickbar de flows manuais acima do composer (FX-029d) no DS 3.0 (F72-S07). Discreta:
 * superfície silenciosa e hairline. A linha neon animada saiu — o DS 3.0 reserva movimento
 * contínuo para estado vivo, e a barra é uma prateleira de ações, não um estado.
 * Clique abre a confirmação. Gated por `flow.trigger` — sem permissão, nada é renderizado.
 *
 * Só leitura (F71-S17): os flows continuam focáveis, `aria-disabled` e descritos pela
 * explicação, que fica visível na própria barra (um tooltip seria cortado pela rolagem
 * horizontal).
 */
export function ManualFlowsQuickbar({ conversationId }: { conversationId: string }) {
  const role = useAuthStore((s) => s.auth?.role);
  const canTrigger = role ? can(role, 'flow.trigger') : false;
  const readOnly = useIsReadOnly();
  const manualFlows = useManualFlows();
  const [selected, setSelected] = useState<ManualFlow | null>(null);
  const descriptionId = useId();

  if (!canTrigger) return null;
  const flows = manualFlows.data ?? [];
  if (flows.length === 0) return null;

  return (
    <>
      <div
        role="group"
        aria-label="Flows manuais"
        className="mx-3 mb-1 mt-2 rounded-md border border-border bg-surface"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto px-2.5 py-1.5">
          <span className="flex shrink-0 items-center gap-1 pr-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-low">
            <Workflow className="size-3.5" aria-hidden />
            Flows
          </span>
          {flows.map((flow) => (
            <button
              key={flow.id}
              type="button"
              {...readOnlyActionProps<HTMLButtonElement>({
                readOnly,
                descriptionId,
                onClick: () => setSelected(flow),
              })}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1 rounded-pill border border-border bg-surface-2 px-2.5 text-xs font-medium text-text-mid outline-none',
                'transition-colors duration-(--dur-fast) ease-ds hover:border-border-2 hover:text-text focus-visible:focus-ring motion-reduce:transition-none',
                READ_ONLY_CLASS,
              )}
            >
              <Zap className="size-3 text-brand-text" aria-hidden />
              {flow.name}
            </button>
          ))}
        </div>
        {readOnly && (
          <p id={descriptionId} className="border-t border-border px-3 py-1.5 text-xs text-text-mid">
            {READ_ONLY_TOOLTIP}
          </p>
        )}
      </div>

      <TriggerConfirmModal flow={selected} conversationId={conversationId} onClose={() => setSelected(null)} />
    </>
  );
}
