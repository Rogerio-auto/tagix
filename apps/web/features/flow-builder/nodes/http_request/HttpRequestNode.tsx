'use client';

// Node rico 'http_request' (F31-S05): mostra metodo + URL e os handles success/error.
// DS 3.0 (F72-S07): casco comum `NodeShell`; método e URL em mono.
import type { NodeProps } from '@xyflow/react';
import { NodeShell } from '../BaseNode';

export function HttpRequestNode({ data, selected }: NodeProps) {
  const d = (data ?? {}) as Record<string, unknown>;
  const method = ((d['method'] as string) ?? '') || 'GET';
  const url = (d['url'] as string) ?? '';

  return (
    <NodeShell kind="http_request" selected={selected}>
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 rounded-xs border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-mid">
          {method}
        </span>
        <span className="truncate font-mono text-xs text-text-low">{url || 'URL não definida'}</span>
      </div>
    </NodeShell>
  );
}
