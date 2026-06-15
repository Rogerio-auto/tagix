'use client';

import { StagePicker, TagPicker } from '@/features/flow-builder/inspector/pickers';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { SelectField, TextField } from '../inspector-fields';
import { BusinessHoursField, readBusinessHours, type BusinessHoursValue } from './BusinessHoursField';

const OPERATOR_OPTIONS = [
  { value: 'MSG_CONTAINS', label: 'Mensagem contém' },
  { value: 'MSG_EQUALS', label: 'Mensagem igual a' },
  { value: 'HAS_VALUE', label: 'Variável preenchida' },
  { value: 'BUSINESS_HOURS', label: 'Horário comercial' },
  { value: 'HAS_TAG', label: 'Contato tem a tag' },
  { value: 'IN_STAGE', label: 'Contato na etapa' },
] as const;

export function ConditionInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data ?? {}) as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);
  const operator = ((d['operator'] as string) ?? '') || 'MSG_CONTAINS';

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Condição"
        value={operator}
        options={[...OPERATOR_OPTIONS]}
        onChange={(v) => set({ operator: v })}
      />

      {(operator === 'MSG_CONTAINS' || operator === 'MSG_EQUALS') && (
        <>
          <TextField
            label="Variável"
            value={(d['variable'] as string) ?? ''}
            placeholder="trigger.message"
            hint="Caminho da variável a comparar (sem chaves)."
            onChange={(v) => set({ variable: v })}
          />
          <TextField
            label="Texto a comparar"
            value={(d['value'] as string) ?? ''}
            placeholder="comprar"
            onChange={(v) => set({ value: v })}
          />
        </>
      )}

      {operator === 'HAS_VALUE' && (
        <TextField
          label="Variável"
          value={(d['variable'] as string) ?? ''}
          placeholder="webhook_response.body"
          hint="Verdadeiro quando a variável tem valor."
          onChange={(v) => set({ variable: v })}
        />
      )}

      {operator === 'HAS_TAG' && (
        <TagPicker
          label="Tag"
          value={(d['tagId'] as string) ?? undefined}
          onChange={(v) => set({ tagId: v })}
          hint="Verdadeiro se o contato tiver esta tag."
        />
      )}

      {operator === 'IN_STAGE' && (
        <StagePicker
          label="Etapa"
          value={(d['stageId'] as string) ?? undefined}
          onChange={(v) => set({ stageId: v })}
          hint="Verdadeiro se o contato tiver um negócio aberto nesta etapa."
        />
      )}

      {operator === 'BUSINESS_HOURS' && (
        <BusinessHoursField
          value={readBusinessHours(d['businessHours'])}
          onChange={(bh: BusinessHoursValue) => set({ businessHours: bh })}
        />
      )}

      <p className="text-[11px] text-text-low">
        Saídas: <span className="text-text-mid">verdadeiro</span> /{' '}
        <span className="text-text-mid">falso</span>.
      </p>
    </div>
  );
}
