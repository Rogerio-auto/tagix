'use client';

import { Trash2 } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useFlowEditor, type FlowEditorNode } from '../hooks/useFlowEditor';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';
import { nodeInspectors } from '../nodes/nodeInspectors';

/** Cabeçalho + form do node selecionado, reaproveitado no aside (desktop) e no Sheet (mobile). */
function InspectorBody({
  node,
  showDelete,
}: {
  node: FlowEditorNode;
  showDelete: boolean;
}): React.JSX.Element {
  const deleteNodes = useFlowEditor((s) => s.deleteNodes);
  const kind = (node.type ?? 'message') as FlowNodeKind;
  const meta = NODE_CATALOG[kind];
  const NodeInspector = nodeInspectors[kind];
  const isTrigger = node.type === 'trigger';

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-head text-sm font-semibold text-text">{meta?.label ?? node.type}</p>
          <p className="text-xs text-text-low">ID: {node.id}</p>
          {meta?.deferred && (
            <p className="mt-1 text-xs text-warning">Este node entra em vigor na F5.</p>
          )}
        </div>

        {/* Trash button — disabled for trigger node. Oculto no mobile read-first. */}
        {showDelete && (
          <div className="group relative shrink-0">
            <button
              type="button"
              onClick={() => {
                if (!isTrigger) deleteNodes([node.id]);
              }}
              disabled={isTrigger}
              aria-label={isTrigger ? 'O gatilho não pode ser excluído' : 'Excluir node'}
              className="flex size-7 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-text-low transition-colors hover:border-danger hover:text-danger focus:border-danger focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
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
        )}
      </div>

      <NodeInspector nodeId={node.id} />
    </>
  );
}

/**
 * Container do inspector (FLOW_BUILDER secao 9.2): resolve qual inspector renderizar pelo node
 * selecionado. Expoe botao trash no header para delecao do node (guard: trigger nao pode ser
 * deletado — botao desabilitado com tooltip). F32-S01.
 *
 * Mobile (< md, F36-S11): o inspector lateral vira full-`Sheet` (UX §2.3). Tocar um node no
 * canvas read-first seleciona + abre o sheet; fechar deseleciona. Como é read-first, o botão de
 * exclusão (edição estrutural) fica oculto no mobile.
 */
export function InspectorPanel() {
  const { isMobile } = useBreakpoint();
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const nodes = useFlowEditor((s) => s.nodes);
  const select = useFlowEditor((s) => s.select);

  const node = nodes.find((n) => n.id === selectedNodeId);

  // Mobile: inspector como full-sheet, montado/desmontado pelo node selecionado.
  if (isMobile) {
    const kind = node ? ((node.type ?? 'message') as FlowNodeKind) : null;
    const heading = kind ? (NODE_CATALOG[kind]?.label ?? node?.type) : 'Inspecionar node';
    return (
      <Sheet
        open={Boolean(node)}
        onClose={() => select(null)}
        variant="full"
        title={heading}
        ariaLabel="Propriedades do node"
      >
        {node && <InspectorBody node={node} showDelete={false} />}
      </Sheet>
    );
  }

  // Desktop (md+): aside lateral inalterado.
  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-border-2 bg-surface-1 p-4">
        <p className="text-sm text-text-low">Selecione um node para editar suas propriedades.</p>
      </aside>
    );
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-border-2 bg-surface-1 p-4">
      <InspectorBody node={node} showDelete />
    </aside>
  );
}
