'use client';

import { useFlowEditor } from '../hooks/useFlowEditor';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';
import { nodeInspectors } from '../nodes/nodeInspectors';

/**
 * Container do inspector (FLOW_BUILDER secao 9.2): resolve qual inspector renderizar pelo node
 * selecionado. S11 substitui o corpo por inspectors ricos por tipo; aqui o scaffold edita o
 * `node.data` como JSON (suficiente para o canvas funcionar e o S11 nao tocar este shell).
 */
export function InspectorPanel() {
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const nodes = useFlowEditor((s) => s.nodes);

  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-border-2 bg-surface-1 p-4">
        <p className="text-sm text-text-low">Selecione um node para editar suas propriedades.</p>
      </aside>
    );
  }

  const kind = (node.type ?? 'message') as FlowNodeKind;
  const meta = NODE_CATALOG[kind];
  const NodeInspector = nodeInspectors[kind];

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-2 bg-surface-1 p-4">
      <div className="mb-3">
        <p className="font-head text-sm font-semibold text-text">{meta?.label ?? node.type}</p>
        <p className="text-xs text-text-low">ID: {node.id}</p>
        {meta?.deferred && (
          <p className="mt-1 text-xs text-warning">Este node entra em vigor na F5.</p>
        )}
      </div>

      <NodeInspector nodeId={node.id} />
    </aside>
  );
}
