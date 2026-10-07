/**
 * Convites de membros — lado do admin (F71-S05, CONTAS_E_CONVITES §3, §5 e §6).
 *
 *   GET    /api/members/invites              pendentes da empresa + uso de assentos
 *   POST   /api/members/invites              convida (ou reenvia, se já há convite vivo)
 *   POST   /api/members/invites/:id/resend   reenvia: token novo, o link anterior morre
 *   DELETE /api/members/invites/:id          revoga
 *   POST   /api/members/invites/:id/link     token novo + link para copiar (fallback sem email)
 *
 * Todas exigem `member.invite` (OWNER/ADMIN) e rodam na empresa ativa da sessão; o repo
 * (`invitesRepo`) filtra por `workspace_id` E roda sob a RLS dessa empresa, então um id de
 * convite de outra empresa é indistinguível de um id inexistente (404).
 *
 * ## Token (T1)
 *
 * 32 bytes aleatórios em base64url; o banco guarda só o sha256. O token em claro existe em
 * dois lugares e em mais nenhum: o link do email (montado pelo provider de auth) e a resposta
 * de "copiar link" ao admin autorizado. Nunca vai para log, auditoria nem mensagem de erro.
 * Reenviar e copiar o link TROCAM o token (não há como recuperar o anterior).
 *
 * ## Limites (T8)
 *
 * - `max_members` do plano (override > plano, `resolveEntitlements`): membros ativos +
 *   convites vivos. Chave ausente = ilimitado. Estouro → 402 `seat_limit`. A checagem roda
 *   DEPOIS de gravar o convite (e o revoga se estourou): dois convites simultâneos nunca
 *   deixam a empresa acima do teto.
 * - Cota de email no Redis, consumida ANTES do envio (`invite-quota.ts`): 30 por hora por
 *   empresa e 10 por dia por destinatário somando todas as empresas (revogar + recriar não
 *   zera). Estouro → 429 `invite_rate_limited` uniforme (não diz qual teto, para o admin
 *   não saber que outra empresa mandou email para o mesmo endereço).
 * - Reenvio: 1 por minuto por convite e no máximo 5 reenvios (6 envios no total).
 *
 * ## Entrega
 *
 * Quem já tem conta com senha recebe o "Magic link" (`sendSignInLink`); os demais, o
 * "Invite user" (`sendInvite`). Falha do provider NÃO desfaz o convite: a resposta diz
 * `delivery: 'failed'` e a UI oferece o link copiável (§3.1).
 */
import { isIP } from 'node:net';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  generateInviteToken,
  invitesRepo,
  isInvitableRole,
  schema,
  withWorkspace,
  type DbTx,
  type MemberInviteView,
} from '@hm/db';
import { AuthError, resolveEmailRedirect, type IAccountAuthProvider } from '@hm/shared';
import { createLogger, type Logger } from '@hm/logger';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { clientIp } from '../../middlewares/rate-limit';
import { getAuthProvider } from '../../auth/provider';
import { resolveEntitlements } from '../../services/platform/entitlements';
import {
  createInviteSendQuota,
  InviteQuotaUnavailableError,
  type InviteQuotaResult,
  type InviteSendQuota,
} from './invite-quota';

const { auditLogs, departments, members } = schema;

// ─── Constantes do contrato ─────────────────────────────────────────────────────

/** Ações de auditoria dos convites (T9). Gravadas em `audit_logs` com `workspace_id`. */
export const INVITE_AUDIT_ACTIONS = {
  invited: 'member.invited',
  resent: 'member.invite_resent',
  revoked: 'member.invite_revoked',
  linkCopied: 'member.invite_link_copied',
  /** Email pedido pela página pública do convite (link copiado, `POST /auth/invite/send-email`). */
  emailRequested: 'member.invite_email_requested',
  joined: 'member.joined',
  /** Aceite público negado (prova rejeitada, conta errada, login pendente, conflito) — F-16. */
  acceptDenied: 'member.invite_accept_denied',
} as const;

/** Envios por convite: 1 original + 5 reenvios. */
export const MAX_INVITE_SENDS = 6;
/** Intervalo mínimo entre dois envios do mesmo convite. */
export const INVITE_RESEND_COOLDOWN_SEC = 60;
/** Envios de email de convite por empresa por hora (cota no Redis, `invite-quota.ts`). */
export { INVITE_SENDS_PER_WORKSPACE_HOUR as INVITES_PER_HOUR } from './invite-quota';

/** Caminho do app que abre o convite. O provider resolve contra `AUTH_EMAIL_REDIRECT_URL`. */
export function invitePath(token: string): string {
  return `/convite/${token}`;
}

/**
 * URL absoluta do convite para o admin copiar. Mesma base dos links de email
 * (`AUTH_EMAIL_REDIRECT_URL`, depois `APP_PUBLIC_URL`); fora de produção, sem base
 * configurada, a origem local do web. `null` = sem base válida (a rota responde 503).
 */
export function inviteUrl(token: string): string | null {
  const isProd = process.env['NODE_ENV'] === 'production';
  const base =
    process.env['AUTH_EMAIL_REDIRECT_URL'] ||
    process.env['APP_PUBLIC_URL'] ||
    (isProd ? undefined : 'http://localhost:3000');
  return resolveEmailRedirect(invitePath(token), base);
}

// ─── Assentos (max_members) ─────────────────────────────────────────────────────

export interface SeatUsage {
  /** Membros ativos + convites vivos. */
  readonly used: number;
  /** Teto do plano; null = ilimitado. */
  readonly limit: number | null;
}

/** Uso de assentos da empresa: `active` + convites vivos contra `max_members`. */
export async function seatUsage(workspaceId: string): Promise<SeatUsage> {
  const [entitlements, activeRows, pending] = await Promise.all([
    resolveEntitlements(workspaceId),
    withWorkspace(workspaceId, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(members)
        .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'))),
    ),
    invitesRepo.countPending(workspaceId),
  ]);
  const raw = entitlements?.limits['max_members'];
  const limit = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
  return { used: (activeRows[0]?.n ?? 0) + pending, limit };
}

/** `true` se cabem mais `extra` assentos além do uso atual. */
export function seatsAvailable(usage: SeatUsage, extra: number): boolean {
  return usage.limit === null || usage.used + extra <= usage.limit;
}

function respondSeatLimit(res: Response, usage: SeatUsage): void {
  res.status(402).json({
    error: 'seat_limit',
    message: 'O plano atingiu o limite de membros. Remova alguém ou mude de plano.',
    used: usage.used,
    limit: usage.limit,
  });
}

// ─── Auditoria ──────────────────────────────────────────────────────────────────

export interface WorkspaceAuditEntry {
  readonly workspaceId: string;
  readonly actorMemberId: string | null;
  /** Default `member`. `system` para eventos sem membro (rota pública do convite). */
  readonly actorType?: 'member' | 'system';
  readonly action: string;
  readonly resourceId: string;
  /** NUNCA o token do convite nem o hash dele. */
  readonly metadata: Record<string, unknown>;
}

/**
 * Grava a trilha do convite em `audit_logs` (com `workspace_id`), pelo mesmo mecanismo das
 * rotas de workspace (`ai-origin-lock.ts`): insert sob a RLS da empresa, IP só quando é IP.
 */
export async function recordWorkspaceAudit(
  tx: DbTx,
  req: Request,
  entry: WorkspaceAuditEntry,
): Promise<void> {
  const ip = clientIp(req);
  const ua = req.headers['user-agent'];
  await tx.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    actorMemberId: entry.actorMemberId,
    actorType: entry.actorType ?? 'member',
    action: entry.action,
    resourceType: 'member_invite',
    resourceId: entry.resourceId,
    metadata: entry.metadata,
    ipAddress: isIP(ip) === 0 ? null : ip,
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
  });
}

// ─── Serialização ───────────────────────────────────────────────────────────────

/** Convite como a API devolve ao admin. Nunca carrega token nem hash. */
export interface PublicInvite {
  id: string;
  email: string;
  role: string;
  departmentId: string | null;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  /** Pendente mas vencido: o link não abre; reenviar ou copiar o link renova. */
  expired: boolean;
  lastSentAt: string | null;
  sendCount: number;
  resendsLeft: number;
}

function isExpired(invite: MemberInviteView, now = Date.now()): boolean {
  return invite.expiresAt.getTime() <= now;
}

export function publicInvite(invite: MemberInviteView): PublicInvite {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    departmentId: invite.departmentId,
    invitedBy: invite.invitedBy,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    expired: isExpired(invite),
    lastSentAt: invite.lastSentAt ? invite.lastSentAt.toISOString() : null,
    sendCount: invite.sendCount,
    resendsLeft: Math.max(0, MAX_INVITE_SENDS - invite.sendCount),
  };
}

// ─── Entrada ────────────────────────────────────────────────────────────────────

const createInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.string().trim().min(1).max(32),
    departmentId: z.string().uuid().nullish(),
  })
  .strict();

const inviteIdSchema = z.string().uuid();

// ─── Entrega (compartilhada com a rota pública `send-email`) ───────────────────

export type Delivery = 'sent' | 'failed';
export type DeliveryChannel = 'invite' | 'sign_in_link' | null;

/**
 * Manda o email do convite. Nunca lança: falha do provider vira `failed` (a UI oferece o
 * link copiável). Quem já tem conta com senha recebe o "Magic link"; os demais, o "Invite
 * user". Os dois templates levam a prova de posse da caixa (`token_hash`, runbook §4). O
 * log leva só ids e o código do erro — nem email nem token.
 */
export async function deliverInviteEmail(
  provider: IAccountAuthProvider,
  log: Logger,
  invite: { id: string; workspaceId: string; email: string },
  token: string,
): Promise<{ delivery: Delivery; channel: DeliveryChannel }> {
  try {
    const account = await provider.findUserByEmail(invite.email);
    if (account?.hasPassword) {
      await provider.sendSignInLink(invite.email, invitePath(token));
      return { delivery: 'sent', channel: 'sign_in_link' };
    }
    const sent = await provider.sendInvite(invite.email, invitePath(token));
    return { delivery: 'sent', channel: sent.channel };
  } catch (err: unknown) {
    log.warn('member_invite_delivery_failed', {
      inviteId: invite.id,
      workspaceId: invite.workspaceId,
      reason: err instanceof AuthError ? err.code : 'unexpected',
    });
    return { delivery: 'failed', channel: null };
  }
}

/**
 * Há membro BLOQUEADO com este email (ou esta conta) na empresa? Convite nunca ressuscita
 * bloqueado (B6): desbloquear é decisão explícita do admin (`PATCH /api/members/:id`).
 */
export async function isBlockedMember(
  workspaceId: string,
  who: { email: string; authUserId?: string | null },
): Promise<boolean> {
  const email = who.email.trim().toLowerCase();
  const match = who.authUserId
    ? sql`(${members.email} = ${email} or ${members.authUserId} = ${who.authUserId})`
    : eq(members.email, email);
  const [row] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'blocked'), match))
      .limit(1),
  );
  return Boolean(row);
}

/**
 * Revoga os convites pendentes de um email na empresa e audita cada um (B6: bloquear ou
 * remover um membro não deixa um convite antigo trazê-lo de volta).
 */
export async function revokePendingInvitesFor(
  req: Request,
  workspaceId: string,
  email: string,
  reason: 'member_blocked' | 'member_removed',
): Promise<number> {
  const wanted = email.trim().toLowerCase();
  const pending = (await invitesRepo.listPendingByWorkspace(workspaceId)).filter(
    (invite) => invite.email.toLowerCase() === wanted,
  );
  let revokedCount = 0;
  for (const invite of pending) {
    const revoked = await invitesRepo.revoke(workspaceId, invite.id);
    if (!revoked) continue;
    revokedCount += 1;
    await withWorkspace(workspaceId, (tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId,
        actorMemberId: req.auth?.member.id ?? null,
        action: INVITE_AUDIT_ACTIONS.revoked,
        resourceId: revoked.id,
        metadata: { email: revoked.email, role: revoked.role, reason },
      }),
    );
  }
  return revokedCount;
}

// ─── Router ─────────────────────────────────────────────────────────────────────

export interface InvitesRouterOptions {
  /** Logger (testes capturam a saída para provar que o token não vaza). */
  readonly logger?: Logger;
  /** Cota de envio (testes injetam tetos baixos / prefixo isolado). */
  readonly quota?: InviteSendQuota;
}

export function createInvitesRouter(options: InvitesRouterOptions = {}): Router {
  const log = options.logger ?? createLogger('info', { module: 'member-invites' });
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('member.invite')] as const;

  const quota = options.quota ?? createInviteSendQuota();

  function deliver(
    invite: MemberInviteView,
    token: string,
  ): Promise<{ delivery: Delivery; channel: DeliveryChannel }> {
    return deliverInviteEmail(getAuthProvider(), log, invite, token);
  }

  /**
   * Consome a cota antes de enviar. Redis fora → `unavailable` (quem chama decide a
   * degradação). Erro inesperado sobe para o handler central.
   */
  async function takeQuota(
    workspaceId: string,
    email: string,
  ): Promise<InviteQuotaResult | 'unavailable'> {
    try {
      return await quota.consume({ workspaceId, email });
    } catch (err: unknown) {
      if (!(err instanceof InviteQuotaUnavailableError)) throw err;
      log.warn('member_invite_quota_unavailable', { workspaceId });
      return 'unavailable';
    }
  }

  /** 429 uniforme: mesmo corpo e Retry-After para o teto da empresa e o do destinatário. */
  function respondRateLimited(res: Response): void {
    res.setHeader('Retry-After', '3600');
    res.status(429).json({
      error: 'invite_rate_limited',
      message: 'Muitos convites enviados. Tente de novo mais tarde ou copie o link.',
    });
  }

  /**
   * Reenvio (rota própria e convite repetido no POST). Ordem: cooldown → teto do convite →
   * assento (convite vencido volta a ocupar um ao renovar) → cota de email → troca o token
   * com o teto atômico → envia → audita. Se a troca de token falhar, a cota é devolvida.
   */
  async function resend(
    req: Request,
    res: Response,
    inviteId: string,
    successStatus: 200,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const workspaceId = req.auth!.workspace.id;
    const current = await invitesRepo.findById(workspaceId, inviteId);
    if (!current || current.acceptedAt || current.revokedAt) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    if (current.lastSentAt) {
      const elapsedSec = (Date.now() - current.lastSentAt.getTime()) / 1000;
      if (elapsedSec < INVITE_RESEND_COOLDOWN_SEC) {
        res.setHeader('Retry-After', String(Math.ceil(INVITE_RESEND_COOLDOWN_SEC - elapsedSec)));
        res.status(429).json({
          error: 'resend_cooldown',
          message: 'Aguarde um minuto antes de reenviar este convite.',
        });
        return;
      }
    }
    if (current.sendCount >= MAX_INVITE_SENDS) {
      res.status(429).json({
        error: 'send_limit',
        message: 'Este convite já foi reenviado o máximo de vezes. Copie o link.',
      });
      return;
    }
    if (isExpired(current)) {
      const usage = await seatUsage(workspaceId);
      if (!seatsAvailable(usage, 1)) {
        respondSeatLimit(res, usage);
        return;
      }
    }

    const taken = await takeQuota(workspaceId, current.email);
    if (taken === 'unavailable') {
      res.status(503).json({
        error: 'invite_quota_unavailable',
        message: 'Não foi possível reenviar agora. Tente de novo ou copie o link.',
      });
      return;
    }
    if (!taken.ok) {
      respondRateLimited(res);
      return;
    }

    const { token, tokenHash } = generateInviteToken();
    const result = await invitesRepo.recordResend(workspaceId, inviteId, {
      tokenHash,
      maxSends: MAX_INVITE_SENDS,
    });
    if (!result.ok) {
      await taken.release();
      if (result.reason === 'send_limit') {
        res.status(429).json({
          error: 'send_limit',
          message: 'Este convite já foi reenviado o máximo de vezes. Copie o link.',
        });
        return;
      }
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    const { delivery, channel } = await deliver(result.invite, token);
    await req.scoped!((tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId,
        actorMemberId: req.auth!.member.id,
        action: INVITE_AUDIT_ACTIONS.resent,
        resourceId: result.invite.id,
        metadata: {
          email: result.invite.email,
          role: result.invite.role,
          sendCount: result.invite.sendCount,
          delivery,
          channel,
        },
      }),
    );
    res.status(successStatus).json({ invite: publicInvite(result.invite), delivery, ...extra });
  }

  // ─── GET /api/members/invites ────────────────────────────────────────────────
  router.get('/api/members/invites', ...guard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const [invites, seats] = await Promise.all([
      invitesRepo.listPendingByWorkspace(workspaceId),
      seatUsage(workspaceId),
    ]);
    res.json({ invites: invites.map(publicInvite), seats });
  });

  // ─── POST /api/members/invites ───────────────────────────────────────────────
  router.post('/api/members/invites', ...guard, async (req: Request, res: Response) => {
    const parsed = createInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { email, role, departmentId } = parsed.data;
    // OWNER não entra por convite (§3.6, PERMISSIONS §7); papel desconhecido também não.
    if (!isInvitableRole(role)) {
      res.status(400).json({
        error: role === 'OWNER' ? 'owner_not_invitable' : 'invalid_role',
        message: 'Convite aceita ADMIN, SUPERVISOR, AGENT ou READONLY.',
      });
      return;
    }
    const workspaceId = req.auth!.workspace.id;

    if (departmentId) {
      const [dept] = await req.scoped!((tx) =>
        tx
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.workspaceId, workspaceId), eq(departments.id, departmentId)))
          .limit(1),
      );
      if (!dept) {
        res.status(400).json({ error: 'invalid_department' });
        return;
      }
    }

    // Bloqueado não volta por convite (B6): desbloquear é decisão explícita (PATCH status).
    if (await isBlockedMember(workspaceId, { email })) {
      res.status(409).json({
        error: 'member_blocked',
        message: 'Esse email pertence a um membro bloqueado. Desbloqueie-o em vez de convidar.',
      });
      return;
    }

    const { token, tokenHash } = generateInviteToken();
    const created = await invitesRepo.create({
      workspaceId,
      email,
      role,
      departmentId: departmentId ?? null,
      invitedBy: req.auth!.member.id,
      tokenHash,
    });

    if (created.status === 'already_member') {
      res.status(409).json({
        error: 'already_member',
        message: 'Esse email já é membro ativo desta empresa.',
      });
      return;
    }
    if (created.status === 'pending_exists') {
      // Convite vivo para o mesmo email: reenvia em vez de duplicar (papel do convite
      // existente fica; para mudar o papel, revogar e convidar de novo).
      await resend(req, res, created.invite.id, 200, { resent: true });
      return;
    }

    // Teto conferido DEPOIS de gravar: o convite novo já conta. Estourou → revoga.
    const usage = await seatUsage(workspaceId);
    if (!seatsAvailable(usage, 0)) {
      await invitesRepo.revoke(workspaceId, created.invite.id);
      respondSeatLimit(res, { used: usage.used - 1, limit: usage.limit });
      return;
    }

    // Cota de email ANTES do envio.
    // - Teto da EMPRESA estourou → o convite não fica (nada foi enviado): 429.
    // - Teto do DESTINATÁRIO estourou → o convite FICA, sem email (`failed`; o admin copia o
    //   link). Esse teto soma todas as empresas: revogar aqui deixaria uma empresa hostil,
    //   que esgota os envios de uma caixa, impedir as outras de convidar até por link.
    // - Redis fora → o convite fica sem email, como no teto do destinatário.
    const taken = await takeQuota(workspaceId, created.invite.email);
    if (taken !== 'unavailable' && !taken.ok && taken.reason !== 'recipient_daily') {
      await invitesRepo.revoke(workspaceId, created.invite.id);
      respondRateLimited(res);
      return;
    }
    const { delivery, channel } =
      taken === 'unavailable' || !taken.ok
        ? { delivery: 'failed' as const, channel: null }
        : await deliver(created.invite, token);
    await req.scoped!((tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId,
        actorMemberId: req.auth!.member.id,
        action: INVITE_AUDIT_ACTIONS.invited,
        resourceId: created.invite.id,
        metadata: {
          email: created.invite.email,
          role: created.invite.role,
          departmentId: created.invite.departmentId,
          delivery,
          channel,
        },
      }),
    );
    res.status(201).json({ invite: publicInvite(created.invite), delivery });
  });

  // ─── POST /api/members/invites/:id/resend ────────────────────────────────────
  router.post('/api/members/invites/:id/resend', ...guard, async (req: Request, res: Response) => {
    const id = inviteIdSchema.safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    await resend(req, res, id.data, 200);
  });

  // ─── DELETE /api/members/invites/:id ─────────────────────────────────────────
  router.delete('/api/members/invites/:id', ...guard, async (req: Request, res: Response) => {
    const id = inviteIdSchema.safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const revoked = await invitesRepo.revoke(workspaceId, id.data);
    if (!revoked) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    await req.scoped!((tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId,
        actorMemberId: req.auth!.member.id,
        action: INVITE_AUDIT_ACTIONS.revoked,
        resourceId: revoked.id,
        metadata: { email: revoked.email, role: revoked.role },
      }),
    );
    res.sendStatus(204);
  });

  // ─── POST /api/members/invites/:id/link ──────────────────────────────────────
  // POST (não GET): troca o token, então é escrita. Assim o view-as (só GET/HEAD) e o modo
  // só leitura da assinatura o bloqueiam pelos mecanismos normais, e nenhum prefetch,
  // crawler ou cache de GET consegue matar o link do email.
  router.post('/api/members/invites/:id/link', ...guard, async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const id = inviteIdSchema.safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const current = await invitesRepo.findById(workspaceId, id.data);
    if (!current || current.acceptedAt || current.revokedAt) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    if (isExpired(current)) {
      const usage = await seatUsage(workspaceId);
      if (!seatsAvailable(usage, 1)) {
        respondSeatLimit(res, usage);
        return;
      }
    }

    const { token, tokenHash } = generateInviteToken();
    const url = inviteUrl(token);
    if (!url) {
      res.status(503).json({
        error: 'link_unavailable',
        message: 'O endereço público do app não está configurado.',
      });
      return;
    }
    const rotated = await invitesRepo.rotateToken(workspaceId, id.data, tokenHash);
    if (!rotated) {
      res.status(404).json({ error: 'invite_not_found' });
      return;
    }
    await req.scoped!((tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId,
        actorMemberId: req.auth!.member.id,
        action: INVITE_AUDIT_ACTIONS.linkCopied,
        resourceId: rotated.id,
        metadata: { email: rotated.email, role: rotated.role },
      }),
    );
    res.json({ url, expiresAt: rotated.expiresAt.toISOString(), invite: publicInvite(rotated) });
  });

  return router;
}
