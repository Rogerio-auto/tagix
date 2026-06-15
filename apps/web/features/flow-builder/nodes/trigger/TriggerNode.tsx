'use client';

// Node `trigger` (F31-S07): mostra o TIPO de gatilho configurado + um resumo legivel
// da config (palavras-chave, etapas, tags…). Le `node.data.{triggerType,triggerConfig}`
// e resolve nomes de etapa/tag via `useFlowHelpers` (provider do editor). E o no inicial:
// so handle de saida (nunca alvo).
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/shared/lib/cn';
import { NODE_CATALOG } from '../../shared/node-catalog';
import { useFlowHelpers } from '../../shared/helpers-context';
import {
  readTriggerConfig,
  readTriggerType,
  summarizeTrigger,
  TRIGGER_TYPE_OPTIONS,
} from './config';

export function TriggerNode({ data, selected }: NodeProps) {
  const meta = NODE_CATALOG['trigger'];
  const Icon = meta.icon;

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
    <div
      className={cn(
        'min-w-[184px] max-w-[240px] rounded-lg border bg-surface-2 px-3 py-2.5 shadow-sm transition-colors',
        selected ? 'border-accent' : 'border-border-2',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-text-low">Gatilho</p>
          <p className="truncate font-head text-sm font-medium text-text">{typeLabel}</p>
        </div>
      </div>

      {summary && (
        <p className="mt-1.5 truncate rounded bg-surface-3 px-2 py-1 text-[11px] text-text-mid">
          {summary}
        </p>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-text-low" />
    </div>
  );
}

TriggerNode.displayName = 'FlowNode_trigger';
