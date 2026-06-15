'use client';

import { useMemo } from 'react';
import { FIELD_TYPE_LABELS } from '@/features/pipeline/custom-fields/types';
import { useFlowHelpers } from '../../shared/helpers-context';
import { Combobox, type ComboboxOption } from './Combobox';

/**
 * Pickers de recursos do inspector de flows (F31-S03). Cada um lê de
 * `useFlowHelpers()`, é pesquisável e controlado por value/onChange. Consumidos
 * por S04 (interactive), S05 (http), S06 (condition/notify/ai), S07 (triggers),
 * S08 (scaffold). API estável — não altere assinaturas sem coordenar.
 *
 * Convenção de `value` por picker:
 *   AgentPicker          → agent id
 *   ChannelPicker        → channel id
 *   TagPicker            → tag id
 *   StagePicker          → stage id      (filtra por `pipelineId` opcional)
 *   PipelinePicker       → pipeline id
 *   ConversionTypePicker → conversion type id
 *   MemberPicker         → member id
 *   MetaFlowPicker       → meta flow id  (aceita valor livre)
 *   CustomFieldPicker    → custom field key  (filtra por `pipelineId` opcional)
 */
export interface PickerProps {
  value: string | undefined;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}

interface PickerShellProps extends PickerProps {
  options: ComboboxOption[];
  defaultPlaceholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  allowCustom?: boolean;
}

/** Casca comum: liga as props do picker ao Combobox e ao estado de loading global. */
function PickerShell({
  options,
  defaultPlaceholder,
  searchPlaceholder,
  emptyLabel,
  allowCustom,
  placeholder,
  ...props
}: PickerShellProps) {
  const { isLoading } = useFlowHelpers();
  return (
    <Combobox
      value={props.value}
      onChange={props.onChange}
      options={options}
      label={props.label}
      hint={props.hint}
      disabled={props.disabled}
      id={props.id}
      ariaLabel={props.ariaLabel}
      loading={isLoading}
      placeholder={placeholder ?? defaultPlaceholder}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
      allowCustom={allowCustom}
    />
  );
}

export function AgentPicker(props: PickerProps) {
  const { agents } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () =>
      agents.map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.status !== 'active' ? a.status : undefined,
      })),
    [agents],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar agente"
      searchPlaceholder="Buscar agente…"
      emptyLabel="Nenhum agente disponível"
    />
  );
}

export function ChannelPicker(props: PickerProps) {
  const { channels } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () =>
      channels.map((c) => ({
        value: c.id,
        label: c.name,
        hint: !c.isActive ? 'inativo' : c.provider,
      })),
    [channels],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar canal"
      searchPlaceholder="Buscar canal…"
      emptyLabel="Nenhum canal conectado"
    />
  );
}

export function TagPicker(props: PickerProps) {
  const { tags } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () => tags.map((t) => ({ value: t.id, label: t.name, color: t.color })),
    [tags],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar tag"
      searchPlaceholder="Buscar tag…"
      emptyLabel="Nenhuma tag criada"
    />
  );
}

export function PipelinePicker(props: PickerProps) {
  const { pipelines } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () =>
      pipelines.map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.isDefault ? 'padrão' : undefined,
      })),
    [pipelines],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar pipeline"
      searchPlaceholder="Buscar pipeline…"
      emptyLabel="Nenhum pipeline"
    />
  );
}

/** `pipelineId` opcional: filtra as etapas de um pipeline específico. */
export function StagePicker({ pipelineId, ...props }: PickerProps & { pipelineId?: string }) {
  const { stages, pipelines } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(() => {
    const pipelineName = new Map(pipelines.map((p) => [p.id, p.name] as const));
    return stages
      .filter((s) => (pipelineId ? s.pipelineId === pipelineId : true))
      .map((s) => ({
        value: s.id,
        label: s.name,
        color: s.color,
        // Sem filtro de pipeline, mostra a origem para desambiguar.
        hint: pipelineId ? undefined : pipelineName.get(s.pipelineId),
      }));
  }, [stages, pipelines, pipelineId]);
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar etapa"
      searchPlaceholder="Buscar etapa…"
      emptyLabel="Nenhuma etapa"
    />
  );
}

export function ConversionTypePicker(props: PickerProps) {
  const { conversionTypes } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () => conversionTypes.map((ct) => ({ value: ct.id, label: ct.name, hint: ct.key, color: ct.color })),
    [conversionTypes],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar tipo de conversão"
      searchPlaceholder="Buscar tipo…"
      emptyLabel="Nenhum tipo de conversão"
    />
  );
}

export function MemberPicker(props: PickerProps) {
  const { members } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () => members.map((m) => ({ value: m.id, label: m.name, hint: m.email })),
    [members],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar membro"
      searchPlaceholder="Buscar membro…"
      emptyLabel="Nenhum membro"
    />
  );
}

/** Sem endpoint de listagem hoje — aceita valor livre (digite o Meta Flow ID). */
export function MetaFlowPicker(props: PickerProps) {
  const { metaFlows } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () => metaFlows.map((f) => ({ value: f.id, label: f.name })),
    [metaFlows],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Meta Flow ID"
      searchPlaceholder="Buscar ou digitar Meta Flow ID…"
      emptyLabel="Digite o Meta Flow ID"
      allowCustom
    />
  );
}

/** `pipelineId` opcional: filtra os campos de um pipeline específico. */
export function CustomFieldPicker({ pipelineId, ...props }: PickerProps & { pipelineId?: string }) {
  const { customFields } = useFlowHelpers();
  const options = useMemo<ComboboxOption[]>(
    () =>
      customFields
        .filter((f) => (pipelineId ? f.pipelineId === pipelineId : true))
        .map((f) => ({ value: f.key, label: f.name, hint: FIELD_TYPE_LABELS[f.type] })),
    [customFields, pipelineId],
  );
  return (
    <PickerShell
      {...props}
      options={options}
      defaultPlaceholder="Selecionar campo"
      searchPlaceholder="Buscar campo…"
      emptyLabel="Nenhum campo personalizado"
    />
  );
}
