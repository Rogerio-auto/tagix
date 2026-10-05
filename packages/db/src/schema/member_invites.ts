/**
 * Convites de membros (F71-S01 — CONTAS_E_CONVITES §4 e §6).
 *
 * Antes da F71 o "convite" era uma linha de `members` com `auth_user_id` aleatório: sem token,
 * sem expiração, sem reenvio. O convite agora é uma entidade própria e o `members` só recebe a
 * pessoa quando ela aceita.
 *
 * ## Token (T1)
 *
 * O link carrega 32 bytes aleatórios (`generateInviteToken`, repos/member-invites). O banco
 * guarda só o `sha256` em hex (`token_hash`): um vazamento da tabela não entrega convite
 * utilizável. Reenviar ou copiar o link troca o token (o anterior morre), porque o claro nunca
 * é gravado. Os convites migrados da forma antiga recebem `legacy:<hex>` — fora do formato de
 * um sha256, então nenhum token chega nesse hash: o admin reenvia pela UI.
 *
 * ## Papel (T4)
 *
 * `role <> 'OWNER'`: OWNER não entra por convite (PERMISSIONS §7). O papel do membro criado no
 * aceite vem daqui, nunca do corpo da requisição de aceite.
 *
 * ## Pendente
 *
 * Pendente = `accepted_at IS NULL AND revoked_at IS NULL`. Um pendente por
 * `(workspace_id, email)` (índice único parcial). Expirado continua "pendente" para a
 * unicidade até ser revogado ou reenviado; `invitesRepo.create` revoga o expirado antes de
 * criar o novo.
 *
 * ## Referências por workspace
 *
 * `invited_by`, `accepted_member_id` e `department_id` usam FK COMPOSTA
 * `(workspace_id, x) → alvo (workspace_id, id)` (padrão da F70-S12): a checagem de FK roda fora
 * da RLS, e a composta obriga o alvo a ser do mesmo workspace. O `ON DELETE SET NULL (coluna)`
 * da migração anula só a coluna da referência (o Drizzle não modela a lista de colunas; o SQL
 * da 0094 é a fonte de verdade).
 *
 * RLS por `workspace_id` (FORCE). Os caminhos que acontecem antes de haver empresa no escopo
 * (aceite pelo token, banner "você foi convidado") são privilegiados e ficam isolados em
 * `invitesRepo`.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';
import { departments } from './org';

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Papéis que um convite pode conceder. OWNER fica de fora (PERMISSIONS §7, T4). */
export const INVITABLE_ROLES = ['ADMIN', 'SUPERVISOR', 'AGENT', 'READONLY'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const memberInvites = pgTable(
  'member_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: text('role').$type<InvitableRole>().notNull(),
    /** Departamento inicial opcional (PERMISSIONS §7). FK composta abaixo. */
    departmentId: uuid('department_id'),
    /** sha256 hex do token do link. O token em claro nunca é gravado (T1). */
    tokenHash: text('token_hash').notNull(),
    /** Quem convidou. FK composta abaixo; `SET NULL` se o membro for apagado. */
    invitedBy: uuid('invited_by'),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    /** Membro criado (ou reativado) pelo aceite. */
    acceptedMemberId: uuid('accepted_member_id'),
    /** Último envio do email. Nulo = nunca enviado (convites migrados da forma antiga). */
    lastSentAt: ts('last_sent_at'),
    /** Envios feitos (criação + reenvios). O teto é aplicado em `invitesRepo.recordResend`. */
    sendCount: integer('send_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_member_invites_token_hash').on(t.tokenHash),
    // Um convite pendente por pessoa por empresa.
    uniqueIndex('uq_member_invites_pending_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    // Banner "você foi convidado" (GET /api/me/invites): pendentes pelo email da sessão.
    index('idx_member_invites_pending_by_email')
      .on(t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    // Histórico da tela de membros + alvo das ações de exclusão em members/departments.
    index('idx_member_invites_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_member_invites_invited_by')
      .on(t.invitedBy)
      .where(sql`${t.invitedBy} is not null`),
    index('idx_member_invites_accepted_member')
      .on(t.acceptedMemberId)
      .where(sql`${t.acceptedMemberId} is not null`),
    index('idx_member_invites_department')
      .on(t.departmentId)
      .where(sql`${t.departmentId} is not null`),
    foreignKey({
      name: 'member_invites_workspace_department_fk',
      columns: [t.workspaceId, t.departmentId],
      foreignColumns: [departments.workspaceId, departments.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'member_invites_workspace_invited_by_fk',
      columns: [t.workspaceId, t.invitedBy],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'member_invites_workspace_accepted_member_fk',
      columns: [t.workspaceId, t.acceptedMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('set null'),
    check('member_invites_role_chk', sql`${t.role} in ('ADMIN','SUPERVISOR','AGENT','READONLY')`),
    check('member_invites_token_hash_chk', sql`${t.tokenHash} ~ '^(legacy:)?[0-9a-f]{64}$'`),
    check('member_invites_send_count_chk', sql`${t.sendCount} >= 0`),
    check(
      'member_invites_final_state_chk',
      sql`not (${t.acceptedAt} is not null and ${t.revokedAt} is not null)`,
    ),
    check(
      'member_invites_accepted_member_chk',
      sql`${t.acceptedMemberId} is null or ${t.acceptedAt} is not null`,
    ),
  ],
);

export type MemberInvite = typeof memberInvites.$inferSelect;
export type NewMemberInvite = typeof memberInvites.$inferInsert;
