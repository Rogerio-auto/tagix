/**
 * Repo de quick_replies / respostas rápidas (F43-S01 / ONBOARDING.md §2.1).
 *
 * Workspace-scoped: todas as operações recebem um `DbTx` de `withWorkspace` — a
 * RLS isola o tenant (o filtro explícito por `workspace_id` é o suspensório).
 *
 * `upsert` é idempotente por (workspace_id, title): é a âncora usada pelo
 * instanciador de blueprint (F43-S02) para que re-onboarding não duplique
 * respostas. Conflito no UNIQUE atualiza body/department/position (a versão do
 * blueprint vence) sem criar nova linha.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DbTx } from '../client';
import { quickReplies } from '../schema';

export type QuickReply = typeof quickReplies.$inferSelect;
export type NewQuickReply = typeof quickReplies.$inferInsert;

type CreateInput = {
  workspaceId: string;
  title: string;
  body: string;
  departmentId?: string | null;
  position?: number;
  createdBy?: string | null;
};

type UpdateInput = {
  title?: string;
  body?: string;
  departmentId?: string | null;
  position?: number;
};

export const quickRepliesRepo = {
  /** Cria uma resposta rápida no workspace do tx. */
  async create(tx: DbTx, input: CreateInput): Promise<QuickReply> {
    const [row] = await tx
      .insert(quickReplies)
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body,
        departmentId: input.departmentId ?? null,
        position: input.position ?? 0,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao criar quick_reply.');
    return row;
  },

  /**
   * Upsert idempotente por (workspace_id, title). Re-aplicar o mesmo blueprint
   * NÃO duplica: o conflito atualiza body/department/position e carimba updated_at.
   */
  async upsert(tx: DbTx, input: CreateInput): Promise<QuickReply> {
    const [row] = await tx
      .insert(quickReplies)
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body,
        departmentId: input.departmentId ?? null,
        position: input.position ?? 0,
        createdBy: input.createdBy ?? null,
      })
      .onConflictDoUpdate({
        target: [quickReplies.workspaceId, quickReplies.title],
        set: {
          body: input.body,
          departmentId: input.departmentId ?? null,
          position: input.position ?? 0,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Falha ao fazer upsert de quick_reply.');
    return row;
  },

  /** Lista todas as respostas do workspace do tx (ordenadas por posição/título). */
  async listByWorkspace(tx: DbTx, workspaceId: string): Promise<QuickReply[]> {
    return tx
      .select()
      .from(quickReplies)
      .where(eq(quickReplies.workspaceId, workspaceId))
      .orderBy(asc(quickReplies.position), asc(quickReplies.title));
  },

  /**
   * Respostas de um departamento específico do workspace do tx. NÃO inclui as
   * globais (department_id null) — o caller decide se mescla com listByWorkspace.
   */
  async listByDepartment(
    tx: DbTx,
    workspaceId: string,
    departmentId: string,
  ): Promise<QuickReply[]> {
    return tx
      .select()
      .from(quickReplies)
      .where(
        and(
          eq(quickReplies.workspaceId, workspaceId),
          eq(quickReplies.departmentId, departmentId),
        ),
      )
      .orderBy(asc(quickReplies.position), asc(quickReplies.title));
  },

  /** Busca uma resposta por id (escopo do tx). Null se invisível/inexistente. */
  async findById(tx: DbTx, id: string): Promise<QuickReply | null> {
    const [row] = await tx.select().from(quickReplies).where(eq(quickReplies.id, id)).limit(1);
    return row ?? null;
  },

  /** Atualiza campos de uma resposta (escopo do tx). Carimba updated_at. */
  async update(tx: DbTx, id: string, patch: UpdateInput): Promise<QuickReply | null> {
    const set: Partial<NewQuickReply> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.departmentId !== undefined) set.departmentId = patch.departmentId;
    if (patch.position !== undefined) set.position = patch.position;
    const [row] = await tx
      .update(quickReplies)
      .set(set)
      .where(eq(quickReplies.id, id))
      .returning();
    return row ?? null;
  },

  /** Remove uma resposta (escopo do tx). Retorna true se algo foi removido. */
  async remove(tx: DbTx, id: string): Promise<boolean> {
    const rows = await tx.delete(quickReplies).where(eq(quickReplies.id, id)).returning();
    return rows.length > 0;
  },
};
