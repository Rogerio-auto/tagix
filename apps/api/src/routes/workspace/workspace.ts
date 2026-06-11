/**
 * Workspace settings + membros (F8-S07, PERMISSIONS §5.2).
 *
 *   GET    /api/workspace                 info atual (workspace.edit)
 *   PATCH  /api/workspace                 info/marca/horário/auto-assign (workspace.edit)
 *   GET    /api/members                   lista membros (workspace.edit)
 *   POST   /api/members                   convida (member.invite)
 *   PATCH  /api/members/:id               troca role / status (member.promote)
 *   DELETE /api/members/:id               remove membro (member.remove)
 *
 * Guard de role-change (§5.1): só OWNER pode promover a/destituir OWNER. Ninguém
 * pode rebaixar/remover o último OWNER (workspace ficaria sem dono). RLS por scoped.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema } from '@hm/db';
import { ROLES } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { workspaces, members } = schema;

const businessHoursSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().max(64).optional(),
  // 7 dias (0=domingo). Cada dia: aberto + janelas "HH:MM-HH:MM".
  days: z
    .array(
      z.object({
        open: z.boolean(),
        from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      }),
    )
    .length(7)
    .optional(),
  awayMessage: z.string().trim().max(1000).optional(),
});

const autoAssignSchema = z.object({
  strategy: z.enum(['round_robin', 'least_busy', 'manual']),
  fallbackToManual: z.boolean().optional(),
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().max(64).optional(),
    locale: z.string().trim().max(16).optional(),
    industry: z.string().trim().max(120).nullish(),
    logoUrl: z.string().trim().url().max(2000).nullish(),
    // Marca: cor é input livre do usuário (hex permitido — não é token de DS).
    brandColor: z.string().trim().max(32).nullish(),
    businessHours: businessHoursSchema.optional(),
    autoAssign: autoAssignSchema.optional(),
  })
  .strict();

const inviteSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).nullish(),
  role: z.enum(ROLES).default('AGENT'),
});

const updateMemberSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(['active', 'inactive', 'blocked']).optional(),
  })
  .strict();

export function createWorkspaceRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;
  const inviteGuard = [requireAuth, withRLS, requireRole('member.invite')] as const;
  const promoteGuard = [requireAuth, withRLS, requireRole('member.promote')] as const;
  const removeGuard = [requireAuth, withRLS, requireRole('member.remove')] as const;

  // ─── GET /api/workspace ────────────────────────────────────────────────────
  router.get('/api/workspace', ...editGuard, async (req: Request, res: Response) => {
    const id = req.auth!.workspace.id;
    const [ws] = await req.scoped!((tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1),
    );
    if (!ws) {
      res.sendStatus(404);
      return;
    }
    res.json({ workspace: ws });
  });

  // ─── PATCH /api/workspace ──────────────────────────────────────────────────
  router.patch('/api/workspace', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = req.auth!.workspace.id;
    const d = parsed.data;

    const result = await req.scoped!(async (tx) => {
      const [current] = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
      if (!current) return null;

      // Campos jsonb (marca/horário/auto-assign) vão no `settings` mesclado.
      const nextSettings: Record<string, unknown> = { ...current.settings };
      if (d.brandColor !== undefined) nextSettings['brand_color'] = d.brandColor;
      if (d.businessHours !== undefined) nextSettings['business_hours'] = d.businessHours;
      if (d.autoAssign !== undefined) nextSettings['auto_assign'] = d.autoAssign;

      const patch: Record<string, unknown> = { updatedAt: new Date(), settings: nextSettings };
      if (d.name !== undefined) patch['name'] = d.name;
      if (d.timezone !== undefined) patch['timezone'] = d.timezone;
      if (d.locale !== undefined) patch['locale'] = d.locale;
      if (d.industry !== undefined) patch['industry'] = d.industry;
      if (d.logoUrl !== undefined) patch['logoUrl'] = d.logoUrl;

      const [updated] = await tx
        .update(workspaces)
        .set(patch)
        .where(eq(workspaces.id, id))
        .returning();
      return updated ?? null;
    });

    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ workspace: result });
  });

  // ─── GET /api/members ──────────────────────────────────────────────────────
  router.get('/api/members', ...editGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select({
          id: members.id,
          email: members.email,
          name: members.name,
          role: members.role,
          status: members.status,
          avatarUrl: members.avatarUrl,
          isOnline: members.isOnline,
          lastSeenAt: members.lastSeenAt,
          createdAt: members.createdAt,
        })
        .from(members),
    );
    res.json({ members: rows });
  });

  // ─── POST /api/members — convida ───────────────────────────────────────────
  router.post('/api/members', ...inviteGuard, async (req: Request, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { email, name, role } = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const invitedBy = req.auth!.member.id;

    // Só OWNER pode convidar diretamente como OWNER.
    if (role === 'OWNER' && req.auth!.member.role !== 'OWNER') {
      res.status(403).json({ error: 'forbidden_owner', message: 'Apenas OWNER pode designar OWNER.' });
      return;
    }

    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(members)
          .values({
            workspaceId,
            // Placeholder até o primeiro login casar por email no provider.
            authUserId: randomUUID(),
            email,
            name: name ?? null,
            role,
            status: 'invited',
            invitedBy,
            invitedAt: new Date(),
          })
          .returning({
            id: members.id,
            email: members.email,
            name: members.name,
            role: members.role,
            status: members.status,
          }),
      );
      res.status(201).json({ member: created });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_email', message: 'Já existe um membro com esse e-mail.' });
        return;
      }
      throw err;
    }
  });

  // ─── PATCH /api/members/:id — troca role/status ────────────────────────────
  router.patch('/api/members/:id', ...promoteGuard, async (req: Request, res: Response) => {
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success || (parsed.data.role === undefined && parsed.data.status === undefined)) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.success ? [] : parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const actorRole = req.auth!.member.role;

    const outcome = await req.scoped!(async (tx) => {
      const [target] = await tx.select().from(members).where(eq(members.id, id)).limit(1);
      if (!target) return { kind: 'not_found' as const };

      const nextRole = parsed.data.role ?? target.role;

      // Mexer com OWNER (promover a OWNER ou destituir um OWNER) exige ser OWNER.
      const touchesOwner = nextRole === 'OWNER' || target.role === 'OWNER';
      if (touchesOwner && actorRole !== 'OWNER') {
        return { kind: 'forbidden_owner' as const };
      }

      // Não deixar o workspace sem OWNER: se está rebaixando/bloqueando o último OWNER.
      const demotingOwner =
        target.role === 'OWNER' &&
        ((parsed.data.role && parsed.data.role !== 'OWNER') || parsed.data.status === 'blocked');
      if (demotingOwner) {
        const otherOwners = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.role, 'OWNER'), ne(members.id, id)));
        if (otherOwners.length === 0) return { kind: 'last_owner' as const };
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.role !== undefined) patch['role'] = parsed.data.role;
      if (parsed.data.status !== undefined) patch['status'] = parsed.data.status;

      const [updated] = await tx
        .update(members)
        .set(patch)
        .where(eq(members.id, id))
        .returning({
          id: members.id,
          email: members.email,
          name: members.name,
          role: members.role,
          status: members.status,
        });
      return { kind: 'ok' as const, member: updated };
    });

    switch (outcome.kind) {
      case 'not_found':
        res.sendStatus(404);
        return;
      case 'forbidden_owner':
        res.status(403).json({ error: 'forbidden_owner', message: 'Apenas OWNER altera papéis de OWNER.' });
        return;
      case 'last_owner':
        res.status(409).json({ error: 'last_owner', message: 'O workspace precisa de ao menos um OWNER.' });
        return;
      default:
        res.json({ member: outcome.member });
    }
  });

  // ─── DELETE /api/members/:id — remove ──────────────────────────────────────
  router.delete('/api/members/:id', ...removeGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const actorMemberId = req.auth!.member.id;
    if (id === actorMemberId) {
      res.status(409).json({ error: 'cannot_remove_self', message: 'Você não pode remover a si mesmo.' });
      return;
    }
    const actorRole = req.auth!.member.role;

    const outcome = await req.scoped!(async (tx) => {
      const [target] = await tx.select().from(members).where(eq(members.id, id)).limit(1);
      if (!target) return { kind: 'not_found' as const };
      if (target.role === 'OWNER') {
        if (actorRole !== 'OWNER') return { kind: 'forbidden_owner' as const };
        const otherOwners = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.role, 'OWNER'), ne(members.id, id)));
        if (otherOwners.length === 0) return { kind: 'last_owner' as const };
      }
      await tx
        .update(members)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(members.id, id));
      return { kind: 'ok' as const };
    });

    switch (outcome.kind) {
      case 'not_found':
        res.sendStatus(404);
        return;
      case 'forbidden_owner':
        res.status(403).json({ error: 'forbidden_owner', message: 'Apenas OWNER remove um OWNER.' });
        return;
      case 'last_owner':
        res.status(409).json({ error: 'last_owner', message: 'O workspace precisa de ao menos um OWNER.' });
        return;
      default:
        res.sendStatus(204);
    }
  });

  return router;
}
