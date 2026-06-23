/**
 * Repo do estado de onboarding/first-run (F43-S01 / ONBOARDING.md §3.1).
 *
 * O estado vive em colunas jsonb dedicadas: `workspaces.onboarding` (por workspace)
 * e `members.tour_state` (por membro). Ambas as tabelas já têm RLS → todas as
 * operações recebem um `DbTx` de `withWorkspace` (a RLS isola o tenant; o filtro
 * explícito por id é o suspensório).
 *
 * `mergeWorkspaceOnboarding` faz um patch shallow do objeto (preserva chaves não
 * tocadas) — o caller raramente quer sobrescrever o estado inteiro (ex.: gravar
 * `setup_completed` sem apagar `niche_key`). `setMemberTourState` carimba o estado
 * de um tour específico, preservando os demais.
 */
import { eq } from 'drizzle-orm';
import type { DbTx } from '../client';
import { members, workspaces } from '../schema';

export type WorkspaceOnboarding = NonNullable<(typeof workspaces.$inferSelect)['onboarding']>;
export type MemberTourState = NonNullable<(typeof members.$inferSelect)['tourState']>;
export type TourEntry = MemberTourState[string];

export const onboardingRepo = {
  /** Lê o estado de onboarding do workspace do tx. `{}` se nunca gravado. */
  async getWorkspaceOnboarding(tx: DbTx, workspaceId: string): Promise<WorkspaceOnboarding> {
    const [row] = await tx
      .select({ onboarding: workspaces.onboarding })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row?.onboarding ?? {};
  },

  /** Substitui o estado de onboarding do workspace (sobrescreve por completo). */
  async setWorkspaceOnboarding(
    tx: DbTx,
    workspaceId: string,
    onboarding: WorkspaceOnboarding,
  ): Promise<WorkspaceOnboarding> {
    const [row] = await tx
      .update(workspaces)
      .set({ onboarding, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning({ onboarding: workspaces.onboarding });
    if (!row) throw new Error('Workspace não encontrado ao gravar onboarding.');
    return row.onboarding ?? {};
  },

  /**
   * Patch shallow do estado de onboarding (preserva chaves não tocadas). Lê o
   * estado atual no mesmo tx e regrava o merge — atômico sob a transação.
   */
  async mergeWorkspaceOnboarding(
    tx: DbTx,
    workspaceId: string,
    patch: Partial<WorkspaceOnboarding>,
  ): Promise<WorkspaceOnboarding> {
    const current = await onboardingRepo.getWorkspaceOnboarding(tx, workspaceId);
    const merged: WorkspaceOnboarding = { ...current, ...patch };
    return onboardingRepo.setWorkspaceOnboarding(tx, workspaceId, merged);
  },

  /** Lê o estado de tours de um membro. `{}` se nunca gravado. */
  async getMemberTourState(tx: DbTx, memberId: string): Promise<MemberTourState> {
    const [row] = await tx
      .select({ tourState: members.tourState })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);
    return row?.tourState ?? {};
  },

  /** Substitui o estado de tours de um membro (sobrescreve por completo). */
  async setMemberTourState(
    tx: DbTx,
    memberId: string,
    tourState: MemberTourState,
  ): Promise<MemberTourState> {
    const [row] = await tx
      .update(members)
      .set({ tourState, updatedAt: new Date() })
      .where(eq(members.id, memberId))
      .returning({ tourState: members.tourState });
    if (!row) throw new Error('Membro não encontrado ao gravar tour_state.');
    return row.tourState ?? {};
  },

  /**
   * Carimba o estado de UM tour (completed_at/dismissed), preservando os demais.
   * Lê + regrava o merge no mesmo tx (atômico sob a transação).
   */
  async markTour(
    tx: DbTx,
    memberId: string,
    tourId: string,
    entry: TourEntry,
  ): Promise<MemberTourState> {
    const current = await onboardingRepo.getMemberTourState(tx, memberId);
    const merged: MemberTourState = { ...current, [tourId]: { ...current[tourId], ...entry } };
    return onboardingRepo.setMemberTourState(tx, memberId, merged);
  },
};
