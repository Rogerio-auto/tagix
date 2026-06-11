/**
 * CRUD de calendars (CALENDAR.md §7). RLS via req.scoped, input via Zod.
 * Guards: list/get -> calendar.view (ALL); create/update/delete -> calendar.manage
 * (MANAGERS). Acesso fino ao calendar especifico (personal/team/workspace) via
 * requireCalendarAccess (§8) nas rotas por :id.
 *
 * Endpoints:
 *   GET    /api/calendars              lista do workspace          (calendar.view)
 *   POST   /api/calendars              cria                        (calendar.manage)
 *   GET    /api/calendars/:id          detalhe                     (calendar.view + access)
 *   PUT    /api/calendars/:id          update                      (calendar.manage + access)
 *   DELETE /api/calendars/:id          remove (hard delete)        (calendar.manage + access)
 *   GET    /api/calendars/:id/events   lista eventos do calendar   (calendar.view + access)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { requireCalendarAccess } from '../../middlewares/calendar-access';

const { calendars, events } = schema;

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['personal', 'team', 'workspace']),
  ownerId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color deve ser hex #RRGGBB')
    .optional(),
  description: z.string().trim().max(2000).nullish(),
  timezone: z.string().trim().min(1).max(64).optional(),
  isDefault: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ type: true });

export function createCalendarsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('calendar.view')] as const;
  const manageGuard = [requireAuth, withRLS, requireRole('calendar.manage')] as const;

  router.get('/api/calendars', ...viewGuard, async (req: Request, res: Response) => {
    const typeFilter = typeof req.query['type'] === 'string' ? req.query['type'] : undefined;
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(calendars)
        .where(typeFilter ? eq(calendars.type, typeFilter) : undefined)
        .orderBy(desc(calendars.isDefault), asc(calendars.name)),
    );
    res.json({ calendars: rows });
  });

  router.post('/api/calendars', ...manageGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const result = await req.scoped!(async (tx) => {
      // Garante no maximo um calendar default por workspace.
      if (d.isDefault) {
        await tx
          .update(calendars)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(calendars.isDefault, true));
      }
      const [created] = await tx
        .insert(calendars)
        .values({
          workspaceId,
          name: d.name,
          type: d.type,
          ownerId: d.ownerId ?? null,
          teamId: d.teamId ?? null,
          color: d.color ?? '#1FFF13',
          description: d.description ?? null,
          timezone: d.timezone ?? req.auth!.workspace.timezone ?? 'America/Sao_Paulo',
          isDefault: d.isDefault ?? false,
        })
        .returning();
      return created;
    });
    res.status(201).json({ calendar: result });
  });

  router.get(
    '/api/calendars/:id',
    ...viewGuard,
    requireCalendarAccess('id'),
    (req: Request, res: Response) => {
      res.json({ calendar: req.calendar });
    },
  );

  router.put(
    '/api/calendars/:id',
    ...manageGuard,
    requireCalendarAccess('id'),
    async (req: Request, res: Response) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const id = param(req, 'id');
      const d = parsed.data;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (d.name !== undefined) patch['name'] = d.name;
      if (d.ownerId !== undefined) patch['ownerId'] = d.ownerId;
      if (d.teamId !== undefined) patch['teamId'] = d.teamId;
      if (d.color !== undefined) patch['color'] = d.color;
      if (d.description !== undefined) patch['description'] = d.description;
      if (d.timezone !== undefined) patch['timezone'] = d.timezone;
      if (d.isDefault !== undefined) patch['isDefault'] = d.isDefault;

      const updated = await req.scoped!(async (tx) => {
        if (d.isDefault) {
          await tx
            .update(calendars)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(calendars.isDefault, true));
        }
        const [row] = await tx
          .update(calendars)
          .set(patch)
          .where(eq(calendars.id, id))
          .returning();
        return row;
      });
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ calendar: updated });
    },
  );

  router.delete(
    '/api/calendars/:id',
    ...manageGuard,
    requireCalendarAccess('id'),
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      const [deleted] = await req.scoped!((tx) =>
        tx.delete(calendars).where(eq(calendars.id, id)).returning({ id: calendars.id }),
      );
      if (!deleted) {
        res.sendStatus(404);
        return;
      }
      res.sendStatus(204);
    },
  );

  // Lista eventos de um calendar (filtros opcionais from/to em ISO).
  router.get(
    '/api/calendars/:id/events',
    ...viewGuard,
    requireCalendarAccess('id'),
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      const from = typeof req.query['from'] === 'string' ? new Date(req.query['from']) : null;
      const to = typeof req.query['to'] === 'string' ? new Date(req.query['to']) : null;
      const conds = [eq(events.calendarId, id)];
      if (from && !Number.isNaN(from.getTime())) conds.push(gte(events.startAt, from));
      if (to && !Number.isNaN(to.getTime())) conds.push(lte(events.startAt, to));
      const rows = await req.scoped!((tx) =>
        tx
          .select()
          .from(events)
          .where(and(...conds))
          .orderBy(asc(events.startAt)),
      );
      res.json({ events: rows });
    },
  );

  return router;
}
