/**
 * Repo do Chat de Suporte (F38-S01 / SUPPORT.md secao 2).
 *
 * support_threads e WORKSPACE-SCOPED; support_messages e isolada via subquery na
 * thread. Operacoes do MEMBRO recebem um DbTx de withWorkspace (RLS isola o
 * tenant). Operacoes da PLATAFORMA (cross-workspace) usam getDb() direto (owner
 * bypassa RLS) e SAO gated por requirePlatformAdmin na rota.
 *
 * assertThreadVisible (espelha assertConversationVisible da F30): a rota chama
 * antes de qualquer /:id/* do membro; thread fora do escopo -> erro 404 na rota.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, type DbTx } from '../client';
import { supportMessages, supportThreads, type SupportAttachment } from '../schema';

export type SupportThread = typeof supportThreads.$inferSelect;
export type SupportMessage = typeof supportMessages.$inferSelect;
export type SupportThreadStatus = 'open' | 'pending' | 'resolved';
export type SupportThreadPriority = 'low' | 'normal' | 'high';
export type SupportSenderType = 'member' | 'platform';

type NewThread = {
  workspaceId: string;
  openedBy: string | null;
  subject: string;
  priority?: SupportThreadPriority;
};

type NewMessage = {
  threadId: string;
  senderType: SupportSenderType;
  senderId: string | null;
  body: string;
  attachments?: SupportAttachment[];
};

export type PlatformThreadFilters = {
  status?: SupportThreadStatus;
  priority?: SupportThreadPriority;
  workspaceId?: string;
};

export const supportRepo = {
  /**
   * Garante que a thread pertence ao escopo do tx (RLS). Retorna a thread ou
   * null se invisivel/inexistente -> a rota traduz null em 404 (nao 403),
   * espelhando assertConversationVisible (F30) para nao vazar existencia.
   */
  async assertThreadVisible(tx: DbTx, threadId: string): Promise<SupportThread | null> {
    const [row] = await tx
      .select()
      .from(supportThreads)
      .where(eq(supportThreads.id, threadId))
      .limit(1);
    return row ?? null;
  },

  /** Abre uma thread no workspace do tx (status inicial open). */
  async createThread(tx: DbTx, input: NewThread): Promise<SupportThread> {
    const [row] = await tx
      .insert(supportThreads)
      .values({
        workspaceId: input.workspaceId,
        openedBy: input.openedBy,
        subject: input.subject,
        priority: input.priority ?? 'normal',
        status: 'open',
      })
      .returning();
    if (!row) throw new Error('Falha ao abrir support_thread.');
    return row;
  },

  /** Lista as threads do workspace do tx (mais recentes primeiro). */
  async listThreads(tx: DbTx): Promise<SupportThread[]> {
    return tx
      .select()
      .from(supportThreads)
      .orderBy(desc(supportThreads.lastMessageAt));
  },

  /** Mensagens de uma thread visivel (ordem cronologica). */
  async listMessages(tx: DbTx, threadId: string): Promise<SupportMessage[]> {
    return tx
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(supportMessages.createdAt);
  },

  /**
   * Anexa uma mensagem e carimba last_message_at na thread (mesma transacao).
   * O caller ja validou visibilidade via assertThreadVisible.
   */
  async addMessage(tx: DbTx, input: NewMessage): Promise<SupportMessage> {
    const [msg] = await tx
      .insert(supportMessages)
      .values({
        threadId: input.threadId,
        senderType: input.senderType,
        senderId: input.senderId,
        body: input.body,
        attachments: input.attachments ?? [],
      })
      .returning();
    if (!msg) throw new Error('Falha ao gravar support_message.');
    await tx
      .update(supportThreads)
      .set({ lastMessageAt: msg.createdAt, updatedAt: new Date() })
      .where(eq(supportThreads.id, input.threadId));
    return msg;
  },

  /** Marca a thread como resolvida (membro encerra o proprio pedido). */
  async resolveThread(tx: DbTx, threadId: string): Promise<SupportThread | null> {
    const [row] = await tx
      .update(supportThreads)
      .set({ status: 'resolved', updatedAt: new Date() })
      .where(eq(supportThreads.id, threadId))
      .returning();
    return row ?? null;
  },

  // ── Plataforma (cross-workspace; getDb owner; gated por requirePlatformAdmin) ──

  /** Lista threads de todos os workspaces com filtros opcionais. */
  async listThreadsPlatform(filters: PlatformThreadFilters = {}): Promise<SupportThread[]> {
    const conds = [];
    if (filters.status) conds.push(eq(supportThreads.status, filters.status));
    if (filters.priority) conds.push(eq(supportThreads.priority, filters.priority));
    if (filters.workspaceId) conds.push(eq(supportThreads.workspaceId, filters.workspaceId));
    const where = conds.length > 0 ? and(...conds) : undefined;
    return getDb()
      .select()
      .from(supportThreads)
      .where(where)
      .orderBy(desc(supportThreads.lastMessageAt))
      .limit(200);
  },

  /** Busca uma thread por id (sem escopo de tenant; uso platform-only). */
  async findThreadByIdPlatform(threadId: string): Promise<SupportThread | null> {
    const [row] = await getDb()
      .select()
      .from(supportThreads)
      .where(eq(supportThreads.id, threadId))
      .limit(1);
    return row ?? null;
  },

  /** Mensagens de uma thread (platform-only, sem escopo). */
  async listMessagesPlatform(threadId: string): Promise<SupportMessage[]> {
    return getDb()
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(supportMessages.createdAt);
  },

  /** Reply da plataforma + carimbo de last_message_at (mesma transacao). */
  async addMessagePlatform(input: NewMessage): Promise<SupportMessage> {
    return getDb().transaction(async (tx) => {
      const [msg] = await tx
        .insert(supportMessages)
        .values({
          threadId: input.threadId,
          senderType: input.senderType,
          senderId: input.senderId,
          body: input.body,
          attachments: input.attachments ?? [],
        })
        .returning();
      if (!msg) throw new Error('Falha ao gravar support_message (platform).');
      await tx
        .update(supportThreads)
        .set({ lastMessageAt: msg.createdAt, updatedAt: new Date() })
        .where(eq(supportThreads.id, input.threadId));
      return msg;
    });
  },

  /** Atualiza status/priority/assign de uma thread (platform-only). */
  async updateThreadPlatform(
    threadId: string,
    patch: {
      status?: SupportThreadStatus;
      priority?: SupportThreadPriority;
      assignedTo?: string | null;
    },
  ): Promise<SupportThread | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set['status'] = patch.status;
    if (patch.priority !== undefined) set['priority'] = patch.priority;
    if (patch.assignedTo !== undefined) set['assignedTo'] = patch.assignedTo;
    const [row] = await getDb()
      .update(supportThreads)
      .set(set)
      .where(eq(supportThreads.id, threadId))
      .returning();
    return row ?? null;
  },
};
