'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { TextField } from '../inspector-fields';

export function MetaFlowInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Meta Flow ID"
        value={(d['metaFlowId'] as string) ?? ''}
        onChange={(v) => set({ metaFlowId: v })}
      />
      <TextField
        label="Texto do CTA"
        value={(d['ctaText'] as string) ?? ''}
        onChange={(v) => set({ ctaText: v })}
      />
    </div>
  );
}
