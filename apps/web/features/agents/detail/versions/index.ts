/**
 * Barrel do módulo de versionamento de prompt do agente (F56-S31).
 *
 * `VersionsPanel` é o componente drop-in da aba "Versões" do detalhe do agente
 * (montável em `detail/tabs.ts` + `AgentDetail.tsx`). Mantém-se self-contained
 * (queries/tipos/diff próprios) para respeitar a fronteira do slot.
 */
export { VersionsPanel } from './VersionsPanel';
export { VersionDiff } from './VersionDiff';
export { diffLines, diffStats } from './diff';
export type { DiffLine, DiffLineType } from './diff';
export type { PromptVersion, PromptVersionDiff, PromptVersionStatus, DraftInput } from './types';
