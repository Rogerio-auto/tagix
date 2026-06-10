'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextAreaField, TextField } from '../inspector-fields';

export function ExternalNotifyInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Destino"
        value={((d['target'] as string) ?? '') || 'RESPONSIBLE'}
        options={[
          { value: 'RESPONSIBLE', label: 'Responsavel' },
          { value: 'ENTITY_CUSTOMER', label: 'Cliente' },
          { value: 'FLOW_CONTACT', label: 'Contato do flow' },
          { value: 'CUSTOM', label: 'Telefone custom' },
        ]}
        onChange={(v) => set({ target: v })}
      />
      <TextField
        label="Canal (id)"
        value={(d['channelId'] as string) ?? ''}
        onChange={(v) => set({ channelId: v })}
      />
      <TextAreaField
        label="Mensagem"
        value={(d['text'] as string) ?? ''}
        onChange={(v) => set({ text: v })}
      />
    </div>
  );
}
