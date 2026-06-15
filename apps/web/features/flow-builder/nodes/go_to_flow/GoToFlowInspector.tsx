'use client';

// Inspector 'go_to_flow' (F31-S11). Encadeia para outro flow publicado do workspace.
// Sem endpoint de listagem de flows hoje — o ID e digitado diretamente (igual ao
// MetaFlowPicker). SEAM: quando /api/flows disponibilizar listagem publica,
// substituir o TextField por um FlowPicker baseado no Combobox.
import { Info } from 'lucide-react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field, TextField } from '../inspector-fields';

export function GoToFlowInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const flowId = (d['flowId'] as string) ?? '';

  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const isValidUuid =
    flowId.trim().length === 0 ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(flowId.trim());

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="ID do flow alvo"
        value={flowId}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        hint="UUID do flow publicado neste workspace."
        onChange={(v) => set({ flowId: v })}
      />

      {!isValidUuid && (
        <span className="text-[11px] text-danger">
          Formato inválido. Use o UUID do flow (ex.: da URL /flows/uuid/edit).
        </span>
      )}

      {flowId.trim().length === 0 && (
        <span className="text-[11px] text-warning">Informe o ID do flow de destino.</span>
      )}

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
