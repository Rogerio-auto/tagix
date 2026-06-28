/**
 * Feature cockpit-agenda (F53-S03). Modal LEVE de agendamento rápido a partir da
 * conversa, reutilizável pela card de Agenda do Cockpit (S04). Reusa `useCreateEvent`
 * de features/calendar — não duplica a criação de evento.
 */
export { QuickScheduleModal } from './QuickScheduleModal';
export {
  resolveQuickDate,
  toLocalParts,
  fromLocalParts,
  addMinutes,
  QUICK_DATE_OPTIONS,
  DEFAULT_DURATION_MIN,
} from './quickDates';
export type { QuickDateShortcut, QuickDateResult, QuickDateOption } from './quickDates';
export {
  EVENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
} from './types';
export type {
  QuickEventType,
  EventPriority,
  QuickScheduleModalProps,
  QuickScheduleCreatePayload,
} from './types';
