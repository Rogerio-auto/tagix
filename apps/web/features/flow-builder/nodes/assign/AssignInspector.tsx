'use client';

// Inspector 'assign' (F31-S10). Atribui a conversa a um membro (alvo fixo) ou por
// estrategia automatica (rodizio/menos ocupado) sobre o time da conversa.
import { Info } from 'lucide-react';
import { MemberPicker } from '@/features/flow-builder/inspector/pickers';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField } from '../inspector-fields';

const STRATEGY_OPTIONS = [
  { value: 'specific', label: 'Membro específico' },
  { value: 'round_robin', label: 'Rodízio (round-robin)' },
  { value: 'least_busy', label: 'Menos ocupado' },
] as const;

export function AssignInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const strategy = ((d['strategy'] as string) ?? '') || 'specific';
  const memberId = (d['memberId'] as string) ?? undefined;

  const memberError =
    strategy === 'specific' && !memberId ? 'Selecione o membro que receberá a conversa.' : null;

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Estratégia"
        value={strategy}
        options={[...STRATEGY_OPTIONS]}
        onChange={(v) => set({ strategy: v })}
        hint={
          strategy === 'specific'
            ? 'A conversa é atribuída a um membro fixo.'
            : 'O membro é escolhido automaticamente dentro do time da conversa.'
        }
      />

      {strategy === 'specific' ? (
        <div className="flex flex-col gap-1.5">
          <MemberPicker
            label="Membro"
            value={memberId}
            onChange={(v) => set({ memberId: v })}
            hint="Quem passa a ser responsável pela conversa."
          />
          {memberError && <span className="text-[11px] text-danger">{memberError}</span>}
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-[11px] text-text-low">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            A distribuição usa o time já vinculado à conversa. Sem time vinculado, a atribuição é
            ignorada e a conversa permanece na fila.
          </span>
        </div>
      )}
    </div>
  );
}
