'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { NODE_CATALOG, type FlowNodeKind } from '../shared/node-catalog';

/**
 * Node base do canvas (F4-S10 scaffold). Renderiza icone+label+handles a partir do catalogo.
 * S11 substitui as pastas `nodes/<tipo>/` por componentes ricos; ate la, todo node usa este
 * shell (compila e desenha o grafo). Nodes `deferred` (F5) mostram aviso.
 */
export function BaseNode({ kind, selected }: { kind: FlowNodeKind; selected?: boolean }) {
  const meta = NODE_CATALOG[kind];
  const Icon = meta.icon;
  const hasMultiOut = meta.edges.length > 1;

  return (
    <div
      className={cn(
        'min-w-[160px] rounded-lg border bg-surface-2 px-3 py-2.5 shadow-sm transition-colors',
        selected ? 'border-accent' : 'border-border-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-text-low" />
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-head text-sm font-medium text-text">{meta.label}</p>
          {meta.deferred && (
            <span className="inline-flex items-center gap-1 text-[10px] text-warning">
              <AlertTriangle className="size-3" aria-hidden />
              Disponivel na F5
            </span>
          )}
        </div>
      </div>

      {hasMultiOut ? (
        <div className="mt-2 flex justify-between gap-2">
          {meta.edges.map((edge, i) => (
            <div key={edge} className="relative flex-1 text-center">
              <span className="text-[10px] text-text-low">{edge}</span>
              <Handle
                type="source"
                id={edge}
                position={Position.Bottom}
                style={{ left: `${((i + 0.5) / meta.edges.length) * 100}%` }}
                className="!bg-text-low"
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-text-low" />
      )}
    </div>
  );
}

/** Cria o componente de node ligado a um kind (consumido pelo nodeTypes registry). */
export function makeNodeComponent(kind: FlowNodeKind) {
  function NodeComponent(props: NodeProps) {
    return <BaseNode kind={kind} selected={props.selected} />;
  }
  NodeComponent.displayName = `FlowNode_${kind}`;
  return NodeComponent;
}
