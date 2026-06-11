/**
 * API de eventos (CALENDAR.md §7). RLS via req.scoped, input via Zod. Criação
 * centralizada no event-service (ponto único reusado pelo agente em F7-S04).
 *
 *   GET    /api/events                lista (filtros: calendar, from, to, contact) (calendar.view)
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
import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  EventServiceError,
  cancelEvent,
  createEvent,
  setRsvp,
} from '../../services/event-service';

const { events, eventParticipants } = schema;

const ADMIN_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const eventTypeEnum = z.enum(['meeting', 'demo', 'follow_up', 'task', 'reminder', 'other']);

const createSchema = z
  .object({
    calendarId: z.string().uuid(),
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
});

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

  router.get('/api/events', ...viewGuard, async (req: Request, res: Response) => {
    const calendarId = typeof req.query['calendar'] === 'string' ? req.query['calendar'] : undefined;
    const contactId = typeof req.query['contact'] === 'string' ? req.query['contact'] : undefined;
    const from = typeof req.query['from'] === 'string' ? new Date(req.query['from']) : null;
    const to = typeof req.query['to'] === 'string' ? new Date(req.query['to']) : null;
    const conds: SQL[] = [];
    if (calendarId) conds.push(eq(events.calendarId, calendarId));
    if (contactId) conds.push(eq(events.contactId, contactId));
    if (from && !Number.isNaN(from.getTime())) conds.push(gte(events.startAt, from));
    if (to && !Number.isNaN(to.getTime())) conds.push(lte(events.startAt, to));
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(events)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(events.startAt)),
    );
    res.json({ events: rows });
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
            calendarId: d.calendarId,
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
