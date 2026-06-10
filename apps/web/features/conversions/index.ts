/** Conversões (F5-S13). MarkConversionButton é montável no ChatHeader/DealDrawer/
 * ContatoPanel (gap-fill do orchestrator). */
export { MarkConversionButton } from './MarkConversionButton';
export type { MarkConversionButtonProps } from './MarkConversionButton';
export { MarkConversionModal } from './MarkConversionModal';
export { ConversionsPage } from './ConversionsPage';
export { ConversionTypesSettings } from './ConversionTypesSettings';
export {
  useConversionTypes,
  useConversions,
  useRegisterConversion,
  useCancelConversion,
  useCreateConversionType,
  useDeleteConversionType,
} from './queries';
export type { ConversionType, ConversionEvent } from './types';
