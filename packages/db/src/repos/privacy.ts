/**
 * Repo de privacidade/LGPD (F10-S02). Acesso a `data_export_jobs`.
 *
 * Todas as queries rodam DENTRO de uma transação RLS-escopada (`tx` de
 * `withWorkspace`), portanto recebem o `DbTx` por parâmetro — nunca abrem o próprio
 * escopo. Isso mantém o isolamento por workspace consistente com o resto do DAL.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DbTx } from '../client';
import { dataExportJobs, type DataExportScope } from '../schema';

export type DataExportJob = typeof dataExportJobs.$inferSelect;

export const dataExportJobsRepo = {
  /** Cria um job `pending` para o scope dado. Retorna o job criado. */
  async create(
    tx: DbTx,
    input: { workspaceId: string; requestedBy: string | null; scope: DataExportScope },
  ): Promise<DataExportJob> {
    const [row] = await tx
      .insert(dataExportJobs)
      .values({
        workspaceId: input.workspaceId,
        requestedBy: input.requestedBy,
        scope: input.scope,
        status: 'pending',
      })
      .returning();
    if (!row) throw new Error('Falha ao criar data_export_job.');
    return row;
  },

  /** Busca um job por id (já isolado por RLS no `tx`). */
  async findById(tx: DbTx, id: string): Promise<DataExportJob | null> {
    const [row] = await tx.select().from(dataExportJobs).where(eq(dataExportJobs.id, id)).limit(1);
    return row ?? null;
  },

  /**
   * Reivindica um job `pending` específico (otimista): só passa para `processing`
   * se ainda estiver `pending`. Retorna o job atualizado ou `null` se já foi pego.
   */
  async claim(tx: DbTx, id: string, startedAt: Date): Promise<DataExportJob | null> {
    const [row] = await tx
      .update(dataExportJobs)
      .set({ status: 'processing', startedAt })
      .where(and(eq(dataExportJobs.id, id), eq(dataExportJobs.status, 'pending')))
      .returning();
    return row ?? null;
  },

  /** Marca um job como concluído com o artefato e a expiração. */
  async markDone(
    tx: DbTx,
    id: string,
    input: { artifactKey: string; artifactBytes: number; expiresAt: Date; completedAt: Date },
  ): Promise<void> {
    await tx
      .update(dataExportJobs)
      .set({
        status: 'done',
        artifactKey: input.artifactKey,
        artifactBytes: String(input.artifactBytes),
        expiresAt: input.expiresAt,
        completedAt: input.completedAt,
      })
      .where(eq(dataExportJobs.id, id));
  },

  /** Marca um job como falho com a mensagem de erro (truncada). */
  async markFailed(tx: DbTx, id: string, error: string, completedAt: Date): Promise<void> {
    await tx
      .update(dataExportJobs)
      .set({ status: 'failed', error: error.slice(0, 2000), completedAt })
      .where(eq(dataExportJobs.id, id));
  },

  /** Lista os jobs `pending` do workspace (mais antigo primeiro). */
  async listPending(tx: DbTx, limit: number): Promise<DataExportJob[]> {
    return tx
      .select()
      .from(dataExportJobs)
      .where(eq(dataExportJobs.status, 'pending'))
      .orderBy(asc(dataExportJobs.createdAt))
      .limit(limit);
  },
};
