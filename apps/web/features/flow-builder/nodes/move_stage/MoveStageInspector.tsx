'use client';

import { useFlowEditor } from '../../hooks/useFlowEditor';
import { useFlowHelpers } from '../../shared/helpers-context';
import { Field } from '../inspector-fields';

/**
 * Inspector move_stage (F32-S03). Substitui DeferredNotice por PipelinePicker +
 * StagePicker em cascata. O handler exige stageId + pipelineId (funcional desde F5).
 *
 * Fluxo: escolhe pipeline → StagePicker filtra stages dessa pipeline → salva ambos.
 * Mudar pipeline limpa stageId (evitar stage de outra pipeline).
 */
export function MoveStageInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const { pipelines, isLoading } = useFlowHelpers();

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const pipelineId = typeof d['pipelineId'] === 'string' ? d['pipelineId'] : '';
  const stageId = typeof d['stageId'] === 'string' ? d['stageId'] : '';

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const availableStages = selectedPipeline?.stages ?? [];

  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const handlePipelineChange = (newPipelineId: string) => {
    // Clear stageId when pipeline changes (avoid cross-pipeline stage mismatch)
    set({ pipelineId: newPipelineId, stageId: '' });
  };

  if (isLoading) {
    return (
      <div className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text-low">
        Carregando…
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text-low">
        Nenhum pipeline encontrado.{' '}
        <a href="/settings/pipeline" className="text-accent underline">
          Crie pipelines em Configurações
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Pipeline picker */}
      <Field label="Pipeline">
        <select
          value={pipelineId}
          onChange={(e) => handlePipelineChange(e.target.value)}
          className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
        >
          <option value="">Selecione um pipeline</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
      </Field>

      {/* 2. Stage picker — disabled until pipeline is selected */}
      <Field label="Etapa">
        <select
          value={stageId}
          onChange={(e) => set({ stageId: e.target.value })}
          disabled={!pipelineId}
          className="rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {pipelineId ? 'Selecione uma etapa' : 'Selecione uma pipeline primeiro'}
          </option>
          {availableStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      {/* Summary preview */}
      {selectedPipeline && stageId && (
        <div className="rounded-md border border-border-2 bg-surface-1 px-3 py-2">
          <p className="text-[11px] text-text-low">Mover para</p>
          <p className="text-sm text-text">
            {selectedPipeline.name} →{' '}
            {availableStages.find((s) => s.id === stageId)?.name ?? stageId}
          </p>
        </div>
      )}
    </div>
  );
}
