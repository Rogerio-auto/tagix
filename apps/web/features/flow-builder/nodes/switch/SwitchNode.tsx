'use client';

/**
 * Node 'switch' (F32-S04). Renderiza handles de saída dinamicamente a partir de
 * node.data.cases, igual ao padrão do AbSplit. Sempre inclui handle 'default'.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/shared/lib/cn';
import { NODE_CATALOG } from '../../shared/node-catalog';

function readCases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
}

export function SwitchNode({ data, selected }: NodeProps) {
  const meta = NODE_CATALOG['switch'];
  const Icon = meta.icon;

  const nodeData = (data ?? {}) as Record<string, unknown>;
  const variable = typeof nodeData['variable'] === 'string' ? nodeData['variable'] : '';
  const cases = readCases(nodeData['cases']);

  // Dynamic edges: one per case + always a 'default' handle
  const handles = [...cases, 'default'];

  return (
    <div
      className={cn(
        'min-w-[180px] rounded-lg border bg-surface-2 px-3 py-2.5 shadow-sm transition-colors',
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
          {variable && (
            <p className="truncate font-mono text-[11px] text-text-low">{variable}</p>
          )}
        </div>
      </div>

      {/* Dynamic output handles */}
      <div className="mt-2 flex justify-between gap-1">
        {handles.map((handle, i) => (
          <div key={handle} className="relative flex-1 text-center">
            <span
              className={cn(
                'text-[10px]',
                handle === 'default' ? 'text-text-low' : 'text-accent',
              )}
            >
              {handle}
            </span>
            <Handle
              type="source"
              id={handle}
              position={Position.Bottom}
              style={{ left: `${((i + 0.5) / handles.length) * 100}%` }}
              className="!bg-text-low"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

SwitchNode.displayName = 'FlowNode_switch';
