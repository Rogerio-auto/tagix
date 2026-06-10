'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextField } from '../inspector-fields';

export function ConditionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Operador"
        value={((d['operator'] as string) ?? '') || 'MSG_CONTAINS'}
        options={[
          { value: 'MSG_CONTAINS', label: 'Mensagem contem' },
          { value: 'MSG_EQUALS', label: 'Mensagem igual' },
          { value: 'HAS_VALUE', label: 'Variavel preenchida' },
          { value: 'BUSINESS_HOURS', label: 'Horario comercial' },
          { value: 'HAS_TAG', label: 'Tem tag (F5)' },
          { value: 'IN_STAGE', label: 'Em etapa (F5)' },
        ]}
        onChange={(v) => set({ operator: v })}
      />
      <TextField
        label="Variavel"
        value={(d['variable'] as string) ?? ''}
        placeholder="trigger.message"
        onChange={(v) => set({ variable: v })}
      />
      <TextField
        label="Valor"
        value={(d['value'] as string) ?? ''}
        hint="Edges: true / false"
        onChange={(v) => set({ value: v })}
      />
    </div>
  );
}
