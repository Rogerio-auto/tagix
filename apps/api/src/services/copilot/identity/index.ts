/**
 * Identidade do membro nas ações do Copiloto (F73-S03, ADR-003).
 *
 * - `grant`: credencial HMAC do turno (`mintGrant`/`verifyGrant`);
 * - `principal`: quem pede, recarregado do banco a cada chamada;
 * - `authorize`: reautorização da capacidade (papel, matriz, assinatura, orçamento);
 * - `scope`: os predicados únicos de visibilidade (conversa, negócio, contato) e
 *   `resolveVisible` para ids vindos de `args` ou do contexto de página;
 * - `budget`: estado do orçamento mensal do Copiloto;
 * - `available`: a porta das rotas públicas `/api/copilot/*`.
 */
export {
  COPILOT_GRANT_MAX_LENGTH,
  COPILOT_GRANT_TTL_SECONDS,
  COPILOT_GRANT_VERSION,
  GRANT_REJECTION_REASONS,
  generateGrantNonce,
  mintGrant,
  verifyGrant,
  type CopilotGrantPayload,
  type GrantOptions,
  type GrantRejectionReason,
  type GrantVerification,
  type MintGrantInput,
} from './grant';
export {
  buildCopilotPrincipal,
  resolveCopilotPrincipal,
  sanitizeCapabilityMatrix,
  type CopilotPrincipal,
  type CopilotSubscriptionState,
} from './principal';
export {
  COPILOT_DENIAL_REASONS,
  authorizeCapability,
  type AuthorizeCapabilityOptions,
  type CopilotAuthorization,
  type CopilotDenialReason,
} from './authorize';
export {
  VISIBLE_LABEL_MAX,
  contactScope,
  conversationScope,
  dealScope,
  resolveVisible,
  type CopilotEntityRef,
  type CopilotEntityType,
  type VisibleEntity,
} from './scope';
export {
  COPILOT_QUERY_HARD_CEILING_RATIO,
  budgetResetsOn,
  computeBudgetState,
  loadCopilotBudget,
  monthToDateCopilotSpendUsd,
  type BudgetStateInput,
  type CopilotBudget,
} from './budget';
export { COPILOT_UNAVAILABLE_ERRORS, copilotAvailable } from './available';
