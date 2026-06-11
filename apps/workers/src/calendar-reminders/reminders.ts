/**
 * Cron de lembretes de evento (CALENDAR.md §6). Tick 5min idempotente:
 *  1. seleciona `events` não-cancelados cujo `start_at - offset <= now` para algum
 *     offset configurado (default 1d/1h) AINDA não enviado;
 *  2. para cada (evento, offset) due: notifica o organizer (best-effort) e, se o
 *     evento tem contato participante com telefone + canal WhatsApp default ativo,
 *     publica um job outbound (reusa o pipeline F1-S07, NÃO reimplementa envio);
 *  3. marca o offset como enviado em `events.metadata.remindersSent` (idempotente
 *     — re-tick nunca duplica; sem coluna nova: S01 está fechado).
 *
 * Lock distribuído (Redis): só um worker tica por vez. DB/MQ são injetados via
 * ports → testáveis sem Postgres/RabbitMQ reais.
 */
import { Buffer } from 'node:buffer';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';

type MqChannel = MqHandle['channel'];

const { events, eventParticipants, contacts, channels, auditLogs } = schema;

export const CALENDAR_REMINDERS_LOCK_KEY = 'hm:lock:scheduler:calendar-reminders' as const;
export const CALENDAR_REMINDERS_LOCK_TTL_MS = 60_000;
export const DEFAULT_REMINDERS_TICK_MS = 5 * 60_000; // 5min
export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

/** Offsets de lembrete (minutos antes do início). 1 dia + 1 hora — §6. */
export const DEFAULT_REMINDER_OFFSETS_MIN = [1440, 60] as const;

/** Template WhatsApp de lembrete (workspace deve ter um aprovado com esse nome). */
export const REMINDER_TEMPLATE_NAME = 'event_reminder';
export const REMINDER_TEMPLATE_LANG = 'pt_BR';

export interface EventMetadata {
  readonly remindersSent?: number[];
  readonly [k: string]: unknown;
}

export interface DueReminder {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startAt: Date;
  readonly contactId: string | null;
  readonly remindersSent: number[];
}

/** Seleciona eventos futuros não-cancelados com algum offset due ainda não enviado. */
async function selectDue(now: Date, offsets: readonly number[], limit: number): Promise<DueReminder[]> {
  const maxOffset = Math.max(...offsets);
  // Janela: eventos que começam entre agora e now+maxOffset (algum offset pode estar due).
  const rows = await getDb().execute<{
    id: string;
    workspace_id: string;
    calendar_id: string;
    title: string;
    start_at: string;
    contact_id: string | null;
    metadata: EventMetadata | null;
  }>(sql`
    select e.id, e.workspace_id, e.calendar_id, e.title, e.start_at, e.contact_id, e.metadata
    from events e
    where e.status <> 'cancelled'
      and e.start_at > ${now}
      and e.start_at <= ${new Date(now.getTime() + maxOffset * 60_000)}
    order by e.start_at asc
    limit ${limit}
  `);
  return [...rows].map((r) => ({
    eventId: r.id,
    workspaceId: r.workspace_id,
    calendarId: r.calendar_id,
    title: r.title,
    startAt: new Date(r.start_at),
    contactId: r.contact_id,
    remindersSent: Array.isArray(r.metadata?.remindersSent) ? r.metadata.remindersSent : [],
  }));
}

/** Offsets que JÁ venceram (start - offset <= now) e ainda não foram enviados. */
export function dueOffsets(
  reminder: Pick<DueReminder, 'startAt' | 'remindersSent'>,
  now: Date,
  offsets: readonly number[],
): number[] {
  return offsets.filter((off) => {
    if (reminder.remindersSent.includes(off)) return false;
    const fireAt = reminder.startAt.getTime() - off * 60_000;
    return fireAt <= now.getTime();
  });
}

export interface ReminderPorts {
  /** Eventos due na janela. */
  selectDue(now: Date, offsets: readonly number[], limit: number): Promise<DueReminder[]>;
  /** Notifica o organizer (member dono do calendar). Best-effort. */
  notifyOrganizer(reminder: DueReminder, offsetMin: number): Promise<void>;
  /** Envia lembrete WhatsApp ao contato (se houver). Retorna true se publicou. */
  sendContactReminder(reminder: DueReminder, offsetMin: number): Promise<boolean>;
  /** Persiste os offsets enviados em events.metadata (idempotência). */
  markReminded(eventId: string, workspaceId: string, offsets: number[]): Promise<void>;
}

export interface ReminderDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
}

/** Ports reais (DB + MQ). Em teste, injete um stub de `ReminderPorts`. */
export function createReminderPorts(deps: ReminderDbDeps): ReminderPorts {
  return {
    selectDue,

    async notifyOrganizer(reminder, offsetMin) {
      // Sem tabela de notificações ainda — auditamos em audit_logs (rastreável).
      // O sistema de notificação in-app/email pluga aqui na fase futura.
      await withWorkspace(reminder.workspaceId, async (tx) => {
        const [organizer] = await tx
          .select({ memberId: eventParticipants.memberId })
          .from(eventParticipants)
          .where(
            and(
              eq(eventParticipants.eventId, reminder.eventId),
              eq(eventParticipants.role, 'organizer'),
            ),
          )
          .limit(1);
        await tx.insert(auditLogs).values({
          workspaceId: reminder.workspaceId,
          actorMemberId: organizer?.memberId ?? null,
          actorType: 'system',
          action: 'event.reminder',
          resourceType: 'event',
          resourceId: reminder.eventId,
          metadata: { offsetMin, startAt: reminder.startAt.toISOString(), title: reminder.title },
        });
      });
    },

    async sendContactReminder(reminder, offsetMin) {
      if (!reminder.contactId) return false;
      return withWorkspace(reminder.workspaceId, async (tx) => {
        const [contact] = await tx
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(eq(contacts.id, reminder.contactId as string))
          .limit(1);
        const phone = contact?.phone ?? null;
        if (!phone) return false;

        // Canal WhatsApp default ativo do workspace.
        const [channel] = await tx
          .select({ id: channels.id })
          .from(channels)
          .where(
            and(
              eq(channels.provider, 'meta_whatsapp'),
              eq(channels.isActive, true),
              eq(channels.isDefault, true),
            ),
          )
          .limit(1);
        if (!channel) return false;

        const job = {
          kind: 'template' as const,
          channelId: channel.id,
          conversationId: '',
          messageId: `event-reminder-${reminder.eventId}-${offsetMin}`,
          chatId: phone,
          templateName: REMINDER_TEMPLATE_NAME,
          languageCode: REMINDER_TEMPLATE_LANG,
          components: [],
        };
        const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, reminder.workspaceId, job);
        deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: 'application/json',
        });
        return true;
      });
    },

    async markReminded(eventId, workspaceId, offsets) {
      await withWorkspace(workspaceId, async (tx) => {
        // Merge atômico no jsonb: append offsets ao array remindersSent (sem dup).
        await tx
          .update(events)
          .set({
            metadata: sql`jsonb_set(
              coalesce(${events.metadata}, '{}'::jsonb),
              '{remindersSent}',
              (
                select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
                from (
                  select jsonb_array_elements(
                    coalesce(${events.metadata}->'remindersSent', '[]'::jsonb)
                  ) as v
                  union
                  select to_jsonb(o) from unnest(${offsets}::int[]) as o
                ) s
              )
            )`,
            updatedAt: new Date(),
          })
          .where(and(eq(events.id, eventId), ne(events.status, 'cancelled')));
      });
    },
  };
}

export interface ReminderTickResult {
  readonly ran: boolean;
  readonly events: number;
  readonly notified: number;
  readonly whatsapp: number;
}

export interface ReminderDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly ports: ReminderPorts;
}

/** Um tick de lembretes. Idempotente: offsets já enviados não re-disparam. */
export async function runReminderTick(
  deps: ReminderDeps,
  options: { now?: Date; offsets?: readonly number[]; limit?: number } = {},
): Promise<ReminderTickResult> {
  const now = options.now ?? new Date();
  const offsets = options.offsets ?? DEFAULT_REMINDER_OFFSETS_MIN;
  const limit = options.limit ?? 500;

  const release = await acquireSchedulerLock(
    deps.redis,
    CALENDAR_REMINDERS_LOCK_KEY,
    CALENDAR_REMINDERS_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, events: 0, notified: 0, whatsapp: 0 };

  try {
    const candidates = await deps.ports.selectDue(now, offsets, limit);
    let touched = 0;
    let notified = 0;
    let whatsapp = 0;

    for (const reminder of candidates) {
      const due = dueOffsets(reminder, now, offsets);
      if (due.length === 0) continue;

      for (const offsetMin of due) {
        try {
          await deps.ports.notifyOrganizer(reminder, offsetMin);
          notified += 1;
        } catch (err: unknown) {
          deps.logger.error('calendar-reminders: notifyOrganizer falhou', {
            eventId: reminder.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          const sent = await deps.ports.sendContactReminder(reminder, offsetMin);
          if (sent) whatsapp += 1;
        } catch (err: unknown) {
          deps.logger.error('calendar-reminders: sendContactReminder falhou', {
            eventId: reminder.eventId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Marca TODOS os offsets due de uma vez (idempotência mesmo se algum side-effect falhou).
      await deps.ports.markReminded(reminder.eventId, reminder.workspaceId, due);
      touched += 1;
    }

    if (touched > 0) {
      deps.logger.info('calendar-reminders: tick', { events: touched, notified, whatsapp });
    }
    return { ran: true, events: touched, notified, whatsapp };
  } finally {
    await release();
  }
}

/** Inicia o scheduler periódico (default 5min). Retorna handle com stop(). */
export function startReminderScheduler(
  deps: ReminderDeps,
  options: { intervalMs?: number; offsets?: readonly number[] } = {},
): { stop(): Promise<void> } {
  const intervalMs = options.intervalMs ?? DEFAULT_REMINDERS_TICK_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runReminderTick(deps, { offsets: options.offsets })
      .catch((err: unknown) => {
        deps.logger.error('calendar-reminders: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('calendar reminder scheduler iniciado', { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export type { RedisLike };
