'use client';

// Node rico 'http_request' (F31-S05): mostra metodo + URL e os handles success/error.
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/shared/lib/cn';
import { NODE_CATALOG } from '../../shared/node-catalog';

const META = NODE_CATALOG['http_request'];

export function HttpRequestNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as Record<string, unknown>;
  const method = ((d['method'] as string) ?? '') || 'GET';
  const url = (d['url'] as string) ?? '';
  const Icon = META.icon;

  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[240px] rounded-lg border bg-surface-2 px-3 py-2.5 shadow-sm transition-colors',
        selected ? 'border-accent' : 'border-border-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-text-low" />
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text">
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="truncate font-head text-sm font-medium text-text">{META.label}</p>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span className="shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-mid">
          {method}
        </span>
        <span className="truncate font-mono text-[11px] text-text-low">
          {url || 'URL nao definida'}
        </span>
      </div>

      <div className="mt-2 flex justify-between gap-2">
        {META.edges.map((edge, i) => (
          <div key={edge} className="relative flex-1 text-center">
            <span
              className={cn(
                'text-[10px]',
                edge === 'error' ? 'text-danger' : 'text-success',
              )}
            >
              {edge}
            </span>
            <Handle
              type="source"
              id={edge}
              position={Position.Bottom}
              style={{ left: `${((i + 0.5) / META.edges.length) * 100}%` }}
              className="!bg-text-low"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
