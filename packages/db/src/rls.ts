import { sql } from 'drizzle-orm';
import { getDb, type DbTx } from './client';

/**
 * Executa `fn` numa transação escopada a um workspace, sob o papel `hm_app`
 * (sujeito a RLS). O `SET LOCAL` garante que o escopo dura só a transação.
 *
 * Camadas de defesa multi-tenant (F56-S08, migration 0062):
 *   1. filtro explícito por `workspace_id` no código;
 *   2. RLS `ENABLE` + policy de isolamento por `app_current_workspace()`;
 *   3. `FORCE ROW LEVEL SECURITY` — a RLS vale até para o DONO das tabelas,
 *      fechando o bypass de quem não é superuser/BYPASSRLS;
 *   4. papel de conexão de app `hm_app_login` (LOGIN, NOSUPERUSER, NOBYPASSRLS):
 *      até caminhos `getDb()` diretos (sem `SET ROLE`) ficam sob RLS. Migrations e
 *      schedulers cross-tenant seguem no papel owner/superuser (bypass legítimo).
 *
 * `hm_app` é NOLOGIN por design: é assumido via `SET LOCAL ROLE` abaixo, não usado
 * como papel de conexão física.
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
