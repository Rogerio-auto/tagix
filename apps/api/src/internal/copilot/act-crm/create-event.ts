/**
 * `event.create_internal` — criar um compromisso INTERNO na agenda pelo Copiloto (F73-S08).
 *
 * Mesmo service da agenda (`createEvent`), com `actor = membro` e `metadata = { via,
 * proposal_id, internal: true }`. O calendário precisa ser um que o membro acessa (a mesma
 * régua da agenda, `calendarRepo.accessibleCalendarIds`).
 *
 * SEM AVISO AO CLIENTE (é o que separa esta capacidade de uma mensagem, nível 4): o worker de
 * lembretes (`apps/workers/src/calendar-reminders`) manda WhatsApp ao contato de todo evento com
 * `events.contact_id`. Por isso o contato citado NÃO vai para `contact_id`: fica em
 * `metadata.related_contact_id` (e o negócio, quando houver, em `deal_id`, que não dispara
 * nada). Pendência registrada: o worker respeitar um "sem aviso ao contato" para o vínculo
 * poder ir para a coluna.
 *
 * O alvo é sintético (o compromisso ainda não existe): tipo `event` com um id gerado na
 * resolução; o id real fica no `after`/`undoPayload`. Desfazer = cancelar (`cancelEvent`), só
 * se o compromisso não foi remarcado nem cancelado por alguém depois.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { calendarRepo, schema } from '@hm/db';
import { EventServiceError, cancelEvent, createEvent } from '../../../services/event-service';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorContext,
  ExecutorPreview,
  ResolvedTargets,
  Target,
  TargetRef,
  UndoItemResult,
} from '../core/executor-types';
import { loadWorkspaceFormat, type WorkspaceFormat } from '../read-crm/common';
import { correlation, jsonString } from './common';

const { calendars, events } = schema;

const EVENT_TYPES = ['meeting', 'call', 'follow_up', 'task', 'reminder', 'other'] as const;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export const CreateEventArgsSchema = z
  .object({
    calendar_id: z.string().uuid().describe('Agenda de destino (de list_events).'),
    title: z.string().trim().min(1).max(200).describe('Título do compromisso.'),
    starts_at: z.string().datetime({ offset: true }).describe('Início (ISO com fuso).'),
    ends_at: z
      .string()
      .datetime({ offset: true })
      .describe('Fim (ISO com fuso), depois do início.'),
    type: z.enum(EVENT_TYPES).default('meeting').describe('Tipo do compromisso.'),
    description: z.string().trim().max(2000).optional().describe('Detalhes (opcional).'),
    contact_id: z
      .string()
      .uuid()
      .optional()
      .describe('Contato relacionado (opcional; não é avisado).'),
    deal_id: z.string().uuid().optional().describe('Negócio relacionado (opcional).'),
  })
  .strict()
  .refine((v) => Date.parse(v.ends_at) > Date.parse(v.starts_at), {
    message: 'ends_at precisa ser depois de starts_at.',
  })
  .refine((v) => Date.parse(v.ends_at) - Date.parse(v.starts_at) <= MAX_DURATION_MS, {
    message: 'Compromisso de até 24 horas.',
  });
export type CreateEventArgs = z.infer<typeof CreateEventArgsSchema>;

export const CREATE_EVENT_TOOL_DESCRIPTION =
  'Propõe criar um compromisso INTERNO na agenda (reunião, ligação, tarefa), sem aviso ao cliente. Pode citar um ' +
  'contato e um negócio relacionados. O sistema mostra a prévia e decide se precisa de confirmação. Se ficar ' +
  'aguardando confirmação, diga isso e pare.';

interface CalendarLite {
  readonly id: string;
  readonly name: string;
}

/** Calendário do workspace que o membro acessa (a régua da agenda). */
async function accessibleCalendar(
  ctx: Pick<ExecutorContext, 'tx' | 'principal'>,
  calendarId: string,
): Promise<CalendarLite | null> {
  const [row] = await ctx.tx
    .select({ id: calendars.id, name: calendars.name })
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.workspaceId, ctx.principal.workspaceId)))
    .limit(1);
  if (!row) return null;
  const { role, memberId } = ctx.principal;
  if (role !== 'OWNER' && role !== 'ADMIN') {
    const ids = await calendarRepo.accessibleCalendarIds(ctx.tx, { memberId, role });
    if (!ids.includes(row.id)) return null;
  }
  return row;
}

function syntheticTarget(id: string, calendar: CalendarLite): Target {
  return {
    type: 'event',
    id,
    label: `Compromisso interno · ${calendar.name}`.slice(0, 200),
    expectedVersion: null,
    state: { calendar_id: calendar.id },
  };
}

function when(fmt: WorkspaceFormat, startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts = { timeZone: fmt.timezone } as const;
  try {
    const day = new Intl.DateTimeFormat(fmt.locale, {
      ...opts,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const time = new Intl.DateTimeFormat(fmt.locale, {
      ...opts,
      hour: '2-digit',
      minute: '2-digit',
    });
    const sameDay = day.format(start) === day.format(end);
    return sameDay
      ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
      : `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

export const createEventExecutor: CapabilityExecutor<CreateEventArgs> = {
  capability: 'event.create_internal',
  argsSchema: CreateEventArgsSchema,
  requires: ['calendar.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const calendar = await accessibleCalendar(ctx, args.calendar_id);
    const dropped: { id: string; reason: 'not_found' }[] = [];
    if (!calendar) dropped.push({ id: args.calendar_id, reason: 'not_found' });
    if (
      args.contact_id &&
      !(await resolveVisible(ctx.tx, ctx.principal, { type: 'contact', id: args.contact_id }))
    ) {
      dropped.push({ id: args.contact_id, reason: 'not_found' });
    }
    if (
      args.deal_id &&
      !(await resolveVisible(ctx.tx, ctx.principal, { type: 'deal', id: args.deal_id }))
    ) {
      dropped.push({ id: args.deal_id, reason: 'not_found' });
    }
    if (!calendar || dropped.length > 0) return { targets: [], dropped };
    return { targets: [syntheticTarget(randomUUID(), calendar)], dropped: [] };
  },

  /** O compromisso ainda não existe: o que se re-resolve é o calendário do item. */
  async resolveIds(ctx, refs: readonly TargetRef[]): Promise<ResolvedTargets> {
    const targets: Target[] = [];
    const dropped: { id: string; reason: 'not_found' }[] = [];
    for (const ref of refs) {
      if (ref.type !== 'event') {
        dropped.push({ id: ref.id, reason: 'not_found' });
        continue;
      }
      // Sem o args aqui: a agenda é conferida de novo no executeItem, sob quem executa.
      targets.push({
        type: 'event',
        id: ref.id,
        label: 'Compromisso interno',
        expectedVersion: null,
        state: {},
      });
    }
    return { targets, dropped };
  },

  async preview(ctx, args, targets): Promise<ExecutorPreview> {
    const fmt = await loadWorkspaceFormat(ctx.tx, ctx.principal.workspaceId);
    const calendar = await accessibleCalendar(ctx, args.calendar_id);
    const calendarName = calendar?.name ?? 'Agenda';
    const period = when(fmt, args.starts_at, args.ends_at);
    return {
      items: targets.map((t) => ({
        targetId: t.id,
        before: null,
        after: `${args.title} · ${period}`.slice(0, 200),
        plannedAfter: { status: 'scheduled' },
      })),
      impact: {
        notified_members: [],
        affected_count: targets.length,
        criterion: 'Compromisso interno: o cliente não recebe aviso nem lembrete.',
      },
      external: false,
      irreversible: false,
      notifiesMembers: false,
      summary: `Criar 1 compromisso interno em ${calendarName} (${period})`.slice(0, 500),
      beforeAfter: [
        { label: 'Compromisso', before: '—', after: args.title.slice(0, 200), count: 1 },
        { label: 'Quando', before: '—', after: period.slice(0, 200), count: 1 },
        { label: 'Agenda', before: '—', after: calendarName.slice(0, 200), count: 1 },
        { label: 'Aviso ao cliente', before: '—', after: 'Nenhum', count: 1 },
      ],
    };
  },

  async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
    const calendar = await accessibleCalendar(ctx, args.calendar_id);
    if (!calendar) return { status: 'failed', errorCode: 'not_found' };
    if (
      args.deal_id &&
      !(await resolveVisible(ctx.tx, ctx.principal, { type: 'deal', id: args.deal_id }))
    ) {
      return { status: 'failed', errorCode: 'not_found' };
    }
    if (
      args.contact_id &&
      !(await resolveVisible(ctx.tx, ctx.principal, { type: 'contact', id: args.contact_id }))
    ) {
      return { status: 'failed', errorCode: 'not_found' };
    }
    let created: Awaited<ReturnType<typeof createEvent>>;
    try {
      created = await createEvent(
        ctx.tx,
        {
          workspaceId: ctx.principal.workspaceId,
          calendarId: calendar.id,
          title: args.title,
          startAt: new Date(args.starts_at),
          endAt: new Date(args.ends_at),
          type: args.type,
          description: args.description ?? null,
          // Sem `contactId`: ver o cabeçalho (lembrete ao contato).
          dealId: args.deal_id ?? null,
          metadata: {
            ...correlation(ctx),
            internal: true,
            copilot_item_id: item.id,
            ...(args.contact_id ? { related_contact_id: args.contact_id } : {}),
          },
        },
        { type: 'member', memberId: ctx.principal.memberId },
      );
    } catch (err) {
      if (err instanceof EventServiceError) return { status: 'failed', errorCode: err.code };
      throw err;
    }
    return {
      status: 'done',
      after: {
        event_id: created.id,
        start_at: created.startAt.toISOString(),
        end_at: created.endAt.toISOString(),
        title: created.title,
      },
      undoPayload: { event_id: created.id },
    };
  },

  async undoItem(ctx, item): Promise<UndoItemResult> {
    const eventId = jsonString(item.undoPayload, 'event_id');
    if (!eventId) return { status: 'failed', errorCode: 'undo_payload' };
    const [current] = await ctx.tx
      .select({
        id: events.id,
        status: events.status,
        title: events.title,
        startAt: events.startAt,
        endAt: events.endAt,
        calendarId: events.calendarId,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
      .for('update');
    if (!current || current.status === 'cancelled') return { status: 'undo_conflict' };
    if (!(await accessibleCalendar(ctx, current.calendarId))) return { status: 'undo_conflict' };
    // Remarcado ou renomeado por alguém depois: não cancela o que a pessoa mudou.
    if (
      current.startAt.toISOString() !== jsonString(item.after, 'start_at') ||
      current.endAt.toISOString() !== jsonString(item.after, 'end_at') ||
      current.title !== jsonString(item.after, 'title')
    ) {
      return { status: 'undo_conflict' };
    }
    const cancelled = await cancelEvent(ctx.tx, eventId, {
      type: 'member',
      memberId: ctx.principal.memberId,
    });
    return cancelled ? { status: 'undone' } : { status: 'undo_conflict' };
  },
};
