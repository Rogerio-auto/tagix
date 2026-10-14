/**
 * Recorte da Hoje por quem está olhando (F72-S04). Decidido no SERVIDOR, a partir do
 * papel validado da sessão — nunca de parâmetro do cliente.
 *
 * - **Agenda**: SEMPRE os calendários que o membro acessa (`calendarRepo
 *   .accessibleCalendarIds`), para todos os papéis. É a mesma autoridade do módulo de
 *   calendário (`middlewares/calendar-access.ts`): a Hoje não mostra compromisso que a
 *   Agenda esconderia. Atenção: para OWNER/ADMIN ela NÃO é "tudo" — cobre o calendário
 *   da empresa, TODOS os pessoais e os de time em que o membro está; calendário de um
 *   time de que o OWNER não participa fica fora, como fica na própria Agenda.
 * - **Fila "aguardando"**: AGENT/READONLY veem só as atribuídas a eles; todo papel que
 *   não é OWNER/ADMIN recebe ainda o predicado de visibilidade da inbox (F30) — o
 *   SUPERVISOR enxerga os departamentos que lidera.
 * - **Resultado do mês**: só no escopo de empresa (SUPERVISOR/ADMIN/OWNER). São
 *   contagens agregadas, sem identidade de conversa (mesma decisão da Home: ver o
 *   cabeçalho de `services/dashboard/home.ts`).
 */
import type { SQL } from 'drizzle-orm';
import { calendarRepo, type DbTx } from '@hm/db';
import { homeScopeForRole } from '../../services/dashboard/home-model';
import {
  inboxVisibilityFor,
  type DashboardViewer,
} from '../../services/dashboard/viewer-scope';

export interface TodayScope {
  /** Calendários cuja agenda aparece. Lista vazia = nenhum compromisso (nunca "todos"). */
  readonly calendarIds: readonly string[];
  /** Recorte pessoal da fila: só conversas atribuídas a este membro. */
  readonly assignedTo: string | null;
  /** Predicado da inbox (F30) sobre `conversations`; `null` = sem restrição (OWNER/ADMIN). */
  readonly inboxVisibility: SQL | null;
  /** Calcula o resultado da empresa no mês. */
  readonly includeMonth: boolean;
}

export async function resolveTodayScope(tx: DbTx, viewer: DashboardViewer): Promise<TodayScope> {
  const personal = homeScopeForRole(viewer.role) === 'personal';
  const calendarIds = await calendarRepo.accessibleCalendarIds(tx, {
    memberId: viewer.memberId,
    role: viewer.role,
  });
  return {
    calendarIds,
    assignedTo: personal ? viewer.memberId : null,
    inboxVisibility: inboxVisibilityFor(viewer),
    includeMonth: !personal,
  };
}
