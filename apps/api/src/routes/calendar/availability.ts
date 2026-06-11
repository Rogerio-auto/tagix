/**
 * API de disponibilidade (CALENDAR.md §3, §7). RLS via req.scoped, input via Zod.
 *
 *   GET    /api/availability/rules               regras do member logado    (calendar.view)
 *   PUT    /api/availability/rules               substitui em bulk          (availability.edit)
 *   GET    /api/availability/exceptions          excecoes do member logado  (calendar.view)
 *   POST   /api/availability/exceptions          cria excecao               (availability.edit)
 *   DELETE /api/availability/exceptions/:id       remove excecao             (availability.edit)
 *   GET    /api/availability/slots               wrapper de compute_available_slots (calendar.view)
 *
 * Ownership: rules/exceptions sao SEMPRE do member logado (`req.auth.member.id`).
 * Managers podem consultar slots de qualquer member via ?memberId; demais so de
 * si mesmos (forca memberId = member logado).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { availabilityRules, availabilityExceptions } = schema;

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

const MANAGER_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN', 'SUPERVISOR']);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM 24h
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(TIME_RE, 'Use HH:MM'),
    endTime: z.string().regex(TIME_RE, 'Use HH:MM'),
    isAvailable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((r) => r.startTime < r.endTime, {
    message: 'startTime deve ser antes de endTime',
    path: ['endTime'],
  });
const rulesBulkSchema = z.object({ rules: z.array(ruleSchema).max(100) });

const exceptionSchema = z
  .object({
    startDate: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    endDate: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    startTime: z.string().regex(TIME_RE, 'Use HH:MM').nullish(),
    endTime: z.string().regex(TIME_RE, 'Use HH:MM').nullish(),
    isAllDay: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((e) => e.startDate <= e.endDate, {
    message: 'startDate deve ser <= endDate',
    path: ['endDate'],
  });

const slotsQuerySchema = z.object({
  date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
  memberId: z.string().uuid().optional(),
  intervalMinutes: z.coerce.number().int().min(15).max(240).default(60),
  minNoticeMinutes: z.coerce.number().int().min(0).max(10080).default(30),
  bufferMinutes: z.coerce.number().int().min(0).max(240).default(15),
  maxSlots: z.coerce.number().int().min(1).max(50).default(10),
});

type SlotRow = {
  start_at: string;
  end_at: string;
  duration_minutes: number;
} & Record<string, unknown>;

export function createAvailabilityRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('calendar.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('availability.edit')] as const;

  router.get('/api/availability/rules', ...viewGuard, async (req: Request, res: Response) => {
    const memberId = req.auth!.member.id;
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(availabilityRules)
        .where(eq(availabilityRules.memberId, memberId))
        .orderBy(asc(availabilityRules.dayOfWeek), asc(availabilityRules.startTime)),
    );
    res.json({ rules: rows });
  });

  // Substitui o conjunto inteiro de regras do member logado (bulk).
  router.put('/api/availability/rules', ...editGuard, async (req: Request, res: Response) => {
    const parsed = rulesBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    const rows = await req.scoped!(async (tx) => {
      await tx.delete(availabilityRules).where(eq(availabilityRules.memberId, memberId));
      if (parsed.data.rules.length === 0) return [];
      return tx
        .insert(availabilityRules)
        .values(
          parsed.data.rules.map((r) => ({
            workspaceId,
            memberId,
            name: r.name,
            dayOfWeek: r.dayOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
            isAvailable: r.isAvailable ?? true,
            isActive: r.isActive ?? true,
          })),
        )
        .returning();
    });
    res.json({ rules: rows });
  });

  router.get('/api/availability/exceptions', ...viewGuard, async (req: Request, res: Response) => {
    const memberId = req.auth!.member.id;
    const rows = await req.scoped!((tx) =>
      tx
        .select()
        .from(availabilityExceptions)
        .where(eq(availabilityExceptions.memberId, memberId))
        .orderBy(asc(availabilityExceptions.startDate)),
    );
    res.json({ exceptions: rows });
  });

  router.post('/api/availability/exceptions', ...editGuard, async (req: Request, res: Response) => {
    const parsed = exceptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    const d = parsed.data;
    const [created] = await req.scoped!((tx) =>
      tx
        .insert(availabilityExceptions)
        .values({
          workspaceId,
          memberId,
          startDate: d.startDate,
          endDate: d.endDate,
          startTime: d.startTime ?? null,
          endTime: d.endTime ?? null,
          isAllDay: d.isAllDay ?? !(d.startTime || d.endTime),
          isAvailable: d.isAvailable ?? false,
          reason: d.reason ?? null,
        })
        .returning(),
    );
    res.status(201).json({ exception: created });
  });

  router.delete(
    '/api/availability/exceptions/:id',
    ...editGuard,
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      const memberId = req.auth!.member.id;
      const [deleted] = await req.scoped!((tx) =>
        tx
          .delete(availabilityExceptions)
          .where(
            and(
              eq(availabilityExceptions.id, id),
              eq(availabilityExceptions.memberId, memberId),
            ),
          )
          .returning({ id: availabilityExceptions.id }),
      );
      if (!deleted) {
        res.sendStatus(404);
        return;
      }
      res.sendStatus(204);
    },
  );

  // Wrapper REST de compute_available_slots (CALENDAR.md §3.1, §7).
  router.get('/api/availability/slots', ...viewGuard, async (req: Request, res: Response) => {
    const parsed = slotsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const q = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const role = req.auth!.member.role as Role;
    // Managers consultam qualquer member; demais ficam restritos a si mesmos.
    const memberId =
      q.memberId && MANAGER_ROLES.has(role) ? q.memberId : req.auth!.member.id;

    const rows = await req.scoped!(async (tx) => {
      const result = await tx.execute<SlotRow>(sql`
        SELECT start_at, end_at, duration_minutes
        FROM compute_available_slots(
          ${workspaceId}::uuid,
          ${memberId}::uuid,
          ${q.date}::date,
          ${q.intervalMinutes}::integer,
          ${q.minNoticeMinutes}::integer,
          ${q.bufferMinutes}::integer,
          ${q.maxSlots}::integer
        )
      `);
      return Array.from(result) as SlotRow[];
    });
    res.json({
      memberId,
      date: q.date,
      slots: rows.map((r) => ({
        startAt: r.start_at,
        endAt: r.end_at,
        durationMinutes: r.duration_minutes,
      })),
    });
  });

  return router;
}
