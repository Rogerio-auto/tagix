'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { NumberField } from '../inspector-fields';

export function WaitInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Minutos"
        value={d['minutes'] as number | undefined}
        onChange={(v) => set({ minutes: v })}
      />
      <NumberField
        label="Segundos"
        value={d['seconds'] as number | undefined}
        onChange={(v) => set({ seconds: v })}
      />
    </div>
  );
}
