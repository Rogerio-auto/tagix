/**
 * API de eventos (CALENDAR.md §7). RLS via req.scoped, input via Zod. Criação
 * centralizada no event-service (ponto único reusado pelo agente em F7-S04).
 *
 *   GET    /api/events                lista escopada por calendários acessíveis     (calendar.view)
 *                                     (calendarIds overlay, from/to, contact; recorrência expandida)
 *   POST   /api/events                cria                                          (event.edit)
 *   GET    /api/events/:id            detalhe + participantes                       (calendar.view)
 *   PUT    /api/events/:id            update                                        (event.edit)
 *   POST   /api/events/:id/cancel     cancela (status=cancelled)                    (event.edit)
 *   POST   /api/events/:id/rsvp       RSVP do member logado                         (calendar.view)
 *
 * Ownership fino (§8): editar/cancelar -> criador OU ADMIN/OWNER (refinado aqui).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, isNotNull, lte, or, type SQL } from 'drizzle-orm';
import { calendarRepo, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  EventServiceError,
  cancelEvent,
  createEvent,
  setRsvp,
} from '../../services/event-service';
import { expandOccurrences } from '../../services/calendar-recurrence';

const { events, eventParticipants } = schema;

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const eventTypeEnum = z.enum(['meeting', 'demo', 'follow_up', 'task', 'reminder', 'other']);

// RRULE simplificado aceito pela API (espelha calendar-recurrence.ts):
//   FREQ=DAILY|WEEKLY[;INTERVAL=n][;BYDAY=MO,WE,...][;UNTIL=ISO]
const RRULE_RE =
  /^FREQ=(DAILY|WEEKLY)(;INTERVAL=\d+)?(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)?(;UNTIL=[^;]+)?$/;

const recurrenceRuleSchema = z
  .string()
  .trim()
  .max(200)
  .regex(RRULE_RE, 'recurrenceRule inválido (use FREQ=DAILY|WEEKLY[;INTERVAL=n][;BYDAY=...][;UNTIL=ISO])');

const createSchema = z
  .object({
    calendarId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(300),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    type: eventTypeEnum.optional(),
    description: z.string().trim().max(5000).nullish(),
    location: z.string().trim().max(500).nullish(),
    meetingUrl: z.string().url().max(1000).nullish(),
    contactId: z.string().uuid().nullish(),
    dealId: z.string().uuid().nullish(),
    conversationId: z.string().uuid().nullish(),
    memberIds: z.array(z.string().uuid()).max(50).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    recurrenceRule: recurrenceRuleSchema.nullish(),
    recurrenceUntil: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((d) => new Date(d.startAt) < new Date(d.endAt), {
    message: 'startAt deve ser antes de endAt',
    path: ['endAt'],
  });

const updateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  type: eventTypeEnum.optional(),
  status: z.enum(['scheduled', 'confirmed', 'completed']).optional(),
  description: z.string().trim().max(5000).nullish(),
  location: z.string().trim().max(500).nullish(),
  meetingUrl: z.string().url().max(1000).nullish(),
  recurrenceRule: recurrenceRuleSchema.nullish(),
  recurrenceUntil: z.string().datetime({ offset: true }).nullish(),
});

/** calendarIds=a,b (CSV) ou repetido (?calendarIds=a&calendarIds=b). UUIDs válidos. */
function parseCalendarIds(raw: unknown): string[] {
  const flat: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) {
      const id = part.trim();
      if (id) flat.push(id);
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else push(raw);
  return Array.from(new Set(flat));
}

const rsvpSchema = z.object({
  rsvp: z.enum(['pending', 'accepted', 'declined', 'tentative']),
});

function canMutateEvent(event: typeof events.$inferSelect, member: { id: string; role: Role }): boolean {
  return event.createdBy === member.id || ADMIN_ROLES.has(member.role);
}

export function createEventsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('calendar.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('event.edit')] as const;

  // GET /api/events?calendarIds=a,b&from&to&contact
  //
  // Visibilidade (fecha o vazamento L1): SEMPRE escopa por `accessibleCalendarIds`
  // (S01). Sem `calendarIds` = TODOS os acessíveis (retrocompat: NÃO "todos do
  // workspace"). Com `calendarIds` = overlay = a interseção entre o pedido e o
  // acessível (um id inacessível é silenciosamente descartado, nunca vaza).
  //
  // Recorrência: eventos com `recurrenceRule` são expandidos em ocorrências virtuais
  // dentro da janela [from, to] (ids sintéticos `evt:<id>:<startISO>`). Sem janela,
  // expande a partir do startAt do mestre até um teto interno (sem `to` → não expande
  // séries abertas: devolve só o mestre).
  router.get('/api/events', ...viewGuard, async (req: Request, res: Response) => {
    const legacyCalendar =
      typeof req.query['calendar'] === 'string' ? req.query['calendar'] : undefined;
    const requestedRaw = req.query['calendarIds'];
    const requested = parseCalendarIds(
      requestedRaw ?? (legacyCalendar ? [legacyCalendar] : undefined),
    );
    const contactId = typeof req.query['contact'] === 'string' ? req.query['contact'] : undefined;
    const from = typeof req.query['from'] === 'string' ? new Date(req.query['from']) : null;
    const to = typeof req.query['to'] === 'string' ? new Date(req.query['to']) : null;
    const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
    const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

    const member = req.auth!.member;

    const rows = await req.scoped!(async (tx) => {
      const accessibleIds = await calendarRepo.accessibleCalendarIds(tx, {
        memberId: member.id,
        role: member.role as Role,
      });
      // Overlay: interseção pedido ∩ acessível. Sem pedido = todos os acessíveis.
      const scopedIds =
        requested.length > 0
          ? requested.filter((id) => accessibleIds.includes(id))
          : accessibleIds;
      if (scopedIds.length === 0) return [];

      const conds: SQL[] = [inArray(events.calendarId, scopedIds)];
      if (contactId) conds.push(eq(events.contactId, contactId));
      // Filtro de janela: inclui eventos que INTERSECTAM [from, to] (não só start ≥ from),
      // e SEMPRE inclui mestres recorrentes (recurrenceRule != null) p/ expandir depois.
      const windowConds: (SQL | undefined)[] = [];
      if (validTo) windowConds.push(lte(events.startAt, validTo));
      if (validFrom) windowConds.push(gte(events.endAt, validFrom));
      if (windowConds.length > 0) {
        const windowMatch = and(...windowConds);
        // Mestres recorrentes (recurrenceRule != null) sobrevivem ao filtro de janela
        // mesmo que o mestre esteja fora dela; a expansão recorta na janela em memória.
        conds.push(or(windowMatch, isNotNull(events.recurrenceRule))!);
      }

      return tx
        .select()
        .from(events)
        .where(and(...conds))
        .orderBy(asc(events.startAt));
    });

    // Expansão de recorrência na janela. Sem janela definida não expandimos séries
    // (evita materializar séries abertas); devolvemos o mestre como está.
    const expandFrom = validFrom ?? (validTo ? new Date(0) : null);
    const expandTo = validTo ?? (validFrom ? new Date(8640000000000000) : null);

    const out: (typeof events.$inferSelect)[] = [];
    for (const row of rows) {
      if (row.recurrenceRule && expandFrom && expandTo) {
        out.push(...expandOccurrences(row, expandFrom, expandTo));
      } else if (row.recurrenceRule && (!expandFrom || !expandTo)) {
        // Sem janela: não expande série aberta — devolve o mestre.
        out.push(row);
      } else {
        out.push(row);
      }
    }
    out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    res.json({ events: out });
  });

  router.post('/api/events', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    try {
      const event = await req.scoped!((tx) =>
        createEvent(
          tx,
          {
            workspaceId,
            // Ausente → o service resolve o pessoal do criador (provisiona se preciso).
            calendarId: d.calendarId ?? null,
            title: d.title,
            startAt: new Date(d.startAt),
            endAt: new Date(d.endAt),
            type: d.type,
            description: d.description ?? null,
            location: d.location ?? null,
            meetingUrl: d.meetingUrl ?? null,
            contactId: d.contactId ?? null,
            dealId: d.dealId ?? null,
            conversationId: d.conversationId ?? null,
            memberIds: d.memberIds,
            metadata: d.metadata,
            recurrenceRule: d.recurrenceRule ?? null,
            recurrenceUntil: d.recurrenceUntil ? new Date(d.recurrenceUntil) : null,
          },
          { type: 'member', memberId: req.auth!.member.id },
        ),
      );
      res.status(201).json({ event });
    } catch (err) {
      if (err instanceof EventServiceError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  });

  router.get('/api/events/:id', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id));
      if (!event) return null;
      const participants = await tx
        .select()
        .from(eventParticipants)
        .where(eq(eventParticipants.eventId, id));
      return { event, participants };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json(result);
  });

  router.put('/api/events/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const d = parsed.data;
    const member = { id: req.auth!.member.id, role: req.auth!.member.role as Role };
    const outcome = await req.scoped!(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id));
      if (!event) return { code: 'not_found' as const };
      if (!canMutateEvent(event, member)) return { code: 'forbidden' as const };

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (d.title !== undefined) patch['title'] = d.title;
      if (d.startAt !== undefined) patch['startAt'] = new Date(d.startAt);
      if (d.endAt !== undefined) patch['endAt'] = new Date(d.endAt);
      if (d.type !== undefined) patch['type'] = d.type;
      if (d.status !== undefined) patch['status'] = d.status;
      if (d.description !== undefined) patch['description'] = d.description;
      if (d.location !== undefined) patch['location'] = d.location;
      if (d.meetingUrl !== undefined) patch['meetingUrl'] = d.meetingUrl;
      // Recorrência: edição da SÉRIE (v1 aplica à série inteira — documentado).
      if (d.recurrenceRule !== undefined) patch['recurrenceRule'] = d.recurrenceRule;
      if (d.recurrenceUntil !== undefined) {
        patch['recurrenceUntil'] = d.recurrenceUntil ? new Date(d.recurrenceUntil) : null;
      }

      const nextStart = d.startAt ? new Date(d.startAt) : event.startAt;
      const nextEnd = d.endAt ? new Date(d.endAt) : event.endAt;
      if (nextEnd <= nextStart) return { code: 'invalid_range' as const };

      const [updated] = await tx.update(events).set(patch).where(eq(events.id, id)).returning();
      return { code: 'ok' as const, event: updated };
    });
    if (outcome.code === 'not_found') {
      res.sendStatus(404);
      return;
    }
    if (outcome.code === 'forbidden') {
      res.status(403).json({ message: 'Apenas o criador ou um admin pode editar este evento.' });
      return;
    }
    if (outcome.code === 'invalid_range') {
      res.status(422).json({ error: 'invalid_range', message: 'endAt deve ser depois de startAt.' });
      return;
    }
    res.json({ event: outcome.event });
  });

  router.post('/api/events/:id/cancel', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const member = { id: req.auth!.member.id, role: req.auth!.member.role as Role };
    const outcome = await req.scoped!(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, id));
      if (!event) return { code: 'not_found' as const };
      if (!canMutateEvent(event, member)) return { code: 'forbidden' as const };
      const cancelled = await cancelEvent(tx, id, {
        type: 'member',
        memberId: member.id,
      });
      return { code: 'ok' as const, event: cancelled };
    });
    if (outcome.code === 'not_found') {
      res.sendStatus(404);
      return;
    }
    if (outcome.code === 'forbidden') {
      res.status(403).json({ message: 'Apenas o criador ou um admin pode cancelar este evento.' });
      return;
    }
    res.json({ event: outcome.event });
  });

  // RSVP do member logado para um evento em que ele participa.
  router.post('/api/events/:id/rsvp', ...viewGuard, async (req: Request, res: Response) => {
    const parsed = rsvpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const memberId = req.auth!.member.id;
    const updated = await req.scoped!((tx) =>
      setRsvp(tx, { eventId: id, memberId, rsvp: parsed.data.rsvp }),
    );
    if (!updated) {
      res.status(404).json({ message: 'Você não é participante deste evento.' });
      return;
    }
    res.json({ participant: updated });
  });

  return router;
}
