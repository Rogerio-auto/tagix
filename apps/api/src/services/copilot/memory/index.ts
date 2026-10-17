/**
 * Memória do negócio do Copiloto (F73-S11; A10): perfil, fatos com fonte, fontes conectadas.
 *
 * O que vai para o prompt NÃO é decidido aqui (ordem, limites e corte são de
 * `copilotMemoryRepo.listActiveForPrompt`, F73-S01); este módulo garante que Esquecer e
 * Corrigir mudam esse resultado na hora.
 */
export {
  MEMORY_ERROR_MESSAGES,
  MEMORY_ERROR_STATUS,
  MEMORY_RESTORE_WINDOW_HOURS,
  formatDatePt,
  memberDisplayName,
  normalizeFactText,
  sourceLabelCopilot,
  sourceLabelMember,
  type AuditContext,
  type MemoryFailureCode,
  type MemoryResult,
} from './common';
export { loadProfile, updateProfile, type ProfileUpdateResult } from './profile';
export {
  InvalidCursorError,
  MEMORY_FACTS_PAGE_DEFAULT,
  MEMORY_FACTS_PAGE_MAX,
  addMemberFact,
  correctFact,
  forgetFact,
  insertCopilotFact,
  listFactsPage,
  loadFact,
  restoreFact,
  type FactsPage,
} from './facts';
export {
  MEMORY_SOURCE_PROVIDER_TIMEOUT_MS,
  listMemorySources,
  registerMemorySource,
  type MemorySourceContext,
  type MemorySourceProvider,
} from './sources';
