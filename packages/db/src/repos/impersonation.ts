/**
 * Repo de impersonation / view-as (F26-S01). `impersonation_sessions` é
 * PLATFORM-LEVEL (não tem RLS de tenant) → todas as queries rodam como owner via
 * `getDb()`. O guard `requirePlatformAdmin` (API) é a fronteira de acesso; este repo
 * é a DAL pura. A resolução de sessão ativa (middleware F26-S05) e o start/end/list
 * (API F26-S05) consomem estes métodos.
 */
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { impersonationSessions } from '../schema';

export type ImpersonationSession = typeof impersonationSessions.$inferSelect;

export const impersonationSessionsRepo = {
  /** Cria uma sessão view-as time-boxed. Retorna a sessão criada. */
  async create(input: {
    adminMemberId: string;
    targetWorkspaceId: string;
    reason: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<ImpersonationSession> {
    const [row] = await getDb()
      .insert(impersonationSessions)
      .values({
        adminMemberId: input.adminMemberId,
        targetWorkspaceId: input.targetWorkspaceId,
        mode: 'view',
        reason: input.reason,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao criar impersonation_session.');
    return row;
  },

  /** Busca uma sessão por id (sem filtro de validade). */
  async findById(id: string): Promise<ImpersonationSession | null> {
    const [row] = await getDb()
      .select()
      .from(impersonationSessions)
      .where(eq(impersonationSessions.id, id))
      .limit(1);
    return row ?? null;
  },

  /**
   * Resolve uma sessão ATIVA (não encerrada e não expirada) por id, no instante
   * `now`. É o hot-path do middleware: se retorna null, o claim é inválido →
   * volta ao fluxo normal. Não confia só no `endedAt`; cruza com `expiresAt`.
   */
  async findActiveById(id: string, now: Date): Promise<ImpersonationSession | null> {
    const [row] = await getDb()
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.id, id),
          isNull(impersonationSessions.endedAt),
          gt(impersonationSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /** Lista sessões ativas (não encerradas e não expiradas), mais recentes primeiro. */
  async listActive(now: Date): Promise<ImpersonationSession[]> {
    return getDb()
      .select()
      .from(impersonationSessions)
      .where(and(isNull(impersonationSessions.endedAt), gt(impersonationSessions.expiresAt, now)))
      .orderBy(desc(impersonationSessions.startedAt));
  },

  /**
   * Encerra uma sessão (kill-switch). Só encerra se ainda estiver aberta
   * (`ended_at is null`) — idempotente. Retorna a sessão encerrada ou null.
   */
  async end(id: string, endedAt: Date): Promise<ImpersonationSession | null> {
    const [row] = await getDb()
      .update(impersonationSessions)
      .set({ endedAt })
      .where(and(eq(impersonationSessions.id, id), isNull(impersonationSessions.endedAt)))
      .returning();
    return row ?? null;
  },

  /** Encerra em lote todas as sessões já expiradas mas ainda abertas (housekeeping). */
  async endExpired(now: Date): Promise<number> {
    const rows = await getDb()
      .update(impersonationSessions)
      .set({ endedAt: now })
      .where(
        and(
          isNull(impersonationSessions.endedAt),
          sql`${impersonationSessions.expiresAt} <= ${now}`,
        ),
      )
      .returning({ id: impersonationSessions.id });
    return rows.length;
  },
};
