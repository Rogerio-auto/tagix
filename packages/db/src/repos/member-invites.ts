/**
 * Convites de membros (F71-S01 — CONTAS_E_CONVITES §4, §5 e §6).
 *
 * ## Duas fronteiras
 *
 * - **Escopo de empresa** (`withWorkspace`, sob RLS): criar, listar, revogar, reenviar, copiar
 *   link e ACEITAR. O aceite roda na empresa do convite: quem chama já resolveu o convite pelo
 *   token (ou pelo email da sessão) e sabe o `workspaceId`.
 * - **Privilegiado** (`getDb()`, fora da RLS): `findPendingByTokenHash` e `listPendingByEmail`.
 *   Acontecem antes de existir empresa no escopo (link aberto por quem ainda não é membro;
 *   banner de convites da sessão). Mesmo padrão do provisionador e da resolução de sessão:
 *   filtro explícito, só convites vivos, e nunca devolvem `token_hash`.
 *
 * ## Token (T1)
 *
 * `generateInviteToken()` gera 32 bytes aleatórios (base64url, vai no link) e o sha256 hex (vai
 * para o banco). O claro nunca é gravado, então reenviar ou copiar o link TROCA o token
 * (`recordResend`, `rotateToken`): o link anterior morre.
 *
 * ## Uso único
 *
 * `accept` reivindica o convite com um UPDATE condicional (pendente, não expirado, mesmo email)
 * antes de tocar em `members`: dois aceites simultâneos do mesmo convite → só um passa.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import { withWorkspace } from '../rls';
import {
  INVITABLE_ROLES,
  memberInvites,
  members,
  workspaces,
  type InvitableRole,
  type MemberInvite,
} from '../schema';

/** Validade do link (CONTAS_E_CONVITES §6, T1). Reenviar/copiar o link renova. */
export const INVITE_TTL_DAYS = 7;
const TOKEN_BYTES = 32;

/** Convite sem o hash do token — a única forma que sai deste repo. */
export type MemberInviteView = Omit<MemberInvite, 'tokenHash'>;

type MemberRow = typeof members.$inferSelect;

/** Token novo: `token` vai no link (`/convite/<token>`), `tokenHash` vai para o banco. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/** sha256 hex do token do link. Usar para procurar o convite a partir do path. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

function inviteExpiry(now = Date.now()): Date {
  return new Date(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const viewColumns = {
  id: memberInvites.id,
  workspaceId: memberInvites.workspaceId,
  email: memberInvites.email,
  role: memberInvites.role,
  departmentId: memberInvites.departmentId,
  invitedBy: memberInvites.invitedBy,
  expiresAt: memberInvites.expiresAt,
  acceptedAt: memberInvites.acceptedAt,
  revokedAt: memberInvites.revokedAt,
  acceptedMemberId: memberInvites.acceptedMemberId,
  lastSentAt: memberInvites.lastSentAt,
  sendCount: memberInvites.sendCount,
  createdAt: memberInvites.createdAt,
} as const;

/** Pendente: nem aceito nem revogado (expirado conta, até ser revogado/reenviado). */
const isPending = and(isNull(memberInvites.acceptedAt), isNull(memberInvites.revokedAt));
/** Pendente E dentro da validade: o único estado que um link consegue usar. */
const isLive = and(isPending, gt(memberInvites.expiresAt, sql`now()`));

// ─── Tipos do contrato ──────────────────────────────────────────────────────────

export interface CreateInviteInput {
  workspaceId: string;
  email: string;
  role: InvitableRole;
  departmentId?: string | null;
  /** Membro que convidou (mesma empresa — a FK composta exige). */
  invitedBy: string | null;
  /** `generateInviteToken().tokenHash`. */
  tokenHash: string;
}

export type CreateInviteResult =
  | { status: 'created'; invite: MemberInviteView }
  /** Já existe convite vivo para este email nesta empresa: reenviar em vez de criar. */
  | { status: 'pending_exists'; invite: MemberInviteView }
  /** O email já é membro ATIVO desta empresa. */
  | { status: 'already_member'; memberId: string };

/** Convite resolvido pelo token, para a página de aceite (GET /auth/invite/:token). */
export interface InviteLookup {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: InvitableRole;
  departmentId: string | null;
  invitedBy: string | null;
  /** Nome (ou email, sem nome) de quem convidou; null se essa pessoa saiu. */
  inviterName: string | null;
  expiresAt: Date;
}

/** Convite vivo para o email da sessão (banner "você foi convidado"). */
export interface PendingInviteForEmail {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: InvitableRole;
  inviterName: string | null;
  expiresAt: Date;
}

export interface AcceptInviteInput {
  workspaceId: string;
  inviteId: string;
  /** Usuário do provider de auth que aceita. */
  authUserId: string;
  /** Email da identidade que aceita. Precisa ser o do convite (T2) — conferido no UPDATE. */
  email: string;
  /** Nome informado no aceite (só preenche quando o membro não tem nome). */
  name?: string | null;
}

export interface AcceptInviteResult {
  invite: MemberInviteView;
  member: MemberRow;
  /**
   * - `created`: membro novo;
   * - `reactivated`: já havia linha não ativa da pessoa nesta empresa (removida, bloqueada)
   *   e ela volta `active` com o papel do convite;
   * - `already_active`: a pessoa já era membro ativo; o convite é consumido e o papel atual fica.
   */
  outcome: 'created' | 'reactivated' | 'already_active';
}

/**
 * A pessoa tem duas linhas candidatas nesta empresa (uma pelo `auth_user_id`, outra pelo
 * email), o email pertence a um membro ativo de OUTRA conta, ou a linha é de um OWNER ainda
 * não ativo (só o verify o promove — T6). Nada é alterado; resolver exige decisão humana. A
 * API responde 409.
 */
export class InviteAcceptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteAcceptConflictError';
  }
}

export type ResendInviteResult =
  | { ok: true; invite: MemberInviteView }
  | { ok: false; reason: 'not_found' | 'send_limit' };

// ─── Repo ───────────────────────────────────────────────────────────────────────

export const invitesRepo = {
  /**
   * Cria um convite pendente. Conta como o primeiro envio (`send_count = 1`, `last_sent_at`):
   * a API manda o email logo depois. Um convite EXPIRADO para o mesmo email é revogado antes
   * (senão o índice único de pendente bloquearia o novo).
   */
  async create(input: CreateInviteInput): Promise<CreateInviteResult> {
    if (!isInvitableRole(input.role)) {
      throw new Error(`Papel não pode ser concedido por convite: ${String(input.role)}`);
    }
    const email = normalizeEmail(input.email);
    return withWorkspace(input.workspaceId, async (tx) => {
      const [member] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, input.workspaceId),
            eq(members.email, email),
            eq(members.status, 'active'),
          ),
        )
        .limit(1);
      if (member) return { status: 'already_member', memberId: member.id };

      await tx
        .update(memberInvites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(memberInvites.workspaceId, input.workspaceId),
            eq(memberInvites.email, email),
            isPending,
            lte(memberInvites.expiresAt, sql`now()`),
          ),
        );

      const [created] = await tx
        .insert(memberInvites)
        .values({
          workspaceId: input.workspaceId,
          email,
          role: input.role,
          departmentId: input.departmentId ?? null,
          invitedBy: input.invitedBy,
          tokenHash: input.tokenHash,
          expiresAt: inviteExpiry(),
          sendCount: 1,
          lastSentAt: sql`now()`,
        })
        .onConflictDoNothing({
          target: [memberInvites.workspaceId, memberInvites.email],
          where: sql`accepted_at is null and revoked_at is null`,
        })
        .returning(viewColumns);
      if (created) return { status: 'created', invite: created };

      const [existing] = await tx
        .select(viewColumns)
        .from(memberInvites)
        .where(
          and(
            eq(memberInvites.workspaceId, input.workspaceId),
            eq(memberInvites.email, email),
            isPending,
          ),
        );
      if (!existing) throw new Error('Convite pendente sumiu durante a criação.');
      return { status: 'pending_exists', invite: existing };
    });
  },

  /**
   * PRIVILEGIADO (fora da RLS): resolve o token do link para a página/rota de aceite. Só
   * devolve convite VIVO (pendente e não expirado); inválido, expirado, revogado e aceito são
   * todos `null` — a API responde 404 uniforme (T3).
   */
  async findPendingByTokenHash(tokenHash: string): Promise<InviteLookup | null> {
    const [row] = await getDb()
      .select({
        id: memberInvites.id,
        workspaceId: memberInvites.workspaceId,
        workspaceName: workspaces.name,
        email: memberInvites.email,
        role: memberInvites.role,
        departmentId: memberInvites.departmentId,
        invitedBy: memberInvites.invitedBy,
        inviterName: sql<string | null>`coalesce(${members.name}, ${members.email}::text)`,
        expiresAt: memberInvites.expiresAt,
      })
      .from(memberInvites)
      .innerJoin(workspaces, eq(workspaces.id, memberInvites.workspaceId))
      .leftJoin(
        members,
        and(
          eq(members.id, memberInvites.invitedBy),
          eq(members.workspaceId, memberInvites.workspaceId),
        ),
      )
      .where(and(eq(memberInvites.tokenHash, tokenHash), isLive))
      .limit(1);
    return row ?? null;
  },

  /**
   * PRIVILEGIADO (fora da RLS): convites vivos para um email, em todas as empresas (banner
   * "você foi convidado" de quem já tem conta). Mais recente primeiro.
   */
  async listPendingByEmail(email: string): Promise<PendingInviteForEmail[]> {
    return getDb()
      .select({
        id: memberInvites.id,
        workspaceId: memberInvites.workspaceId,
        workspaceName: workspaces.name,
        role: memberInvites.role,
        inviterName: sql<string | null>`coalesce(${members.name}, ${members.email}::text)`,
        expiresAt: memberInvites.expiresAt,
      })
      .from(memberInvites)
      .innerJoin(workspaces, eq(workspaces.id, memberInvites.workspaceId))
      .leftJoin(
        members,
        and(
          eq(members.id, memberInvites.invitedBy),
          eq(members.workspaceId, memberInvites.workspaceId),
        ),
      )
      .where(and(eq(memberInvites.email, normalizeEmail(email)), isLive))
      .orderBy(desc(memberInvites.createdAt));
  },

  /** Pendentes da empresa (inclui expirados, para o admin reenviar). Mais recente primeiro. */
  async listPendingByWorkspace(workspaceId: string): Promise<MemberInviteView[]> {
    return withWorkspace(workspaceId, (tx) =>
      tx
        .select(viewColumns)
        .from(memberInvites)
        .where(and(eq(memberInvites.workspaceId, workspaceId), isPending))
        .orderBy(desc(memberInvites.createdAt)),
    );
  },

  /** Convites vivos da empresa — soma com os membros ativos no teto `max_members`. */
  async countPending(workspaceId: string): Promise<number> {
    const [row] = await withWorkspace(workspaceId, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(memberInvites)
        .where(and(eq(memberInvites.workspaceId, workspaceId), isLive)),
    );
    return row?.n ?? 0;
  },

  async findById(workspaceId: string, inviteId: string): Promise<MemberInviteView | null> {
    const [row] = await withWorkspace(workspaceId, (tx) =>
      tx
        .select(viewColumns)
        .from(memberInvites)
        .where(and(eq(memberInvites.workspaceId, workspaceId), eq(memberInvites.id, inviteId))),
    );
    return row ?? null;
  },

  /** Revoga um convite pendente. `null` se não existe ou já foi aceito/revogado. */
  async revoke(workspaceId: string, inviteId: string): Promise<MemberInviteView | null> {
    const [row] = await withWorkspace(workspaceId, (tx) =>
      tx
        .update(memberInvites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(memberInvites.workspaceId, workspaceId),
            eq(memberInvites.id, inviteId),
            isPending,
          ),
        )
        .returning(viewColumns),
    );
    return row ?? null;
  },

  /**
   * Registra um reenvio: troca o token (o link anterior morre), renova a validade e soma um
   * envio — só se o convite está pendente e abaixo do teto `maxSends` (T8). Atômico: dois
   * reenvios simultâneos não furam o teto.
   */
  async recordResend(
    workspaceId: string,
    inviteId: string,
    opts: { tokenHash: string; maxSends: number },
  ): Promise<ResendInviteResult> {
    return withWorkspace(workspaceId, async (tx) => {
      const [row] = await tx
        .update(memberInvites)
        .set({
          tokenHash: opts.tokenHash,
          expiresAt: inviteExpiry(),
          lastSentAt: sql`now()`,
          sendCount: sql`${memberInvites.sendCount} + 1`,
        })
        .where(
          and(
            eq(memberInvites.workspaceId, workspaceId),
            eq(memberInvites.id, inviteId),
            isPending,
            sql`${memberInvites.sendCount} < ${opts.maxSends}`,
          ),
        )
        .returning(viewColumns);
      if (row) return { ok: true, invite: row };
      const [pending] = await tx
        .select({ id: memberInvites.id })
        .from(memberInvites)
        .where(
          and(
            eq(memberInvites.workspaceId, workspaceId),
            eq(memberInvites.id, inviteId),
            isPending,
          ),
        );
      return { ok: false, reason: pending ? 'send_limit' : 'not_found' };
    });
  },

  /**
   * "Copiar link" (fallback sem email): troca o token e renova a validade, sem contar envio.
   * O link enviado por email antes deixa de valer. `null` se o convite não está pendente.
   */
  async rotateToken(
    workspaceId: string,
    inviteId: string,
    tokenHash: string,
  ): Promise<MemberInviteView | null> {
    const [row] = await withWorkspace(workspaceId, (tx) =>
      tx
        .update(memberInvites)
        .set({ tokenHash, expiresAt: inviteExpiry() })
        .where(
          and(
            eq(memberInvites.workspaceId, workspaceId),
            eq(memberInvites.id, inviteId),
            isPending,
          ),
        )
        .returning(viewColumns),
    );
    return row ?? null;
  },

  /**
   * Aceita o convite e marca aceito, numa transação sob a RLS da empresa do convite:
   *   1. reivindica o convite (vivo + email igual ao da identidade — T2), uso único;
   *   2. cria o membro `active` com o papel DO CONVITE (T4), ou reativa a linha que a pessoa
   *      já tinha nesta empresa;
   *   3. grava `accepted_member_id`.
   * `null` = convite inválido/expirado/revogado/aceito ou de outro email (404 uniforme).
   * Lança `InviteAcceptConflictError` (nada é gravado) quando a pessoa casa com duas linhas.
   */
  async accept(input: AcceptInviteInput): Promise<AcceptInviteResult | null> {
    const email = normalizeEmail(input.email);
    return withWorkspace(input.workspaceId, async (tx) => {
      const [invite] = await tx
        .update(memberInvites)
        .set({ acceptedAt: sql`now()` })
        .where(
          and(
            eq(memberInvites.workspaceId, input.workspaceId),
            eq(memberInvites.id, input.inviteId),
            eq(memberInvites.email, email),
            isLive,
          ),
        )
        .returning(viewColumns);
      if (!invite) return null;

      const { member, outcome } = await upsertMemberFromInvite(tx, invite, {
        authUserId: input.authUserId,
        email,
        name: input.name?.trim() || null,
      });

      const [accepted] = await tx
        .update(memberInvites)
        .set({ acceptedMemberId: member.id })
        .where(eq(memberInvites.id, invite.id))
        .returning(viewColumns);
      return { invite: accepted ?? invite, member, outcome };
    });
  },
};

async function upsertMemberFromInvite(
  tx: DbTx,
  invite: MemberInviteView,
  who: { authUserId: string; email: string; name: string | null },
): Promise<{ member: MemberRow; outcome: AcceptInviteResult['outcome'] }> {
  const candidates = await tx
    .select()
    .from(members)
    .where(
      and(
        eq(members.workspaceId, invite.workspaceId),
        or(eq(members.authUserId, who.authUserId), eq(members.email, who.email)),
      ),
    );
  if (candidates.length > 1) {
    throw new InviteAcceptConflictError(
      'A conta e o email do convite apontam para membros diferentes nesta empresa.',
    );
  }
  const existing = candidates[0];

  if (!existing) {
    const [created] = await tx
      .insert(members)
      .values({
        workspaceId: invite.workspaceId,
        authUserId: who.authUserId,
        email: who.email,
        name: who.name,
        role: invite.role,
        status: 'active',
        isPlatformAdmin: false,
        invitedBy: invite.invitedBy,
        invitedAt: invite.createdAt,
        joinedAt: sql`now()`,
      })
      .returning();
    if (!created) throw new Error('Falha ao criar o membro do convite.');
    return { member: created, outcome: 'created' };
  }

  const sameAccount = existing.authUserId === who.authUserId;
  // Convite nunca mexe em linha de OWNER (T4/T6): o dono pré-verify só é promovido pelo verify.
  if (existing.role === 'OWNER' && existing.status !== 'active') {
    throw new InviteAcceptConflictError('O convite aponta para o dono desta empresa.');
  }
  if (existing.status === 'active') {
    if (!sameAccount) {
      throw new InviteAcceptConflictError(
        'O email do convite já é membro ativo desta empresa com outra conta.',
      );
    }
    return { member: existing, outcome: 'already_active' };
  }

  const [reactivated] = await tx
    .update(members)
    .set({
      authUserId: who.authUserId,
      role: invite.role,
      status: 'active',
      name: existing.name ?? who.name,
      invitedBy: invite.invitedBy,
      invitedAt: invite.createdAt,
      joinedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(members.id, existing.id))
    .returning();
  if (!reactivated) throw new Error('Falha ao reativar o membro do convite.');
  return { member: reactivated, outcome: 'reactivated' };
}
