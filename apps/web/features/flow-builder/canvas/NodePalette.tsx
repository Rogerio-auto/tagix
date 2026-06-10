'use client';

import {
  CATEGORY_LABEL,
  NODE_CATALOG,
  NODE_KINDS,
  type FlowNodeKind,
  type NodeCategory,
} from '../shared/node-catalog';

const ORDER: NodeCategory[] = ['start', 'output', 'timing', 'logic', 'system', 'external'];

/**
 * Palette esquerda do editor (FLOW_BUILDER secao 9.2). Itens arrastaveis (HTML5 DnD) para o
 * canvas; o `dataTransfer` carrega o kind, lido no onDrop do FlowCanvas.
 */
export function NodePalette() {
  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-border-2 bg-surface-1 p-3">
      <p className="mb-2 font-head text-xs font-semibold uppercase tracking-wide text-text-low">
        Componentes
      </p>
      <div className="space-y-4">
        {ORDER.map((cat) => {
          const kinds = NODE_KINDS.filter((k) => NODE_CATALOG[k].category === cat);
          if (kinds.length === 0) return null;
          return (
            <div key={cat}>
              <p className="mb-1.5 text-[11px] font-medium text-text-low">{CATEGORY_LABEL[cat]}</p>
              <div className="space-y-1.5">
                {kinds.map((kind) => (
                  <PaletteItem key={kind} kind={kind} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PaletteItem({ kind }: { kind: FlowNodeKind }) {
  const meta = NODE_CATALOG[kind];
  const Icon = meta.icon;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/hm-flow-node', kind);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex cursor-grab items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-text transition-colors hover:border-accent active:cursor-grabbing"
    >
      <Icon className="size-4 text-text-low" aria-hidden />
      <span className="truncate">{meta.label}</span>
    </div>
  );
}
