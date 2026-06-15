/**
 * Pickers reutilizáveis do inspector de flows (F31-S03). Importe por nome a
 * partir deste barrel:
 *
 *   import { AgentPicker, StagePicker } from '@/features/flow-builder/inspector/pickers';
 *
 * Todos leem de `useFlowHelpers()` — exige `FlowHelpersAutoProvider` montado no
 * editor (ver shared/helpers-context). API estável; ver convenção de `value` em
 * resource-pickers.tsx.
 */
export { Combobox } from './Combobox';
export type { ComboboxOption, ComboboxProps } from './Combobox';

export {
  AgentPicker,
  ChannelPicker,
  TagPicker,
  StagePicker,
  PipelinePicker,
  ConversionTypePicker,
  MemberPicker,
  MetaFlowPicker,
  CustomFieldPicker,
} from './resource-pickers';
export type { PickerProps } from './resource-pickers';
