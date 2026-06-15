'use client';

// Inspector 'register_conversion' (F31-S11, pickers fechados em F33-S03).
// Substitui o TextField de chave crua por ConversionTypePicker que consome
// GET /api/conversion-types via useFlowHelpers() (ja carregado pelo
// FlowHelpersAutoProvider do editor). Salva conversionTypeKey (a key do tipo,
// nao o id — o handler register_conversion usa key para lookup).
import { useMemo } from 'react';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field, NumberField, TextField } from '../inspector-fields';
import { Combobox, type ComboboxOption } from '../../inspector/pickers/Combobox';
import { useFlowHelpers } from '../../shared/helpers-context';

export function RegisterConversionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  const { conversionTypes, isLoading } = useFlowHelpers();

  const options = useMemo<ComboboxOption[]>(
    () =>
      conversionTypes.map((ct) => ({
        // Salva a key (nao o id) — e o que o handler register_conversion espera.
        value: ct.key,
        label: ct.name,
        hint: ct.key,
        color: ct.color,
      })),
    [conversionTypes],
  );

  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const conversionTypeKey = (d['conversionTypeKey'] as string) ?? '';
  const valueCents = d['valueCents'] as number | undefined;
  const note = (d['note'] as string) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <Combobox
        label="Tipo de conversão"
        value={conversionTypeKey || undefined}
        onChange={(key) => set({ conversionTypeKey: key })}
        options={options}
        loading={isLoading}
        placeholder="Selecionar tipo…"
        searchPlaceholder="Buscar tipo de conversão…"
        emptyLabel={isLoading ? 'Carregando…' : 'Nenhum tipo cadastrado'}
        hint="Cadastre tipos em Configurações → Conversões."
      />

      <NumberField
        label="Valor (centavos, opcional)"
        value={valueCents}
        hint='Obrigatório quando o tipo exige valor. Ex.: R$ 15,90 = 1590.'
        onChange={(v) => set({ valueCents: v })}
      />

      <TextField
        label="Nota (opcional)"
        value={note}
        placeholder="Ex.: Conversão registrada via flow de boas-vindas"
        hint="Texto livre até 1000 caracteres. Fica visível no histórico de conversões."
        onChange={(v) => set({ note: v })}
      />

      <Field label="Comportamento">
        <ul className="flex flex-col gap-1 text-[11px] text-text-low">
          <li>• A conversão é registrada no contato da conversa ativa.</li>
          <li>• Idempotente no mesmo dia: eventos duplicados são ignorados silenciosamente.</li>
          <li>• Sem contato ativo, o node é ignorado (no-op com log).</li>
        </ul>
      </Field>
    </div>
  );
}
