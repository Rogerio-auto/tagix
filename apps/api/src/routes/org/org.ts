/**
 * Estrutura organizacional do workspace (F8-S07): departamentos, times,
 * membros de time e regras de SLA. Tabelas criadas em F8-S01.
 *
 *   GET/POST            /api/departments              (workspace.edit / department.edit)
 *   PATCH/DELETE        /api/departments/:id
 *   GET/POST            /api/teams                    (team.edit)
 *   PATCH/DELETE        /api/teams/:id
 *   PUT/DELETE          /api/teams/:id/members/:memberId  (add/remove membro)
 *   GET/PUT             /api/sla                       (workspace.edit) — upsert por escopo
 *
 * RLS por scoped em todas. DELETE é archive (is_active='archived') p/ departments/
 * teams — preserva FKs históricas em conversations/calendars.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { departments, teams, teamMembers, slaRules, members } = schema;

const deptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
});
const deptUpdateSchema = deptSchema.partial().extend({
  isActive: z.enum(['active', 'archived']).optional(),
});

const teamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  departmentId: z.string().uuid().nullish(),
  autoAssignStrategy: z.enum(['round_robin', 'least_busy', 'manual']).optional(),
});
const teamUpdateSchema = teamSchema.partial().extend({
  isActive: z.enum(['active', 'archived']).optional(),
});

const teamMemberSchema = z.object({ role: z.enum(['lead', 'member']).default('member') });

const slaSchema = z.object({
  scopeType: z.enum(['workspace', 'department', 'team']).default('workspace'),
  scopeId: z.string().uuid().nullish(),
  firstResponseSecs: z.number().int().positive().nullish(),
  resolutionSecs: z.number().int().positive().nullish(),
});

function pgErr(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
}

export function createOrgRouter(): Router {
  const router = Router();
  const deptGuard = [requireAuth, withRLS, requireRole('department.edit')] as const;
  const teamGuard = [requireAuth, withRLS, requireRole('team.edit')] as const;
  const wsGuard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;

  // ─── Departments ───────────────────────────────────────────────────────────
  router.get('/api/departments', ...deptGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx.select().from(departments).orderBy(asc(departments.name)),
    );
    res.json({ departments: rows });
  });

  router.post('/api/departments', ...deptGuard, async (req: Request, res: Response) => {
    const parsed = deptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(departments)
          .values({ workspaceId, name: parsed.data.name, description: parsed.data.description ?? null })
          .returning(),
      );
      res.status(201).json({ department: created });
    } catch (err) {
      if (pgErr(err) === '23505') {
        res.status(409).json({ error: 'duplicate_name' });
        return;
      }
      throw err;
    }
  });

  router.patch('/api/departments/:id', ...deptGuard, async (req: Request, res: Response) => {
    const parsed = deptUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) patch[k] = v;
    try {
      const [updated] = await req.scoped!((tx) =>
        tx.update(departments).set(patch).where(eq(departments.id, id)).returning(),
      );
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ department: updated });
    } catch (err) {
      if (pgErr(err) === '23505') {
        res.status(409).json({ error: 'duplicate_name' });
        return;
      }
      throw err;
    }
  });

  router.delete('/api/departments/:id', ...deptGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(departments)
        .set({ isActive: 'archived', updatedAt: new Date() })
        .where(eq(departments.id, id))
        .returning({ id: departments.id }),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  // ─── Teams ─────────────────────────────────────────────────────────────────
  router.get('/api/teams', ...teamGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!(async (tx) => {
      const teamRows = await tx.select().from(teams).orderBy(asc(teams.name));
      const memberRows = await tx
        .select({
          teamId: teamMembers.teamId,
          memberId: teamMembers.memberId,
          role: teamMembers.role,
          name: members.name,
          email: members.email,
        })
        .from(teamMembers)
        .innerJoin(members, eq(members.id, teamMembers.memberId));
      return teamRows.map((t) => ({
        ...t,
        members: memberRows.filter((m) => m.teamId === t.id),
      }));
    });
    res.json({ teams: rows });
  });

  router.post('/api/teams', ...teamGuard, async (req: Request, res: Response) => {
    const parsed = teamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(teams)
          .values({
            workspaceId,
            name: d.name,
            description: d.description ?? null,
            departmentId: d.departmentId ?? null,
            autoAssignStrategy: d.autoAssignStrategy ?? 'manual',
          })
          .returning(),
      );
      res.status(201).json({ team: created });
    } catch (err) {
      if (pgErr(err) === '23505') {
        res.status(409).json({ error: 'duplicate_name' });
        return;
      }
      throw err;
    }
  });

  router.patch('/api/teams/:id', ...teamGuard, async (req: Request, res: Response) => {
    const parsed = teamUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) patch[k] = v;
    try {
      const [updated] = await req.scoped!((tx) =>
        tx.update(teams).set(patch).where(eq(teams.id, id)).returning(),
      );
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ team: updated });
    } catch (err) {
      if (pgErr(err) === '23505') {
        res.status(409).json({ error: 'duplicate_name' });
        return;
      }
      throw err;
    }
  });

  router.delete('/api/teams/:id', ...teamGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(teams)
        .set({ isActive: 'archived', updatedAt: new Date() })
        .where(eq(teams.id, id))
        .returning({ id: teams.id }),
    );
    if (!updated) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  // ─── Team members ──────────────────────────────────────────────────────────
  router.put('/api/teams/:id/members/:memberId', ...teamGuard, async (req: Request, res: Response) => {
    const parsed = teamMemberSchema.safeParse(req.body ?? {});
    const role = parsed.success ? parsed.data.role : 'member';
    const teamId = param(req, 'id');
    const memberId = param(req, 'memberId');
    const workspaceId = req.auth!.workspace.id;

    const ok = await req.scoped!(async (tx) => {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
      const [member] = await tx.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
      if (!team || !member) return false;
      await tx
        .insert(teamMembers)
        .values({ teamId, memberId, workspaceId, role })
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.memberId],
          set: { role },
        });
      return true;
    });
    if (!ok) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  router.delete('/api/teams/:id/members/:memberId', ...teamGuard, async (req: Request, res: Response) => {
    const teamId = param(req, 'id');
    const memberId = param(req, 'memberId');
    const [removed] = await req.scoped!((tx) =>
      tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.memberId, memberId)))
        .returning({ memberId: teamMembers.memberId }),
    );
    if (!removed) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  // ─── SLA rules ─────────────────────────────────────────────────────────────
  router.get('/api/sla', ...wsGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) => tx.select().from(slaRules).orderBy(asc(slaRules.scopeType)));
    res.json({ rules: rows });
  });

  // Upsert por (workspace, scope). Limites null = sem limite.
  router.put('/api/sla', ...wsGuard, async (req: Request, res: Response) => {
    const parsed = slaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    if (d.scopeType === 'workspace' && d.scopeId != null) {
      res.status(400).json({ error: 'invalid_scope', message: 'Escopo workspace não usa scopeId.' });
      return;
    }
    if (d.scopeType !== 'workspace' && d.scopeId == null) {
      res.status(400).json({ error: 'invalid_scope', message: 'Escopo department/team exige scopeId.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const [rule] = await req.scoped!((tx) =>
      tx
        .insert(slaRules)
        .values({
          workspaceId,
          scopeType: d.scopeType,
          scopeId: d.scopeId ?? null,
          firstResponseSecs: d.firstResponseSecs ?? null,
          resolutionSecs: d.resolutionSecs ?? null,
        })
        .onConflictDoUpdate({
          target: [slaRules.workspaceId, slaRules.scopeType, slaRules.scopeId],
          set: {
            firstResponseSecs: d.firstResponseSecs ?? null,
            resolutionSecs: d.resolutionSecs ?? null,
            isActive: 'active',
            updatedAt: new Date(),
          },
        })
        .returning(),
    );
    res.json({ rule });
  });

  return router;
}
