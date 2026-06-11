/** Disponibilidade (F7-S07). Settings de availability_rules + exceptions. */
export { AvailabilityRulesSettings } from './AvailabilityRulesSettings';
export {
  useAvailabilityRules,
  useSaveAvailabilityRules,
  useAvailabilityExceptions,
  useCreateException,
  useDeleteException,
  useAvailabilitySlots,
  availabilityKeys,
} from './queries';
export type {
  AvailabilityRule,
  AvailabilityException,
  AvailabilitySlot,
  RuleInput,
  ExceptionInput,
  DayOfWeek,
} from './types';
