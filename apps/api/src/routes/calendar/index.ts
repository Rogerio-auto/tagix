/**
 * Agregador das rotas do dominio Calendar (CALENDAR.md §7). Montado em app.ts.
 * calendars/availability (F7-S02) + events (F7-S03).
 */
import { Router } from 'express';
import { createCalendarsRouter } from './calendars';
import { createAvailabilityRouter } from './availability';
import { createEventsRouter } from './events';

export function createCalendarRouter(): Router {
  const router = Router();
  router.use(createCalendarsRouter());
  router.use(createAvailabilityRouter());
  router.use(createEventsRouter());
  return router;
}
