'use client';

import { AgentPicker } from '@/features/flow-builder/inspector/pickers';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField } from '../inspector-fields';

const ACTION_OPTIONS = [
  { value: 'ACTIVATE', label: 'Ativar IA (definir agente)' },
  { value: 'DEACTIVATE', label: 'Desativar IA' },
  { value: 'TRANSFER', label: 'Transferir para outro agente' },
] as const;

export function AiActionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const action = ((d['action'] as string) ?? '') || 'ACTIVATE';
  const agentId = (d['agentId'] as string) ?? undefined;
  const needsAgent = action !== 'DEACTIVATE';

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Ação"
        value={action}
        options={[...ACTION_OPTIONS]}
        onChange={(v) => set({ action: v })}
      />

      {needsAgent ? (
        <>
          <AgentPicker
            label="Agente"
            value={agentId}
            onChange={(v) => set({ agentId: v })}
            hint="A IA assume a conversa com este agente."
          />
          {!agentId && <span className="text-[11px] text-danger">Selecione um agente.</span>}
        </>
      ) : (
        <p className="text-xs text-text-low">
          A IA será desligada nesta conversa. O atendimento volta a ser humano.
        </p>
      )}
    </div>
  );
}
