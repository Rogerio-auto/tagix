/**
 * Worker de lembretes de evento (F7-S05) — barrel. Composition surface para o
 * bootstrap: cron tick 5min (notifica organizer + outbound WhatsApp ao contato),
 * idempotente por `events.metadata.remindersSent`.
 */
export {
  CALENDAR_REMINDERS_LOCK_KEY,
  CALENDAR_REMINDERS_LOCK_TTL_MS,
  DEFAULT_REMINDERS_TICK_MS,
  DEFAULT_REMINDER_OFFSETS_MIN,
  OUTBOUND_QUEUE,
  OUTBOUND_JOB_TYPE,
  REMINDER_TEMPLATE_NAME,
  REMINDER_TEMPLATE_LANG,
  createReminderPorts,
  dueOffsets,
  runReminderTick,
  startReminderScheduler,
  type DueReminder,
  type EventMetadata,
  type ReminderDeps,
  type ReminderDbDeps,
  type ReminderPorts,
  type ReminderTickResult,
  type RedisLike,
} from './reminders';
