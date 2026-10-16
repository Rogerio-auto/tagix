'use client';

// Node `trigger` (F31-S07): mostra o TIPO de gatilho configurado + um resumo legivel
// da config (palavras-chave, etapas, tags…). Le `node.data.{triggerType,triggerConfig}`
// e resolve nomes de etapa/tag via `useFlowHelpers` (provider do editor). E o no inicial:
// so handle de saída (nunca alvo). DS 3.0 (F72-S07): casco comum `NodeShell`.
import type { NodeProps } from '@xyflow/react';
import { NODE_CATALOG } from '../../shared/node-catalog';
import { useFlowHelpers } from '../../shared/helpers-context';
import { NodeShell } from '../BaseNode';
import {
  readTriggerConfig,
  readTriggerType,
  summarizeTrigger,
  TRIGGER_TYPE_OPTIONS,
} from './config';

export function TriggerNode({ data, selected }: NodeProps) {
  const meta = NODE_CATALOG['trigger'];

  const nodeData = (data ?? {}) as Record<string, unknown>;
  const triggerType = readTriggerType(nodeData);
  const config = readTriggerConfig(nodeData);

  const { stages, tags } = useFlowHelpers();
  const summary = summarizeTrigger(triggerType, config, {
    stageName: (id) => stages.find((s) => s.id === id)?.name,
    tagName: (id) => tags.find((t) => t.id === id)?.name,
  });

  const typeLabel =
    TRIGGER_TYPE_OPTIONS.find((o) => o.value === triggerType)?.label ?? meta.label;

  return (
    <NodeShell kind="trigger" selected={selected} eyebrow="Gatilho" title={typeLabel} noTarget>
      {summary && (
        <p className="mt-2 truncate rounded-xs border border-border bg-surface-2 px-2 py-1 text-xs text-text-mid">
          {summary}
        </p>
      )}
    </NodeShell>
  );
}

TriggerNode.displayName = 'FlowNode_trigger';
