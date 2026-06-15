'use client';

// Inspector 'register_conversion' (F31-S11). Registra uma conversao no workspace.
// O handler ja existe desde F5-S14; este inspector fecha o last-mile de UI.
// Campos: tipo de conversao (picker), valor em centavos (opcional, exigido quando
// conversionType.valueRequired=true), nota livre.
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { Field, NumberField, TextField } from '../inspector-fields';

export function RegisterConversionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  const conversionTypeKey = (d['conversionTypeKey'] as string) ?? '';
  const valueCents = d['valueCents'] as number | undefined;
  const note = (d['note'] as string) ?? '';

  // Derivar o tipo de conversao selecionado para mostrar hint de valor obrigatorio.
  // O picker expoe o `value` = conversionType.id, mas o handler usa `key`.
  // Como o picker usa o ID internamente e o handler usa a key, precisamos de um seam:
  // a UI salva `conversionTypeKey` (a key do tipo), e o picker e usado como seletor
  // por label (sem filtro por id). Para simplificar, o campo e um texto livre com hint.
  // TODO: quando o picker expuser a key diretamente, substituir o TextField pelo
  // ConversionTypePicker com `onChange((id) => set({ conversionTypeKey: lookupKey(id) }))`.

  const conversionTypeEmpty = conversionTypeKey.trim().length === 0;

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Chave do tipo de conversão"
        value={conversionTypeKey}
        placeholder="ex.: visita, compra, lead_qualificado"
        hint='Chave exata do tipo de conversão cadastrado em Configurações → Conversões.'
        onChange={(v) => set({ conversionTypeKey: v })}
      />

      {conversionTypeEmpty && (
        <span className="text-[11px] text-warning">Informe a chave do tipo de conversão.</span>
      )}

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
