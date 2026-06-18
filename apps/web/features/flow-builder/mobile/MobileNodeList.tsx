'use client';

import { useReactFlow } from '@xyflow/react';
import { useFlowEditor } from '../hooks/useFlowEditor';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';

/**
 * Lista navegável de nodes (F36-S11 — mobile read-first). Substitui o palette de DnD (que não
 * faz sentido no toque): toque num item = selecionar + centralizar no canvas + abrir o inspector
 * como full-sheet (UX §2.1 — ação primária no corpo do item, não numa engrenagem).
 */
export function MobileNodeList(): React.JSX.Element {
  const nodes = useFlowEditor((s) => s.nodes);
  const selectedNodeId = useFlowEditor((s) => s.selectedNodeId);
  const select = useFlowEditor((s) => s.select);
  const { setCenter, getNode } = useReactFlow();

  const onPick = (id: string) => {
    select(id);
    const node = getNode(id);
    if (node) {
      void setCenter(node.position.x, node.position.y, { zoom: 1, duration: 300 });
    }
  };

  if (nodes.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-text-low">Este flow ainda não tem nodes.</p>
    );
  }

  return (
    <ul className="divide-y divide-border-2">
      {nodes.map((node) => {
        const kind = (node.type ?? 'message') as FlowNodeKind;
        const meta = NODE_CATALOG[kind];
        const Icon = meta?.icon;
        const rawName = node.data?.['label'] ?? node.data?.['name'];
        const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
        const isSelected = node.id === selectedNodeId;
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onPick(node.id)}
              aria-current={isSelected ? 'true' : undefined}
              className="touch-target flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none aria-[current=true]:bg-surface-2"
            >
              {Icon && (
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border-2 bg-surface-2 text-text-low">
                  <Icon className="size-4" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-head text-sm font-medium text-text">
                  {meta?.label ?? node.type}
                </span>
                {name && <span className="block truncate text-xs text-text-low">{name}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
