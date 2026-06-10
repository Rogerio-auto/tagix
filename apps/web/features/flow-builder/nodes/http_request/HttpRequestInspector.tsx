'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextField } from '../inspector-fields';

export function HttpRequestInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Metodo"
        value={((d['method'] as string) ?? '') || 'GET'}
        options={[
          { value: 'GET', label: 'GET' },
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
          { value: 'DELETE', label: 'DELETE' },
        ]}
        onChange={(v) => set({ method: v })}
      />
      <TextField
        label="URL"
        value={(d['url'] as string) ?? ''}
        placeholder="https://api.exemplo.com/hook"
        hint="Edges: success / error"
        onChange={(v) => set({ url: v })}
      />
    </div>
  );
}
