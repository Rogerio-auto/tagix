import { z } from 'zod';
import type { ActiveWorkspace } from '@/shared/stores/auth.store';

/** Convite pendente da pessoa logada (`GET /api/me/invites`). */
export const PENDING_INVITE_SCHEMA = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  role: z.string(),
  inviterName: z.string().nullable().optional(),
  expiresAt: z.string(),
});
export type PendingInvite = z.infer<typeof PENDING_INVITE_SCHEMA>;

export const INVITES_RESPONSE_SCHEMA = z.object({ invites: z.array(PENDING_INVITE_SCHEMA) });

/** Rota de assinatura (CTA das faixas de cobrança). */
export const BILLING_HREF = '/settings/billing';

/** Faixa mostrada no shell. Só UMA por vez — a de maior prioridade. */
export type AccountBannerModel =
  | { kind: 'read_only' }
  | { kind: 'trial_ending'; days: number }
  | { kind: 'past_due' }
  | { kind: 'invite'; invite: PendingInvite; others: number };

/** Faixa de trial: avisa quando faltam 3 dias ou menos. */
export const TRIAL_WARNING_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * Status que vale AGORA. Espelha a regra do servidor (S06): `trial` com
 * `trialEndsAt` no passado conta como `expired` mesmo antes do tick de cobrança.
 */
export function effectiveSubscriptionStatus(
  workspace: Pick<ActiveWorkspace, 'subscriptionStatus' | 'trialEndsAt'>,
  now: number,
): ActiveWorkspace['subscriptionStatus'] {
  if (workspace.subscriptionStatus === 'trial' && workspace.trialEndsAt) {
    const ends = Date.parse(workspace.trialEndsAt);
    if (Number.isFinite(ends) && ends <= now) return 'expired';
  }
  return workspace.subscriptionStatus;
}

/** `true` quando a empresa ativa está em modo só leitura (`expired`/`canceled`). */
export function isWorkspaceReadOnly(
  workspace: Pick<ActiveWorkspace, 'subscriptionStatus' | 'trialEndsAt'> | null,
  now: number,
): boolean {
  if (!workspace) return false;
  const status = effectiveSubscriptionStatus(workspace, now);
  return status === 'expired' || status === 'canceled';
}

/** Dias inteiros que faltam (arredonda para cima); `null` se não há trial no prazo. */
export function trialDaysLeft(trialEndsAt: string | null, now: number): number | null {
  if (!trialEndsAt) return null;
  const ends = Date.parse(trialEndsAt);
  if (!Number.isFinite(ends) || ends <= now) return null;
  return Math.ceil((ends - now) / DAY_MS);
}

export interface PickBannerInput {
  workspace: ActiveWorkspace | null;
  invites: readonly PendingInvite[];
  now: number;
}

/**
 * Prioridade (uma por vez): 1) só leitura; 2) trial com ≤ 3 dias; 3) pagamento
 * pendente; 4) convite pendente. Cobrança vem antes de convite porque bloqueia o
 * trabalho; convite é uma oportunidade, não uma urgência.
 */
export function pickAccountBanner(input: PickBannerInput): AccountBannerModel | null {
  const { workspace, invites, now } = input;
  if (workspace) {
    if (isWorkspaceReadOnly(workspace, now)) return { kind: 'read_only' };
    if (workspace.subscriptionStatus === 'trial') {
      const days = trialDaysLeft(workspace.trialEndsAt, now);
      if (days !== null && days <= TRIAL_WARNING_DAYS) return { kind: 'trial_ending', days };
    }
    if (workspace.subscriptionStatus === 'past_due') return { kind: 'past_due' };
  }
  const open = invites.filter((i) => {
    const ends = Date.parse(i.expiresAt);
    return !Number.isFinite(ends) || ends > now;
  });
  const [first] = open;
  if (first) return { kind: 'invite', invite: first, others: open.length - 1 };
  return null;
}
