/**
 * Workspace settings + membros (F8-S07, PERMISSIONS §5.2).
 *
 *   GET    /api/workspace                 info atual (workspace.edit)
 *   PATCH  /api/workspace                 info/marca/horário/auto-assign (workspace.edit)
 *   GET    /api/members                   lista membros (member.invite)
 *   POST   /api/members                   410 Gone — convite agora é /api/members/invites (F71-S05)
 *   PATCH  /api/members/:id               troca role / status (member.promote)
 *   DELETE /api/members/:id               remove membro (member.remove)
 *
 * Guard de role-change (§5.1): só OWNER pode promover a/destituir OWNER. Ninguém
 * pode rebaixar/remover o último OWNER (workspace ficaria sem dono). RLS por scoped.
 *
 * F71-S05: reativar (`status: 'active'`) ocupa um assento de `max_members` (402
 * `seat_limit` se não cabe) e nunca promove linha `invited` — essa só sai pelo aceite do
 * convite ou pelo verify do dono (T6). Bloquear ou remover um membro revoga os convites
 * pendentes do email dele na empresa (auditado), para nenhum link antigo trazê-lo de volta.
 * `:id` fora do formato UUID → 404 (inclui `PATCH/DELETE /api/members/invites`, que não
 * existem e não podem virar 500 no Postgres).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@hm/db';
import { ROLES } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';
import { disconnectMemberSockets } from '../../socket/member-disconnect';
import { revokePendingInvitesFor, seatUsage, seatsAvailable } from './invites';

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

const memberIdSchema = z.string().uuid();

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
  // `member.invite`: é a seção da UI que convida/gerencia (F71-S05). `legacyInvite` marca
  // um "convite" antigo (`invited` com `invited_by`) que a migração da S01 não moveu.
  router.get('/api/members', ...inviteGuard, async (req: Request, res: Response) => {
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
          invitedBy: members.invitedBy,
        })
        .from(members),
    );
    res.json({
      members: rows.map(({ invitedBy, ...row }) => ({
        ...row,
        legacyInvite: row.status === 'invited' && invitedBy !== null,
      })),
    });
  });

  // ─── POST /api/members — legado (F71-S05) ──────────────────────────────────
  // 410 em vez de delegar: o contrato antigo aceitava `name` e OWNER, devolvia `{ member }`
  // (uma linha `invited` com `authUserId` falso) e não mandava email. Delegar manteria um
  // segundo contrato com outra semântica e enganaria o cliente antigo; o 410 falha alto e
  // aponta o substituto. Guard antes do 410: anônimo continua 401, sem permissão 403.
  router.post('/api/members', ...inviteGuard, (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'gone',
      message: 'Convites agora são criados em /api/members/invites.',
      replacement: '/api/members/invites',
    });
  });

  // ─── PATCH /api/members/:id — troca role/status ────────────────────────────
  router.patch('/api/members/:id', ...promoteGuard, async (req: Request, res: Response) => {
    if (!memberIdSchema.safeParse(param(req, 'id')).success) {
      res.sendStatus(404);
      return;
    }
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success || (parsed.data.role === undefined && parsed.data.status === undefined)) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.success ? [] : parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const actorRole = req.auth!.member.role;
    const workspaceId = req.auth!.workspace.id;
    // Reativar ocupa assento: conferido antes da transação (o uso conta convites vivos,
    // que o repo lê em outra conexão).
    const seats = parsed.data.status === 'active' ? await seatUsage(workspaceId) : null;

    const outcome = await req.scoped!(async (tx) => {
      const [target] = await tx.select().from(members).where(eq(members.id, id)).limit(1);
      if (!target) return { kind: 'not_found' as const };

      const activating = parsed.data.status === 'active' && target.status !== 'active';
      // `invited` só vira `active` pelo aceite do convite ou pelo verify do dono (T6).
      if (activating && target.status === 'invited') return { kind: 'invite_pending' as const };
      if (activating && seats && !seatsAvailable(seats, 1)) {
        return { kind: 'seat_limit' as const, seats };
      }

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
      case 'invite_pending':
        res.status(409).json({
          error: 'invite_pending',
          message: 'Este membro ainda não aceitou o convite.',
        });
        return;
      case 'seat_limit':
        res.status(402).json({
          error: 'seat_limit',
          message: 'O plano atingiu o limite de membros. Remova alguém ou mude de plano.',
          used: outcome.seats.used,
          limit: outcome.seats.limit,
        });
        return;
      default:
        if (outcome.member && (parsed.data.status === 'blocked' || parsed.data.status === 'inactive')) {
          // F-03: sessão em tempo real do membro cai junto (após o commit).
          await disconnectMemberSockets(id);
          await revokePendingInvitesFor(
            req,
            workspaceId,
            outcome.member.email,
            parsed.data.status === 'blocked' ? 'member_blocked' : 'member_removed',
          );
        }
        res.json({ member: outcome.member });
    }
  });

  // ─── DELETE /api/members/:id — remove ──────────────────────────────────────
  router.delete('/api/members/:id', ...removeGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!memberIdSchema.safeParse(id).success) {
      res.sendStatus(404);
      return;
    }
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
      return { kind: 'ok' as const, email: target.email };
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
        await disconnectMemberSockets(id);
        await revokePendingInvitesFor(req, req.auth!.workspace.id, outcome.email, 'member_removed');
        res.sendStatus(204);
    }
  });

  return router;
}
