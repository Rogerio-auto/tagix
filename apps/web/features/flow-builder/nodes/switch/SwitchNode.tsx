'use client';

/**
 * Node 'switch' (F32-S04). Renderiza handles de saída dinamicamente a partir de
 * node.data.cases, igual ao padrão do AbSplit. Sempre inclui handle 'default'.
 * DS 3.0 (F72-S07): casco comum `NodeShell`; casos e "padrão" em mono.
 */
import type { NodeProps } from '@xyflow/react';
import { NodeShell, type NodePort } from '../BaseNode';

function readCases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
}

export function SwitchNode({ data, selected }: NodeProps) {
  const nodeData = (data ?? {}) as Record<string, unknown>;
  const variable = typeof nodeData['variable'] === 'string' ? nodeData['variable'] : '';
  const cases = readCases(nodeData['cases']);

  // Dynamic edges: one per case + always a 'default' handle
  const ports: NodePort[] = [
    ...cases.map((c) => ({ id: c, label: c })),
    { id: 'default' },
  ];

  return (
    <NodeShell kind="switch" selected={selected} ports={ports}>
      {variable && (
        <p className="mt-2 truncate rounded-xs border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text-mid">
          {variable}
        </p>
      )}
    </NodeShell>
  );
}

SwitchNode.displayName = 'FlowNode_switch';
