'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { NumberField, TextAreaField } from '../inspector-fields';

export function WaitForResponseInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label="Mensagem (opcional)"
        value={(d['text'] as string) ?? ''}
        onChange={(v) => set({ text: v })}
      />
      <NumberField
        label="Timeout (minutos)"
        value={d['timeoutMinutes'] as number | undefined}
        hint="Edges: response / timeout"
        onChange={(v) => set({ timeoutMinutes: v })}
      />
    </div>
  );
}
