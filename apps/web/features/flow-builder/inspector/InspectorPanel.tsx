'use client';

import { useFlowEditor } from '../hooks/useFlowEditor';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';

/**
 * Container do inspector (FLOW_BUILDER secao 9.2): resolve qual inspector renderizar pelo node
 * selecionado. S11 substitui o corpo por inspectors ricos por tipo; aqui o scaffold edita o
 * `node.data` como JSON (suficiente para o canvas funcionar e o S11 nao tocar este shell).
 */
export function InspectorPanel() {
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const nodes = useFlowEditor((s) => s.nodes);
  const updateNodeData = useFlowEditor((s) => s.updateNodeData);

  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-border-2 bg-surface-1 p-4">
        <p className="text-sm text-text-low">Selecione um node para editar suas propriedades.</p>
      </aside>
    );
  }

  const meta = NODE_CATALOG[(node.type ?? 'message') as FlowNodeKind];

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-2 bg-surface-1 p-4">
      <div className="mb-3">
        <p className="font-head text-sm font-semibold text-text">{meta?.label ?? node.type}</p>
        <p className="text-xs text-text-low">ID: {node.id}</p>
        {meta?.deferred && (
          <p className="mt-1 text-xs text-warning">Este node entra em vigor na F5.</p>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-low">Dados do node (JSON)</span>
        <textarea
          className="min-h-[180px] rounded-md border border-border-2 bg-surface-2 px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
          defaultValue={JSON.stringify(node.data ?? {}, null, 2)}
          onBlur={(e) => {
            try {
              const parsed = JSON.parse(e.target.value || '{}') as Record<string, unknown>;
              updateNodeData(node.id, parsed);
            } catch {
              // JSON invalido: ignora (S11 troca por forms tipados, sem JSON cru).
            }
          }}
        />
      </label>
      <p className="mt-2 text-[11px] text-text-low">
        Editor de campos tipados por tipo de node entra na proxima iteracao (S11).
      </p>
    </aside>
  );
}
