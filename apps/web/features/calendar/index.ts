/** Agenda (F7-S06). CalendarPage (FullCalendar) + EventForm/EventDetailModal. */
export { CalendarPage } from './CalendarPage';
// Boundary lazy de `/calendar` (F10-S10): tira `@fullcalendar/*` do First Load JS.
export { LazyCalendarPage } from './LazyCalendarPage';
export { EventForm } from './EventForm';
export { EventDetailModal } from './EventDetailModal';
// Visão agenda/dia do mobile (F36-S07). Gate por `isMobile` dentro da CalendarPage.
export { MobileAgenda } from './MobileAgenda';
export {
  useCalendars,
  useEvents,
  useEventDetail,
  useCreateEvent,
  useUpdateEvent,
  useCancelEvent,
  calendarKeys,
} from './queries';
export type {
  CalendarRow,
  EventRow,
  EventParticipantRow,
  CreateEventInput,
  UpdateEventInput,
  EventType,
  EventStatus,
  CalendarType,
} from './types';
