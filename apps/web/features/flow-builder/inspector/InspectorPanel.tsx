'use client';

import { Trash2 } from 'lucide-react';
import { useFlowEditor } from '../hooks/useFlowEditor';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';
import { nodeInspectors } from '../nodes/nodeInspectors';

/**
 * Container do inspector (FLOW_BUILDER secao 9.2): resolve qual inspector renderizar pelo node
 * selecionado. Expoe botao trash no header para delecao do node (guard: trigger nao pode ser
 * deletado — botao desabilitado com tooltip). F32-S01.
 */
export function InspectorPanel() {
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const nodes = useFlowEditor((s) => s.nodes);
  const deleteNodes = useFlowEditor((s) => s.deleteNodes);

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
  const isTrigger = node.type === 'trigger';

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-2 bg-surface-1 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-head text-sm font-semibold text-text">{meta?.label ?? node.type}</p>
          <p className="text-xs text-text-low">ID: {node.id}</p>
          {meta?.deferred && (
            <p className="mt-1 text-xs text-warning">Este node entra em vigor na F5.</p>
          )}
        </div>

        {/* Trash button — disabled for trigger node */}
        <div className="group relative shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!isTrigger) deleteNodes([node.id]);
            }}
            disabled={isTrigger}
            aria-label={isTrigger ? 'O gatilho não pode ser excluído' : 'Excluir node'}
            className="flex size-7 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus:border-destructive focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
          {/* Tooltip for trigger guard */}
          {isTrigger && (
            <div className="pointer-events-none absolute right-0 top-8 z-50 hidden w-max max-w-[180px] rounded-md border border-border-2 bg-surface-3 px-2.5 py-1.5 text-[11px] text-text shadow-md group-hover:block">
              O gatilho não pode ser excluído
            </div>
          )}
        </div>
      </div>

      <NodeInspector nodeId={node.id} />
    </aside>
  );
}
