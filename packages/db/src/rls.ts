import { sql } from 'drizzle-orm';
import { getDb, type DbTx } from './client';

/**
 * Executa `fn` numa transação escopada a um workspace, sob o papel `hm_app`
 * (sujeito a RLS). O `SET LOCAL` garante que o escopo dura só a transação.
 *
 * Cinto-e-suspensório: além do filtro explícito por `workspace_id` no código,
 * a RLS no banco impede vazamento entre tenants.
 */
export async function withWorkspace<T>(
  workspaceId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role hm_app`);
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}
