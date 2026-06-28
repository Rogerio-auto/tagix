/**
 * Dominio Calendar (DATA_MODEL 12 + CALENDAR.md).
 * 5 tabelas: calendars / availability_rules / availability_exceptions / events /
 * event_participants.
 *
 * `event_participants` NAO tem workspace_id proprio -> RLS via subquery em events
 * (espelha agent_tools / campaign_steps / flow_versions).
 *
 * `team_id` em calendars NAO tem FK: a tabela `teams` ainda nao existe no schema
 * (entra em F1+). Mantemos a coluna uuid solta como em routing_history p/ FKs futuras.
 *
 * A funcao PL/pgSQL `compute_available_slots` (CALENDAR.md 3.1) e aplicada na
 * migration custom (buffer + min_notice + timezone do workspace).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { contacts } from './contacts';
import { conversations } from './conversations';
import { deals } from './pipeline';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ─── 12.1 calendars ──────────────────────────────────────────────────────────
export const calendars = pgTable(
  'calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    ownerId: uuid('owner_id').references(() => members.id, { onDelete: 'set null' }),
    // teams ainda nao existe no schema -> coluna uuid sem FK (igual routing_history).
    teamId: uuid('team_id'),
    color: text('color').notNull().default('#1FFF13'),
    description: text('description'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_calendars_workspace').on(t.workspaceId),
    index('idx_calendars_owner').on(t.ownerId).where(sql`${t.ownerId} is not null`),
    check('calendars_type_chk', sql`${t.type} in ('personal','team','workspace')`),
  ],
);

// ─── 12.2 availability_rules ─────────────────────────────────────────────────
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_availability_rules_member_day').on(t.memberId, t.dayOfWeek),
    check('availability_rules_dow_chk', sql`${t.dayOfWeek} between 0 and 6`),
  ],
);

// ─── 12.3 availability_exceptions ────────────────────────────────────────────
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    startTime: time('start_time'),
    endTime: time('end_time'),
    isAllDay: boolean('is_all_day').notNull().default(true),
    isAvailable: boolean('is_available').notNull().default(false),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_availability_exceptions_member_dates').on(t.memberId, t.startDate, t.endDate),
  ],
);

// ─── 12.4 events ─────────────────────────────────────────────────────────────
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    type: text('type').notNull().default('meeting'),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    status: text('status').notNull().default('scheduled'),
    // Prioridade do compromisso (F53 — Agenda Inteligente). Default 'medium' ->
    // retrocompat: linhas legadas ganham prioridade media sem backfill.
    priority: text('priority').notNull().default('medium'),
    location: text('location'),
    meetingUrl: text('meeting_url'),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    // ─── Recorrencia (F37-S01, D1=sim) ─────────────────────────────────────────
    // RRULE simplificado: FREQ=DAILY|WEEKLY[;BYDAY=MO,WE,...][;UNTIL=ISO]. Guardamos
    // a regra; a EXPANSAO em ocorrencias e na query da API (S02). Tudo nullable ->
    // retrocompat: evento simples = recurrence_rule NULL (sem recorrencia).
    recurrenceRule: text('recurrence_rule'),
    // Limite duplicado em coluna tipada (timestamptz) para filtro de janela barato na
    // expansao — espelha o UNTIL embutido no RRULE quando presente.
    recurrenceUntil: ts('recurrence_until'),
    // Self-ref nullable: aponta o evento "mestre" (a serie) p/ overrides/excecoes de
    // uma ocorrencia individual no futuro. NULL = este e o mestre (ou evento simples).
    recurrenceParentId: uuid('recurrence_parent_id').references((): AnyPgColumn => events.id, {
      onDelete: 'cascade',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_events_calendar_start').on(t.calendarId, t.startAt),
    index('idx_events_workspace_start').on(t.workspaceId, t.startAt),
    index('idx_events_contact').on(t.contactId).where(sql`${t.contactId} is not null`),
    // Indice parcial p/ a expansao de series: so eventos com regra de recorrencia.
    index('idx_events_recurrence').on(t.workspaceId).where(sql`${t.recurrenceRule} is not null`),
    // Filhos (overrides) de uma serie -> lookup pelo mestre.
    index('idx_events_recurrence_parent')
      .on(t.recurrenceParentId)
      .where(sql`${t.recurrenceParentId} is not null`),
    check(
      'events_type_chk',
      sql`${t.type} in ('meeting','demo','follow_up','task','reminder','other','call','whatsapp','billing','proposal','custom')`,
    ),
    check(
      'events_status_chk',
      sql`${t.status} in ('scheduled','confirmed','cancelled','completed','in_progress','postponed')`,
    ),
    check('events_priority_chk', sql`${t.priority} in ('low','medium','high')`),
  ],
);

// ─── 12.5 event_participants ─────────────────────────────────────────────────
// Sem workspace_id proprio -> RLS via subquery em events.
export const eventParticipants = pgTable(
  'event_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('attendee'),
    rsvp: text('rsvp').default('pending'),
    notifiedAt: ts('notified_at'),
  },
  (t) => [
    index('idx_event_participants_event').on(t.eventId),
    check('event_participants_role_chk', sql`${t.role} in ('organizer','attendee')`),
    check('event_participants_rsvp_chk', sql`${t.rsvp} in ('pending','accepted','declined','tentative')`),
    check(
      'event_participants_subject_chk',
      sql`${t.memberId} is not null or ${t.contactId} is not null`,
    ),
  ],
);
