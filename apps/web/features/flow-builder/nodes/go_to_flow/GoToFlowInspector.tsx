'use client';

// Inspector 'go_to_flow' (F31-S11, picker fechado em F33-S03).
// Substitui o TextField de UUID cru por FlowPicker que consome
// GET /api/flows via useFlows(), filtrado por status=active.
// O flow atual e excluido da lista para evitar loop auto-referente.
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Info } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field } from '../inspector-fields';
import { Combobox, type ComboboxOption } from '../../inspector/pickers/Combobox';
import { useFlows } from '../../list/queries';

export function GoToFlowInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);

  // Obtem o id do flow sendo editado a partir da URL (/flows/[id]/...).
  const params = useParams();
  const currentFlowId = typeof params?.['id'] === 'string' ? params['id'] : undefined;

  const flowsQuery = useFlows();
  const allFlows = flowsQuery.data?.flows ?? [];

  const options = useMemo<ComboboxOption[]>(
    () =>
      allFlows
        .filter((f) => f.status === 'active' && f.id !== currentFlowId)
        .map((f) => ({
          value: f.id,
          label: f.name,
          hint: f.triggerType,
        })),
    [allFlows, currentFlowId],
  );

  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const flowId = (d['flowId'] as string) ?? '';

  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const isLoading = flowsQuery.isLoading;

  return (
    <div className="flex flex-col gap-3">
      <Combobox
        label="Flow alvo"
        value={flowId || undefined}
        onChange={(id) => set({ flowId: id })}
        options={options}
        loading={isLoading}
        placeholder="Selecionar flow…"
        searchPlaceholder="Buscar flow…"
        emptyLabel={
          isLoading
            ? 'Carregando…'
            : allFlows.length === 0
              ? 'Nenhum flow publicado'
              : 'Nenhum flow ativo disponível'
        }
        hint="Apenas flows publicados (status ativo) são listados."
      />

      <Field label="Comportamento">
        <ul className="flex flex-col gap-1 text-[11px] text-text-low">
          <li>• A execução atual é encerrada ao chegar neste node.</li>
          <li>• Um novo fluxo é iniciado no flow alvo com o mesmo contato e conversa.</li>
          <li>• Máximo de 5 flows encadeados (proteção contra loop infinito).</li>
        </ul>
      </Field>

      <div className="flex items-start gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2 text-[11px] text-text-low">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          O flow alvo deve estar publicado (status ativo). Flows rascunho ou inativados são
          ignorados com log de aviso.
        </span>
      </div>
    </div>
  );
}
