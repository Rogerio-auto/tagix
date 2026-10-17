/**
 * Autorização de uma capacidade do Copiloto (ADR-003 §3, passos 4–6), falhando fechado.
 *
 * Ordem (a primeira recusa vence, e o motivo é o daquele passo):
 *   4. membro `active`                                               → senão `role`
 *   5. `copilot_settings.enabled`                                     → senão `copilot_disabled`
 *   6. capacidade:
 *      a. `can(role, perm(targetCount))` (+ permissões da ferramenta)  → senão `role`
 *      b. `matriz[role][cap] ≠ false` (e `matriz[role].use ≠ false`)   → senão `capability_disabled`
 *      c. escrita exige assinatura ativa                               → senão `subscription_inactive`
 *      d. orçamento: `paused` barra tudo; `queries_only` barra escrita  → senão `budget`
 *
 * Função pura sobre o principal recém-recarregado (`resolveCopilotPrincipal`): o callback
 * chama a cada ferramenta; o motor de propostas (S05) chama de novo no confirmar.
 */
import {
  can,
  capabilityAllowed,
  isWriteCapability,
  type CapabilityKey,
  type CopilotBudgetState,
  type Permission,
} from '@hm/shared';
import type { CopilotPrincipal } from './principal';

export const COPILOT_DENIAL_REASONS = [
  'role',
  'capability_disabled',
  'subscription_inactive',
  'budget',
  'copilot_disabled',
] as const;
export type CopilotDenialReason = (typeof COPILOT_DENIAL_REASONS)[number];

export type CopilotAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: CopilotDenialReason };

export interface AuthorizeCapabilityOptions {
  /** Alvos reais da chamada (`message.send` muda de permissão com 2+). Default 1. */
  readonly targetCount?: number;
  /**
   * A chamada escreve? O catálogo é a fonte: capacidade de escrita é escrita mesmo que o
   * chamador diga `false` (só é possível ENDURECER, nunca afrouxar).
   */
  readonly isWrite?: boolean;
  /** Estado do orçamento do mês (`loadCopilotBudget`). */
  readonly budget: CopilotBudgetState;
  /**
   * Permissões de entidade exigidas pela ferramenta, além da capacidade. Ex.: consulta do
   * pipeline exige `pipeline.view`; de campanhas, `campaign.list` (COPILOTO.md §6.2).
   */
  readonly permissions?: readonly Permission[];
}

const ALLOWED: CopilotAuthorization = { allowed: true };
const deny = (reason: CopilotDenialReason): CopilotAuthorization => ({ allowed: false, reason });

export function authorizeCapability(
  principal: CopilotPrincipal,
  capability: CapabilityKey,
  options: AuthorizeCapabilityOptions,
): CopilotAuthorization {
  // 4. Membro ativo. Removido/suspenso/convidado não age, nem para consultar.
  if (principal.memberStatus !== 'active') return deny('role');

  // 5. Copiloto ligado no workspace.
  if (!principal.settings.enabled) return deny('copilot_disabled');

  // 6a/6b. Papel e matriz, com o volume real.
  const rawCount = options.targetCount ?? 1;
  const targetCount = Number.isFinite(rawCount) ? Math.max(1, Math.trunc(rawCount)) : 1;
  const effective = capabilityAllowed(principal.role, principal.matrix, capability, targetCount);
  if (!effective.allowed) {
    return deny(effective.reason === 'disabled_by_owner' ? 'capability_disabled' : 'role');
  }
  for (const perm of options.permissions ?? []) {
    if (!can(principal.role, perm)) return deny('role');
  }

  // 6c. Só leitura: escrita nunca passa.
  const isWrite = isWriteCapability(capability) || options.isWrite === true;
  if (isWrite && principal.subscription.inactive) return deny('subscription_inactive');

  // 6d. Orçamento.
  if (options.budget === 'paused') return deny('budget');
  if (options.budget === 'queries_only' && isWrite) return deny('budget');

  return ALLOWED;
}
