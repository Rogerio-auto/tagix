'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextField } from '../inspector-fields';

export function AiActionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Acao"
        value={((d['action'] as string) ?? '') || 'ACTIVATE'}
        options={[
          { value: 'ACTIVATE', label: 'Ativar IA' },
          { value: 'DEACTIVATE', label: 'Desativar IA' },
          { value: 'TRANSFER', label: 'Transferir agente' },
        ]}
        onChange={(v) => set({ action: v })}
      />
      <TextField
        label="Agente (id)"
        value={(d['agentId'] as string) ?? ''}
        onChange={(v) => set({ agentId: v })}
      />
    </div>
  );
}
