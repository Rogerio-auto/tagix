/**
 * Cron de lembretes de evento (CALENDAR.md §6 + COCKPIT_AGENDA.md §4). Tick 5min
 * idempotente:
 *  1. seleciona `events` não-cancelados na janela `[now - grace, now + maxOffset]`
 *     cujo `start_at - offset <= now` para algum offset configurado (default
 *     1d / 1h / 0=vencimento) AINDA não enviado;
 *  2. para cada (evento, offset) due: NOTIFICA o organizer em tempo real (publica
 *     `appointment:due` no socket relay `hm.q.socket.relay` → member/ws, F53-S05) +
 *     auditLog (rastreável), e — se o evento tem contato com telefone + canal
 *     WhatsApp default ativo — publica um job outbound (reusa o pipeline F1-S07);
 *  3. NO VENCIMENTO (`start_at <= now`), se `metadata.dueAction` presente e ainda
 *     não executada, ENFILEIRA a ação reusando os ports existentes
 *     (`triggerFlow`/outbound/`move_stage`/`add_tag`). Idempotente via
 *     `metadata.dueActionDone`; falha de port → auditLog + retry no próximo tick;
 *  4. marca os offsets enviados em `events.metadata.remindersSent` (idempotente —
 *     re-tick nunca duplica; sem coluna nova: S01 está fechado).
 *
 * Lock distribuído (Redis): só um worker tica por vez. DB/MQ são injetados via
 * ports → testáveis sem Postgres/RabbitMQ reais.
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace, type DbTx } from '@hm/db';
import { makeEnvelope, publish, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { AppointmentDuePayload } from '@hm/shared';
import { createFlowEngine, createQueuePort, type FlowEngineApi } from '@hm/flow-engine';
import type { Logger } from '@hm/logger';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';

type MqChannel = MqHandle['channel'];

const { events, eventParticipants, contacts, channels, auditLogs, deals, stages, dealHistory, contactTags } =
  schema;

export const CALENDAR_REMINDERS_LOCK_KEY = 'hm:lock:scheduler:calendar-reminders' as const;
export const CALENDAR_REMINDERS_LOCK_TTL_MS = 60_000;
export const DEFAULT_REMINDERS_TICK_MS = 5 * 60_000; // 5min
export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

/** Fila do socket relay (F1-S11) — reusada, NÃO reescrita (consome o relay existente). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;
/** Evento Server→Client de compromisso vencido/lembrete (F53-S05). */
export const APPOINTMENT_DUE_EVENT = 'appointment:due' as const;

/**
 * Offsets de lembrete (minutos antes do início). 1 dia + 1 hora + 0=vencimento — o
 * offset `0` é o lembrete "na hora" (COCKPIT_AGENDA.md §4). Configurável via env
 * `CALENDAR_REMINDER_OFFSETS_MIN` (CSV de minutos), default abaixo.
 */
export const DEFAULT_REMINDER_OFFSETS_MIN = [1440, 60, 0] as const;

/**
 * Janela de tolerância (minutos) para lembretes que já venceram: um evento cujo
 * `start_at` está até `grace` minutos no passado ainda é selecionado, de modo que
 * o offset `0` (e ações de vencimento) dispare mesmo se um ou mais ticks foram
 * perdidos (worker reiniciado etc.). Idempotência via `remindersSent`/`dueActionDone`
 * garante zero duplicação.
 */
export const DUE_REMINDER_GRACE_MIN = 30;

/** Template WhatsApp de lembrete (workspace deve ter um aprovado com esse nome). */
export const REMINDER_TEMPLATE_NAME = 'event_reminder';
export const REMINDER_TEMPLATE_LANG = 'pt_BR';

/**
 * Resolve a lista de offsets a partir do env `CALENDAR_REMINDER_OFFSETS_MIN` (CSV
 * de minutos, ex.: "1440,60,0"); sem env válido → default. Aceita só inteiros >= 0.
 */
export function resolveReminderOffsets(env: NodeJS.ProcessEnv = process.env): number[] {
  const raw = env['CALENDAR_REMINDER_OFFSETS_MIN'];
  if (!raw) return [...DEFAULT_REMINDER_OFFSETS_MIN];
  const parsed = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  // De-dup preservando ordem.
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : [...DEFAULT_REMINDER_OFFSETS_MIN];
}

/**
 * Ação disparada ao vencer o compromisso (`events.metadata.dueAction`, gravada por
 * F53-S02). Reusa os ports existentes; validada por Zod no boundary (proibido `any`).
 */
export const dueActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trigger_flow'), flowId: z.string().uuid() }),
  z.object({
    kind: z.literal('send_message'),
    templateName: z.string().min(1),
    languageCode: z.string().min(2).default(REMINDER_TEMPLATE_LANG),
    channelId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal('move_stage'),
    stageId: z.string().uuid(),
    pipelineId: z.string().uuid().optional(),
  }),
  z.object({ kind: z.literal('add_tag'), tagId: z.string().uuid() }),
]);

export type DueAction = z.infer<typeof dueActionSchema>;

/** Prioridade do compromisso (`events_priority_chk`); espelha AppointmentDuePayload. */
export type EventPriority = 'low' | 'medium' | 'high';

/** Coerção defensiva: valor fora do conjunto → 'medium' (default da coluna). */
function coercePriority(raw: string | null): EventPriority {
  return raw === 'low' || raw === 'high' ? raw : 'medium';
}

/** Lê e valida `metadata.dueAction`; inválido/ausente → null. */
export function parseDueAction(metadata: EventMetadata | null): DueAction | null {
  const raw = metadata?.dueAction;
  if (raw === undefined || raw === null) return null;
  const parsed = dueActionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface EventMetadata {
  readonly remindersSent?: number[];
  readonly dueAction?: unknown;
  readonly dueActionDone?: boolean;
  readonly [k: string]: unknown;
}

export interface DueReminder {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startAt: Date;
  readonly type: string;
  readonly priority: EventPriority;
  readonly contactId: string | null;
  readonly dealId: string | null;
  readonly conversationId: string | null;
  readonly remindersSent: number[];
  readonly dueAction: DueAction | null;
  readonly dueActionDone: boolean;
}

/** Seleciona eventos não-cancelados na janela com algum offset due ainda não enviado. */
async function selectDue(now: Date, offsets: readonly number[], limit: number): Promise<DueReminder[]> {
  const maxOffset = offsets.length > 0 ? Math.max(...offsets) : 0;
  // Janela: de `now - grace` (vencidos recentes p/ offset 0) até `now + maxOffset`.
  const lowerBound = new Date(now.getTime() - DUE_REMINDER_GRACE_MIN * 60_000);
  const upperBound = new Date(now.getTime() + maxOffset * 60_000);
  const rows = await getDb().execute<{
    id: string;
    workspace_id: string;
    calendar_id: string;
    title: string;
    start_at: string;
    event_type: string;
    priority: string | null;
    contact_id: string | null;
    deal_id: string | null;
    conversation_id: string | null;
    metadata: EventMetadata | null;
  }>(sql`
    select e.id, e.workspace_id, e.calendar_id, e.title, e.start_at,
           e.type as event_type, e.priority, e.contact_id, e.deal_id,
           e.conversation_id, e.metadata
    from events e
    where e.status <> 'cancelled'
      and e.start_at >= ${lowerBound.toISOString()}
      and e.start_at <= ${upperBound.toISOString()}
    order by e.start_at asc
    limit ${limit}
  `);
  return [...rows].map((r) => ({
    eventId: r.id,
    workspaceId: r.workspace_id,
    calendarId: r.calendar_id,
    title: r.title,
    startAt: new Date(r.start_at),
    type: r.event_type,
    priority: coercePriority(r.priority),
    contactId: r.contact_id,
    dealId: r.deal_id,
    conversationId: r.conversation_id,
    remindersSent: Array.isArray(r.metadata?.remindersSent) ? r.metadata.remindersSent : [],
    dueAction: parseDueAction(r.metadata),
    dueActionDone: r.metadata?.dueActionDone === true,
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

/** True se a ação de vencimento deve rodar agora: tem ação, venceu e não foi feita. */
export function dueActionPending(
  reminder: Pick<DueReminder, 'startAt' | 'dueAction' | 'dueActionDone'>,
  now: Date,
): boolean {
  return (
    reminder.dueAction !== null &&
    !reminder.dueActionDone &&
    reminder.startAt.getTime() <= now.getTime()
  );
}

export interface ReminderPorts {
  /** Eventos due na janela. */
  selectDue(now: Date, offsets: readonly number[], limit: number): Promise<DueReminder[]>;
  /**
   * Notifica o organizer em tempo real (socket relay → member/ws) + auditLog.
   * Best-effort: erro de socket não pode abortar o tick.
   */
  notifyOrganizer(reminder: DueReminder, offsetMin: number): Promise<void>;
  /** Envia lembrete WhatsApp ao contato (se houver). Retorna true se publicou. */
  sendContactReminder(reminder: DueReminder, offsetMin: number): Promise<boolean>;
  /**
   * Executa a `dueAction` do compromisso no vencimento, reusando os ports
   * existentes. Lança em falha transitória (DB/MQ/engine) → retry no próximo tick.
   * Pré-requisito estrutural ausente (ex.: add_tag sem contato) é auditado e tratado
   * como concluído (retry não ajudaria).
   */
  runDueAction(reminder: DueReminder): Promise<void>;
  /** Persiste os offsets enviados em events.metadata (idempotência). */
  markReminded(eventId: string, workspaceId: string, offsets: number[]): Promise<void>;
  /** Marca `metadata.dueActionDone = true` (idempotência da ação de vencimento). */
  markDueActionDone(eventId: string, workspaceId: string): Promise<void>;
}

export interface ReminderDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
}

/** Publica um envelope no socket relay (`hm.q.socket.relay`) — consome o relay existente. */
function publishRelay(
  channel: MqChannel,
  workspaceId: string,
  payload: {
    event: typeof APPOINTMENT_DUE_EVENT;
    target: { memberId?: string; workspace: true };
    data: AppointmentDuePayload;
  },
): void {
  const envelope = makeEnvelope('socket.relay', workspaceId, payload);
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Audita uma ação de vencimento (sucesso/skip/falha) — rastreável em audit_logs. */
async function auditDueAction(
  workspaceId: string,
  reminder: DueReminder,
  outcome: 'enqueued' | 'skipped' | 'failed',
  detail: Record<string, unknown>,
): Promise<void> {
  await withWorkspace(workspaceId, async (tx) => {
    await tx.insert(auditLogs).values({
      workspaceId,
      actorType: 'system',
      action: `event.due_action.${outcome}`,
      resourceType: 'event',
      resourceId: reminder.eventId,
      metadata: { kind: reminder.dueAction?.kind ?? null, ...detail },
    });
  });
}

/** Ports reais (DB + MQ + flow engine). Em teste, injete um stub de `ReminderPorts`. */
export function createReminderPorts(deps: ReminderDbDeps): ReminderPorts {
  // Engine de flows com queue port que publica de verdade em `hm.q.flow.execution`
  // (mesmo contrato do flow worker, F4-S03) — reuso, não reimplementação.
  const flowEngine: FlowEngineApi = createFlowEngine({
    queue: createQueuePort({
      publish(routingKey, envelope) {
        publish(deps.channel, routingKey, envelope);
      },
    }),
  });

  /** Resolve o canal WhatsApp default ativo do workspace (RLS-escopado). */
  async function defaultWhatsappChannel(tx: DbTx): Promise<string | null> {
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
    return channel?.id ?? null;
  }

  /** Enfileira um template outbound ao contato (reusa o pipeline F1-S07). */
  function enqueueTemplate(
    workspaceId: string,
    channelId: string,
    chatId: string,
    messageId: string,
    templateName: string,
    languageCode: string,
  ): void {
    const job = {
      kind: 'template' as const,
      channelId,
      conversationId: '',
      messageId,
      chatId,
      templateName,
      languageCode,
      components: [],
    };
    const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, workspaceId, job);
    deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  }

  return {
    selectDue,

    async notifyOrganizer(reminder, offsetMin) {
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
        const organizerId = organizer?.memberId ?? null;

        // AuditLog (rastreável) — preservado mesmo com a notificação em tempo real.
        await tx.insert(auditLogs).values({
          workspaceId: reminder.workspaceId,
          actorMemberId: organizerId,
          actorType: 'system',
          action: 'event.reminder',
          resourceType: 'event',
          resourceId: reminder.eventId,
          metadata: { offsetMin, startAt: reminder.startAt.toISOString(), title: reminder.title },
        });

        // Notificação in-app em tempo real (F53-S05): publica `appointment:due` no
        // relay para o organizer e para o workspace (escopo correto — GUC já setado
        // por withWorkspace; o relay roteia por room).
        const data: AppointmentDuePayload = {
          eventId: reminder.eventId,
          contactId: reminder.contactId,
          conversationId: reminder.conversationId,
          title: reminder.title,
          startAt: reminder.startAt.toISOString(),
          type: reminder.type,
          priority: reminder.priority,
        };
        publishRelay(deps.channel, reminder.workspaceId, {
          event: APPOINTMENT_DUE_EVENT,
          target: organizerId ? { memberId: organizerId, workspace: true } : { workspace: true },
          data,
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

        const channelId = await defaultWhatsappChannel(tx);
        if (!channelId) return false;

        enqueueTemplate(
          reminder.workspaceId,
          channelId,
          phone,
          `event-reminder-${reminder.eventId}-${offsetMin}`,
          REMINDER_TEMPLATE_NAME,
          REMINDER_TEMPLATE_LANG,
        );
        return true;
      });
    },

    async runDueAction(reminder) {
      const action = reminder.dueAction;
      if (!action) return;
      try {
        switch (action.kind) {
          case 'trigger_flow': {
            await flowEngine.triggerFlow({
              workspaceId: reminder.workspaceId,
              flowId: action.flowId,
              conversationId: reminder.conversationId ?? undefined,
              contactId: reminder.contactId ?? undefined,
              triggeredBy: 'automatic',
              triggerData: { source: 'calendar_due', eventId: reminder.eventId },
            });
            await auditDueAction(reminder.workspaceId, reminder, 'enqueued', { flowId: action.flowId });
            return;
          }
          case 'send_message': {
            if (!reminder.contactId) {
              await auditDueAction(reminder.workspaceId, reminder, 'skipped', { reason: 'no_contact' });
              return;
            }
            const handled = await withWorkspace(reminder.workspaceId, async (tx) => {
              const [contact] = await tx
                .select({ phone: contacts.phone })
                .from(contacts)
                .where(eq(contacts.id, reminder.contactId as string))
                .limit(1);
              const phone = contact?.phone ?? null;
              if (!phone) return { ok: false as const, reason: 'no_phone' };
              const channelId = action.channelId ?? (await defaultWhatsappChannel(tx));
              if (!channelId) return { ok: false as const, reason: 'no_channel' };
              enqueueTemplate(
                reminder.workspaceId,
                channelId,
                phone,
                `event-due-action-${reminder.eventId}`,
                action.templateName,
                action.languageCode,
              );
              return { ok: true as const };
            });
            await auditDueAction(
              reminder.workspaceId,
              reminder,
              handled.ok ? 'enqueued' : 'skipped',
              handled.ok ? { templateName: action.templateName } : { reason: handled.reason },
            );
            return;
          }
          case 'move_stage': {
            const result = await withWorkspace(reminder.workspaceId, async (tx) => {
              const [target] = await tx
                .select()
                .from(stages)
                .where(eq(stages.id, action.stageId))
                .limit(1);
              if (!target) return { kind: 'stage_not_found' as const };

              // Deal: o do evento (preciso) ou o aberto mais recente do contato.
              const dealFilters = reminder.dealId
                ? [eq(deals.id, reminder.dealId)]
                : reminder.contactId
                  ? [
                      eq(deals.contactId, reminder.contactId),
                      eq(deals.pipelineId, action.pipelineId ?? target.pipelineId),
                      isNull(deals.closedAt),
                    ]
                  : null;
              if (dealFilters === null) return { kind: 'no_deal' as const };
              const [deal] = await tx
                .select()
                .from(deals)
                .where(and(...dealFilters))
                .orderBy(desc(deals.createdAt))
                .limit(1);
              if (!deal) return { kind: 'no_deal' as const };
              if (deal.stageId === target.id) return { kind: 'noop' as const };

              await tx
                .update(deals)
                .set({ stageId: target.id, position: 0, updatedAt: new Date() })
                .where(eq(deals.id, deal.id));
              await tx.insert(dealHistory).values({
                dealId: deal.id,
                workspaceId: reminder.workspaceId,
                eventType: 'stage_changed',
                fromValue: { stageId: deal.stageId },
                toValue: { stageId: target.id },
                actorType: 'system',
                metadata: { via: 'calendar_due', eventId: reminder.eventId },
              });
              return { kind: 'moved' as const, dealId: deal.id };
            });
            await auditDueAction(
              reminder.workspaceId,
              reminder,
              result.kind === 'moved' ? 'enqueued' : 'skipped',
              { stageId: action.stageId, result: result.kind },
            );
            return;
          }
          case 'add_tag': {
            if (!reminder.contactId) {
              await auditDueAction(reminder.workspaceId, reminder, 'skipped', { reason: 'no_contact' });
              return;
            }
            await withWorkspace(reminder.workspaceId, async (tx) => {
              await tx
                .insert(contactTags)
                .values({
                  contactId: reminder.contactId as string,
                  tagId: action.tagId,
                  workspaceId: reminder.workspaceId,
                })
                .onConflictDoNothing();
            });
            await auditDueAction(reminder.workspaceId, reminder, 'enqueued', { tagId: action.tagId });
            return;
          }
          default: {
            const _exhaustive: never = action;
            throw new Error(`dueAction desconhecida: ${JSON.stringify(_exhaustive)}`);
          }
        }
      } catch (err: unknown) {
        // Falha transitória: audita e RE-LANÇA → não marca done → retry no próximo tick.
        await auditDueAction(reminder.workspaceId, reminder, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => {
          /* auditoria best-effort: não mascarar o erro original */
        });
        throw err;
      }
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

    async markDueActionDone(eventId, workspaceId) {
      await withWorkspace(workspaceId, async (tx) => {
        await tx
          .update(events)
          .set({
            metadata: sql`jsonb_set(
              coalesce(${events.metadata}, '{}'::jsonb),
              '{dueActionDone}',
              'true'::jsonb
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
  readonly actions: number;
}

export interface ReminderDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly ports: ReminderPorts;
}

/** Um tick de lembretes. Idempotente: offsets/ações já enviados não re-disparam. */
export async function runReminderTick(
  deps: ReminderDeps,
  options: { now?: Date; offsets?: readonly number[]; limit?: number } = {},
): Promise<ReminderTickResult> {
  const now = options.now ?? new Date();
  const offsets = options.offsets ?? resolveReminderOffsets();
  const limit = options.limit ?? 500;

  const release = await acquireSchedulerLock(
    deps.redis,
    CALENDAR_REMINDERS_LOCK_KEY,
    CALENDAR_REMINDERS_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, events: 0, notified: 0, whatsapp: 0, actions: 0 };

  try {
    const candidates = await deps.ports.selectDue(now, offsets, limit);
    let touched = 0;
    let notified = 0;
    let whatsapp = 0;
    let actions = 0;

    for (const reminder of candidates) {
      const due = dueOffsets(reminder, now, offsets);
      const actionPending = dueActionPending(reminder, now);
      if (due.length === 0 && !actionPending) continue;

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

      // Ação de vencimento (F53-S05): só marca done em SUCESSO → falha vira retry.
      let actionDone = false;
      if (actionPending) {
        try {
          await deps.ports.runDueAction(reminder);
          actionDone = true;
          actions += 1;
        } catch (err: unknown) {
          deps.logger.error('calendar-reminders: runDueAction falhou (retry no próximo tick)', {
            eventId: reminder.eventId,
            kind: reminder.dueAction?.kind,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Marca offsets due de uma vez (idempotência mesmo se algum side-effect falhou).
      if (due.length > 0) {
        await deps.ports.markReminded(reminder.eventId, reminder.workspaceId, due);
      }
      if (actionDone) {
        await deps.ports.markDueActionDone(reminder.eventId, reminder.workspaceId);
      }
      touched += 1;
    }

    if (touched > 0) {
      deps.logger.info('calendar-reminders: tick', { events: touched, notified, whatsapp, actions });
    }
    return { ran: true, events: touched, notified, whatsapp, actions };
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
  const offsets = options.offsets ?? resolveReminderOffsets();
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runReminderTick(deps, { offsets })
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
  deps.logger.info('calendar reminder scheduler iniciado', { intervalMs, offsets });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export type { RedisLike };
