'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextAreaField, TextField } from '../inspector-fields';

export function MessageInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Texto"
        value={(d['text'] as string) ?? ''}
        placeholder="Ola {{contact.name}}"
        onChange={(v) => set({ text: v })}
      />
      <TextField
        label="Midia (storage key)"
        value={(d['mediaUrl'] as string) ?? ''}
        onChange={(v) => set({ mediaUrl: v })}
      />
      <SelectField
        label="Pre-acao"
        value={((d['preAction'] as string) ?? '') || ''}
        options={[
          { value: '', label: 'Nenhuma' },
          { value: 'typing', label: 'Digitando' },
          { value: 'recording', label: 'Gravando' },
        ]}
        onChange={(v) => set({ preAction: v })}
      />
    </div>
  );
}
