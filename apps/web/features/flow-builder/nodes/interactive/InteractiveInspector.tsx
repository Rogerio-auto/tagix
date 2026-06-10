'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextAreaField } from '../inspector-fields';

export function InteractiveInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Tipo"
        value={((d['kind'] as string) ?? '') || 'buttons'}
        options={[
          { value: 'buttons', label: 'Botoes' },
          { value: 'list', label: 'Lista' },
        ]}
        onChange={(v) => set({ kind: v })}
      />
      <TextAreaField
        label="Corpo"
        value={(d['body'] as string) ?? ''}
        placeholder="Escolha uma opcao"
        onChange={(v) => set({ body: v })}
      />
    </div>
  );
}
