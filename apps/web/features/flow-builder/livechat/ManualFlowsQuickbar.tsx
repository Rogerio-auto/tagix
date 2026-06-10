'use client';

import { useState } from 'react';
import { Workflow, Zap } from 'lucide-react';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useManualFlows, type ManualFlow } from './queries';
import { TriggerConfirmModal } from './TriggerConfirmModal';

/**
 * Quickbar de flows manuais acima do composer (FX-029d). Discreta; click abre o modal de
 * confirmacao. Gated por `flow.trigger` — sem permissao, nada e renderizado.
 */
export function ManualFlowsQuickbar({ conversationId }: { conversationId: string }) {
  const role = useAuthStore((s) => s.auth?.role);
  const canTrigger = role ? can(role, 'flow.trigger') : false;
  const manualFlows = useManualFlows();
  const [selected, setSelected] = useState<ManualFlow | null>(null);

  if (!canTrigger) return null;
  const flows = manualFlows.data ?? [];
  if (flows.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-border-2 bg-surface-1 px-3 py-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-text-low">
          <Workflow className="size-3.5" aria-hidden />
          Flows
        </span>
        {flows.map((flow) => (
          <button
            key={flow.id}
            type="button"
            onClick={() => setSelected(flow)}
            className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent hover:text-accent"
          >
            <Zap className="size-3" aria-hidden />
            {flow.name}
          </button>
        ))}
      </div>

      <TriggerConfirmModal
        flow={selected}
        conversationId={conversationId}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
