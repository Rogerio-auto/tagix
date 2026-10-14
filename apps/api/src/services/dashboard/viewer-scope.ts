/**
 * Recortes de quem está olhando, compartilhados pela Home e pela Hoje (F72-S04).
 *
 * ## Visibilidade da inbox (F30 — LIVECHAT_OPS §1)
 *
 * Toda lista/contagem que aponta para CONVERSAS (fila "aguardando", mídia que falhou,
 * speed-to-lead) passa pelo mesmo predicado da inbox: `buildVisibilityPredicate` de
 * `@hm/db`. Um SUPERVISOR enxerga os departamentos que lidera; a Home não pode mostrar
 * a ele (nem linkar) uma conversa que a inbox esconde.
 *
 * OWNER/ADMIN não filtram (o predicado seria `true`): devolve `null` para a query não
 * carregar subconsulta inútil. Os demais papéis recebem o predicado, mesmo quando já
 * há o recorte pessoal (`assigned_to = eu`): defesa em profundidade, custo desprezível.
 *
 * ## Orçamento de execução
 *
 * As cargas da Home, da Hoje e do Painel completo (`loadDashboard`/`drillDown`) rodam sob `SET LOCAL statement_timeout` de 5s, dentro
 * da tx com RLS (o `LOCAL` morre com a transação: não vaza para o pool). 5s é ~10x o
 * p95 esperado dessas agregações com os índices citados em `home.ts`; acima disso o
 * plano degenerou e é melhor errar rápido (o handler central devolve 500 com ref) do
 * que segurar conexão do pool enquanto o dono atualiza a tela.
 */
import { sql, type SQL } from 'drizzle-orm';
import { buildVisibilityPredicate, type DbTx } from '@hm/db';
import type { Role } from '@hm/shared';

export interface DashboardViewer {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
}

/** Predicado de visibilidade da inbox sobre `conversations`; `null` quando não restringe. */
export function inboxVisibilityFor(viewer: DashboardViewer): SQL | null {
  if (viewer.role === 'OWNER' || viewer.role === 'ADMIN') return null;
  return buildVisibilityPredicate({
    memberId: viewer.memberId,
    role: viewer.role,
    workspaceId: viewer.workspaceId,
  });
}

/** Teto por statement das cargas do dashboard (ms). Ver cabeçalho. */
export const DASHBOARD_STATEMENT_TIMEOUT_MS = 5_000;

/** Aplica o teto na transação corrente. Deve ser a 1ª instrução da carga. */
export async function applyDashboardStatementTimeout(tx: DbTx): Promise<void> {
  // Constante numérica do módulo, nunca entrada externa: `SET` não aceita parâmetro.
  await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${DASHBOARD_STATEMENT_TIMEOUT_MS}`));
}
