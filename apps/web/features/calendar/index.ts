/** Agenda — Calendar 2.0 (F37). CalendarPage (FullCalendar) + trilha + form/detalhe 2.0. */
export { CalendarPage } from './CalendarPage';
// Boundary lazy de `/calendar` (F10-S10): tira `@fullcalendar/*` do First Load JS.
export { LazyCalendarPage } from './LazyCalendarPage';
export { EventForm } from './EventForm';
export { EventDetailModal } from './EventDetailModal';
// Visão agenda/dia do mobile (F36-S07). Gate por `isMobile` dentro da CalendarPage.
export { MobileAgenda } from './MobileAgenda';
// Visão "Lista" — follow-ups por dia (F54-S03). Toggle dentro da CalendarPage.
export { AgendaListView } from './AgendaListView';
export {
  buildAgendaList,
  groupAgendaByDay,
  selectAgendaEvents,
  isOverdue,
  isTerminalStatus,
  dayRelative,
} from './agendaList';
export type { AgendaDayGroup, AgendaListItem, DayRelative } from './agendaList';
// Trilha multi-calendário (S03) — reusada pelo mobile (S04) como sheet.
export { CalendarRail, CalendarLegend, buildRailGroups } from './CalendarRail';
export type { CalendarRailProps, CalendarLegendProps, RailGroup, RailCalendar } from './CalendarRail';
export {
  useCalendars,
  useCalendarMembers,
  useEvents,
  useEventDetail,
  useCreateEvent,
  useUpdateEvent,
  useCancelEvent,
  useRsvpEvent,
  useCalendarSelection,
  calendarKeys,
} from './queries';
export type { UseEventsParams, CalendarSelection, RsvpInput } from './queries';
export {
  masterEventId,
  isOccurrence,
  buildRecurrenceRule,
  parseRecurrenceForForm,
  describeRecurrence,
  WEEKDAY_CODES,
} from './types';
export type {
  CalendarRow,
  EventRow,
  EventContactSummary,
  EventParticipantRow,
  CalendarMember,
  CreateEventInput,
  UpdateEventInput,
  EventType,
  EventStatus,
  EventPriority,
  CalendarType,
  RecurrenceMode,
  WeekdayCode,
} from './types';
