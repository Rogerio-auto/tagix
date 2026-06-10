'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField } from '../inspector-fields';

export function ChangeStatusInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Novo status"
        value={((d['status'] as string) ?? '') || 'open'}
        options={[
          { value: 'open', label: 'Aberto' },
          { value: 'pending', label: 'Pendente' },
          { value: 'resolved', label: 'Resolvido' },
          { value: 'closed', label: 'Fechado' },
          { value: 'snoozed', label: 'Adiado' },
        ]}
        onChange={(v) => set({ status: v })}
      />
    </div>
  );
}
