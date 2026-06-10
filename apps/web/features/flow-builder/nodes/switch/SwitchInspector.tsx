'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { TextField } from '../inspector-fields';

export function SwitchInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Variavel"
        value={(d['variable'] as string) ?? ''}
        placeholder="plano"
        onChange={(v) => set({ variable: v })}
      />
      <TextField
        label="Casos (virgula)"
        value={Array.isArray(d['cases']) ? (d['cases'] as string[]).join(', ') : ''}
        hint="Uma edge por caso + default"
        onChange={(v) =>
          set({
            cases: v
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean),
          })
        }
      />
    </div>
  );
}
