/**
 * Aceite de convite — rotas públicas (F71-S05, CONTAS_E_CONVITES §3.5, §5 e §6).
 *
 *   POST /auth/invite/preview      { token }                              → preview, ou 404 uniforme
 *   POST /auth/invite/send-email   { token }                              → manda o email do convite
 *   POST /auth/invite/accept       { token, name?, password?, emailProof? } → { next }
 *
 * Montado no `app.ts` como router próprio, antes da sessão: quem abre o link ainda não é
 * membro da empresa. Rate-limit por IP em todas. O token vai sempre no CORPO (nunca no path
 * nem na query da API): access log, Sentry e `Referer` não o veem. Toda resposta sai com
 * `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.
 *
 * ## 404 uniforme (T1/T3)
 *
 * Token malformado, inexistente, expirado, revogado ou já aceito respondem o MESMO
 * `404 { error: 'invite_not_found' }` nas três rotas. O aceite que perde a corrida do uso
 * único também.
 *
 * ## Duas provas diferentes (T2)
 *
 * O token do convite prova "tenho o link". Ele NÃO prova "sou dono deste email": o admin que
 * clica em "copiar link" o recebe em claro. Por isso, criar a senha de uma conta exige a
 * prova de posse da caixa — o `token_hash` do provider de auth, que só existe dentro do
 * email ("Invite user" / "Magic link" linkam `/convite/<token>?token_hash=…&type=…`; ver o
 * runbook `supabase-auth-emails.md`) e que o admin nunca vê.
 *
 * Classificação pelo email DO CONVITE (nunca pelo body), com `findUserByEmail`:
 *
 * - **`account`** — a conta existe e `hasPassword = true`. Aceite SÓ com sessão
 *   (`hm_session`) cuja identidade tem o email do convite e é a mesma conta; senão
 *   `401 login_required` / `403 wrong_account`. Nunca toca na senha. Inclui cadastro não
 *   confirmado com senha do dono: o link nunca troca a senha de alguém.
 * - **`claimable`** (existe, sem senha — nasceu de um convite) e **`none`** (não existe —
 *   o envio falhou e o admin copiou o link): exigem `emailProof` válido, do email do
 *   convite e da mesma conta. Sem prova, ou prova inválida/de outro email/de outra conta →
 *   `403 email_proof_required` (corpo único: não diz se a conta existe). Quem chegou pelo
 *   link copiado pede o email (`send-email`), abre o link do email e define a senha.
 *   O caminho `none` nunca cria conta com senha escolhida por quem tem só o link: a conta
 *   nasce do `sendInvite` (sem senha) e só o dono da caixa a completa.
 *
 * Papel SEMPRE do convite (T4): o body não carrega papel nem empresa.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  hashInviteToken,
  invitesRepo,
  InviteAcceptConflictError,
  membershipsRepo,
  withWorkspace,
  type InviteLookup,
} from '@hm/db';
import { AuthError, EMAIL_PROOF_TYPES, type AuthIdentity } from '@hm/shared';
import { createLogger, type Logger } from '@hm/logger';
import { getAuthProvider } from './provider';
import { readToken, setActiveWorkspaceCookie, verifyTokenResilient } from './session';
import { strongPassword } from './signup';
import { rateLimit, type RateLimitOptions } from '../middlewares/rate-limit';
import { hasActiveImpersonation } from '../middlewares/impersonation';
import {
  deliverInviteEmail,
  INVITE_AUDIT_ACTIONS,
  isBlockedMember,
  recordWorkspaceAudit,
} from '../routes/workspace/invites';
import {
  createInviteSendQuota,
  InviteQuotaUnavailableError,
  type InviteSendQuota,
} from '../routes/workspace/invite-quota';

/** Token do link: base64url de 32 bytes = 43 caracteres. Folga para não recusar por formato. */
const tokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const tokenBodySchema = z.object({ token: z.string().max(512) }).strict();

/** `token_hash` do provider (hex no GoTrue). Formato só para barrar lixo antes da rede. */
const emailProofSchema = z
  .object({
    tokenHash: z
      .string()
      .min(8)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    type: z.enum(EMAIL_PROOF_TYPES),
  })
  .strict();

const acceptSchema = z
  .object({
    token: z.string().max(512),
    name: z.string().trim().min(1).max(120).nullish(),
    password: z.string().max(200).nullish(),
    emailProof: emailProofSchema.nullish(),
  })
  .strict();

type AccountKind =
  | { kind: 'account'; authUserId: string }
  | { kind: 'claimable'; authUserId: string }
  | { kind: 'none' };

/** Classifica o email do convite (ver o topo do arquivo). Lança `AuthError` se não dá para saber. */
async function classifyAccount(email: string): Promise<AccountKind> {
  const found = await getAuthProvider().findUserByEmail(email);
  if (!found) return { kind: 'none' };
  return found.hasPassword
    ? { kind: 'account', authUserId: found.authUserId }
    : { kind: 'claimable', authUserId: found.authUserId };
}

/** `jo***@empresa.com` — o bastante para a pessoa reconhecer o próprio email. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Resolve o convite vivo do token; qualquer token fora do formato é "não existe". */
async function resolveInvite(
  rawToken: unknown,
): Promise<{ invite: InviteLookup; token: string } | null> {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const invite = await invitesRepo.findPendingByTokenHash(hashInviteToken(parsed.data));
  return invite ? { invite, token: parsed.data } : null;
}

async function findLiveInvite(rawToken: unknown): Promise<InviteLookup | null> {
  return (await resolveInvite(rawToken))?.invite ?? null;
}

/** Token do corpo `{ token }`; corpo fora do formato vira `undefined` (→ 404 uniforme). */
function bodyToken(req: Request): string | undefined {
  const parsed = tokenBodySchema.safeParse(req.body);
  return parsed.success ? parsed.data.token : undefined;
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'invite_not_found', message: 'Convite inválido ou expirado.' });
}

function authUnavailable(res: Response): void {
  res.status(503).json({
    error: 'auth_unavailable',
    message: 'Não foi possível concluir agora. Tente de novo em instantes.',
  });
}

function emailProofRequired(res: Response): void {
  res.status(403).json({
    error: 'email_proof_required',
    message: 'Abra o link que enviamos para o email convidado para criar a sua senha.',
  });
}

function inviteConflict(res: Response): void {
  res.status(409).json({
    error: 'invite_conflict',
    message: 'Não foi possível aceitar este convite. Fale com quem convidou você.',
  });
}

/** Sem cache e sem `Referer`: o corpo/URL dessas rotas carrega segredo de uso único. */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

type LimitOverride = Pick<RateLimitOptions, 'bucket' | 'max' | 'windowSec'>;

export interface InviteAuthRouterOptions {
  readonly logger?: Logger;
  /**
   * Ajuste dos limites por IP (testes). Default: preview 60/10min, aceite 20/15min,
   * envio de email 5/15min.
   */
  readonly limits?: {
    readonly preview?: LimitOverride;
    readonly accept?: LimitOverride;
    readonly sendEmail?: LimitOverride;
  };
  /** Cota de email (a mesma das rotas do admin; testes injetam tetos/prefixo). */
  readonly quota?: InviteSendQuota;
}

export function createInviteAuthRouter(options: InviteAuthRouterOptions = {}): Router {
  const log = options.logger ?? createLogger('info', { module: 'invite-accept' });
  const quota = options.quota ?? createInviteSendQuota();
  const limiter = (bucket: string, max: number, windowSec: number, override?: LimitOverride) =>
    rateLimit({ bucket, max, windowSec, ...override, byEmail: false });
  const previewLimiter = limiter('invite_preview', 60, 10 * 60, options.limits?.preview);
  const acceptLimiter = limiter('invite_accept', 20, 15 * 60, options.limits?.accept);
  const sendEmailLimiter = limiter('invite_send_email', 5, 15 * 60, options.limits?.sendEmail);

  const router = Router();
  router.use('/auth/invite', noStore);

  // ─── POST /auth/invite/preview ───────────────────────────────────────────────
  router.post('/auth/invite/preview', previewLimiter, async (req: Request, res: Response) => {
    const invite = await findLiveInvite(bodyToken(req));
    if (!invite) {
      notFound(res);
      return;
    }
    let account: AccountKind;
    try {
      account = await classifyAccount(invite.email);
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        authUnavailable(res);
        return;
      }
      throw err;
    }
    res.json({
      workspaceName: invite.workspaceName,
      inviterName: invite.inviterName,
      role: invite.role,
      emailMasked: maskEmail(invite.email),
      // false → "entre com a sua conta e aceite"; true → "crie a senha" (com a prova do
      // email na URL) ou "enviar email" (sem ela). Mesmo bit do antigo `hasAccount`.
      requiresEmailProof: account.kind !== 'account',
      expiresAt: invite.expiresAt.toISOString(),
    });
  });

  // ─── POST /auth/invite/send-email ────────────────────────────────────────────
  // Para quem chegou pelo link copiado: manda o email do convite (com a prova de posse) para
  // o endereço DO CONVITE. Não troca o token. Resposta igual exista a conta ou não, e mesmo
  // se o provider falhar (a falha vai para o log).
  router.post('/auth/invite/send-email', sendEmailLimiter, async (req: Request, res: Response) => {
    const resolved = await resolveInvite(bodyToken(req));
    if (!resolved) {
      notFound(res);
      return;
    }
    const { invite, token } = resolved;
    let taken: Awaited<ReturnType<InviteSendQuota['consume']>>;
    try {
      taken = await quota.consume({
        workspaceId: invite.workspaceId,
        email: invite.email,
        publicInviteId: invite.id,
      });
    } catch (err: unknown) {
      if (!(err instanceof InviteQuotaUnavailableError)) throw err;
      log.warn('invite_send_email_quota_unavailable', { inviteId: invite.id });
      res.status(503).json({
        error: 'send_unavailable',
        message: 'Não foi possível enviar agora. Tente de novo em instantes.',
      });
      return;
    }
    if (!taken.ok) {
      const cooldown = taken.reason === 'invite_cooldown';
      res.setHeader('Retry-After', String(cooldown ? taken.retryAfterSec : 3600));
      res.status(429).json({
        error: cooldown ? 'send_cooldown' : 'send_limit',
        message: cooldown
          ? 'Aguarde um minuto antes de pedir outro email.'
          : 'Muitos emails enviados para este convite. Fale com quem convidou você.',
      });
      return;
    }

    // O token é o mesmo que a pessoa já tem: o email leva o MESMO link + a prova.
    const { delivery, channel } = await deliverInviteEmail(getAuthProvider(), log, invite, token);
    await withWorkspace(invite.workspaceId, (tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId: invite.workspaceId,
        actorMemberId: null,
        actorType: 'system',
        action: INVITE_AUDIT_ACTIONS.emailRequested,
        resourceId: invite.id,
        metadata: { email: invite.email, role: invite.role, delivery, channel, via: 'public_link' },
      }),
    );
    res.json({ ok: true, emailMasked: maskEmail(invite.email) });
  });

  // ─── POST /auth/invite/accept ────────────────────────────────────────────────
  router.post('/auth/invite/accept', acceptLimiter, async (req: Request, res: Response) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      // Sem `issues`: o token é um dos campos e não volta em resposta nenhuma.
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    const invite = await findLiveInvite(parsed.data.token);
    if (!invite) {
      notFound(res);
      return;
    }

    let account: AccountKind;
    try {
      account = await classifyAccount(invite.email);
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        authUnavailable(res);
        return;
      }
      throw err;
    }

    // Convite não ressuscita membro bloqueado (B6).
    const knownId = account.kind === 'none' ? null : account.authUserId;
    if (await isBlockedMember(invite.workspaceId, { email: invite.email, authUserId: knownId })) {
      log.warn('invite_accept_blocked_member', { inviteId: invite.id, workspaceId: invite.workspaceId });
      inviteConflict(res);
      return;
    }

    if (account.kind === 'account') {
      await acceptWithSession(req, res, invite, account.authUserId, parsed.data.name ?? null);
      return;
    }
    await acceptWithEmailProof(req, res, invite, parsed.data);
  });

  /** Caminho "com conta": a sessão prova quem é; nada de senha. */
  async function acceptWithSession(
    req: Request,
    res: Response,
    invite: InviteLookup,
    accountId: string,
    name: string | null,
  ): Promise<void> {
    const sessionToken = readToken(req);
    const identity: AuthIdentity | null = sessionToken
      ? await verifyTokenResilient(sessionToken)
      : null;
    if (!identity) {
      res.status(401).json({
        error: 'login_required',
        message: 'Entre com a sua conta para aceitar o convite.',
      });
      return;
    }
    if (!sameEmail(identity.email, invite.email) || identity.authUserId !== accountId) {
      res.status(403).json({
        error: 'wrong_account',
        message: 'Este convite é para outro email. Entre com a conta convidada.',
      });
      return;
    }
    // Mesma regra de `POST /api/me/workspace`: sob view-as a sessão não muda de empresa.
    if (await hasActiveImpersonation(req)) {
      res.status(403).json({
        error: 'impersonation_read_only',
        message: 'Encerre o modo de visualização antes de aceitar o convite.',
      });
      return;
    }
    const joined = await join(req, res, invite, identity.authUserId, name);
    if (!joined) return;
    setActiveWorkspaceCookie(res, invite.workspaceId);
    await membershipsRepo.touchLastActive(joined.memberId);
    res.json({ next: '/' });
  }

  /**
   * Caminho "sem senha" (`claimable`/`none`): a prova de posse da caixa autoriza definir a
   * primeira senha; depois vai para o login (§3.5, sem auto-login).
   *
   * Ordem: prova presente → senha forte (antes de consumir a prova, que é de uso único) →
   * consome a prova → confere email e conta → completa a conta → consome o convite.
   */
  async function acceptWithEmailProof(
    req: Request,
    res: Response,
    invite: InviteLookup,
    body: z.infer<typeof acceptSchema>,
  ): Promise<void> {
    const proof = body.emailProof;
    if (!proof) {
      emailProofRequired(res);
      return;
    }
    if (!body.password) {
      res.status(400).json({ error: 'password_required', message: 'Defina uma senha.' });
      return;
    }
    const strong = strongPassword.safeParse(body.password);
    if (!strong.success) {
      res.status(400).json({
        error: 'weak_password',
        message: strong.error.issues[0]?.message ?? 'Senha fraca.',
      });
      return;
    }
    const password = strong.data;
    const provider = getAuthProvider();

    let owner: AuthIdentity | null;
    let current: AccountKind;
    try {
      owner = await provider.verifyEmailOwnership(proof.tokenHash, proof.type);
      // Reclassifica DEPOIS da prova: no caminho `none` a conta nasceu do `send-email`, e a
      // conta pode ter ganhado senha no meio do caminho.
      current = owner ? await classifyAccount(invite.email) : { kind: 'none' };
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        authUnavailable(res);
        return;
      }
      throw err;
    }
    if (!owner || !sameEmail(owner.email, invite.email)) {
      log.warn('invite_accept_email_proof_rejected', {
        inviteId: invite.id,
        workspaceId: invite.workspaceId,
        reason: owner ? 'other_email' : 'invalid',
      });
      emailProofRequired(res);
      return;
    }
    if (current.kind === 'account' && current.authUserId === owner.authUserId) {
      // Dono da caixa, mas a conta já tem senha: entra e aceita logado.
      res.status(401).json({
        error: 'login_required',
        message: 'Entre com a sua conta para aceitar o convite.',
      });
      return;
    }
    if (current.kind !== 'claimable' || current.authUserId !== owner.authUserId) {
      log.warn('invite_accept_email_proof_rejected', {
        inviteId: invite.id,
        workspaceId: invite.workspaceId,
        reason: 'other_account',
      });
      emailProofRequired(res);
      return;
    }
    if (await isBlockedMember(invite.workspaceId, { email: invite.email, authUserId: owner.authUserId })) {
      inviteConflict(res);
      return;
    }

    // Risco residual (B1): a senha é definida antes do consumo atômico do convite. Se o
    // consumo falhar (corrida, conflito), a conta fica com a senha que o PRÓPRIO dono da
    // caixa escolheu e sem a empresa — nunca com senha de terceiro. Ver Notas do slot.
    if (!(await provider.completeAccount(owner.authUserId, password))) {
      log.warn('invite_accept_complete_account_failed', {
        inviteId: invite.id,
        workspaceId: invite.workspaceId,
      });
      res.status(502).json({
        error: 'account_update_failed',
        message: 'Não foi possível definir a senha agora. Peça um novo email e tente de novo.',
      });
      return;
    }

    const joined = await join(req, res, invite, owner.authUserId, body.name ?? null);
    if (!joined) return;
    res.json({ next: `/login?email=${encodeURIComponent(invite.email)}` });
  }

  /**
   * Consome o convite (uso único, transação no repo) e audita `member.joined`. Responde o
   * erro e devolve `null` quando não deu.
   */
  async function join(
    req: Request,
    res: Response,
    invite: InviteLookup,
    authUserId: string,
    name: string | null,
  ): Promise<{ memberId: string } | null> {
    let result: Awaited<ReturnType<typeof invitesRepo.accept>>;
    try {
      result = await invitesRepo.accept({
        workspaceId: invite.workspaceId,
        inviteId: invite.id,
        authUserId,
        email: invite.email,
        name,
      });
    } catch (err: unknown) {
      if (err instanceof InviteAcceptConflictError) {
        log.warn('invite_accept_conflict', { inviteId: invite.id, workspaceId: invite.workspaceId });
        inviteConflict(res);
        return null;
      }
      throw err;
    }
    if (!result) {
      notFound(res);
      return null;
    }
    const { member, outcome } = result;
    await withWorkspace(invite.workspaceId, (tx) =>
      recordWorkspaceAudit(tx, req, {
        workspaceId: invite.workspaceId,
        actorMemberId: member.id,
        action: INVITE_AUDIT_ACTIONS.joined,
        resourceId: invite.id,
        metadata: {
          memberId: member.id,
          email: member.email,
          role: member.role,
          outcome,
          invitedBy: invite.invitedBy,
        },
      }),
    );
    return { memberId: member.id };
  }

  return router;
}
