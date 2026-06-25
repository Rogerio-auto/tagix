'use client';

import { useState } from 'react';
import { Workflow, Zap } from 'lucide-react';
import { can } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useNeonBorderSteady } from '@/shared/hooks/useNeonBorderSteady';
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
  // Barra larga (~900px): linha neon em velocidade constante e calma (volta mais
  // longa que o padrão 4.5s), para a luz não "correr" nem variar de ritmo.
  const neonRef = useNeonBorderSteady<HTMLDivElement>();

  if (!canTrigger) return null;
  const flows = manualFlows.data ?? [];
  if (flows.length === 0) return null;

  return (
    <>
      {/* Container externo: recebe a linha neon viva (não recorta o glow).
          A barra vira um cartão flutuante arredondado — acabamento premium
          consistente com o card de conversa ativo (.hm-flow-neon). */}
      <div ref={neonRef} className="hm-flow-neon relative mx-3 mb-1 mt-2 rounded-lg bg-surface-1">
        {/* Interno: rola horizontalmente quando há muitos flows (o overflow
            fica aqui para não cortar o brilho da borda). */}
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg px-3 py-2">
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
      </div>

      <TriggerConfirmModal
        flow={selected}
        conversationId={conversationId}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
