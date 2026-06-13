/**
 * Tipos compartilhados do painel de super-admin (F25-S06).
 *
 * Espelham os contratos das APIs de plataforma (F25-S02..S05). Mantidos aqui em
 * `lib/` para que as páginas (S07/S08) reusem sem reescrever — fonte única de tipo
 * client-side. Nada de `any`: shapes explícitos.
 */

/** Sessão mínima do super-admin (derivada de `GET /api/me`). */
export interface PlatformAdminMe {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly isPlatformAdmin: boolean;
}

// ─── Modelos (F25-S02) ──────────────────────────────────────────────────────
export interface LlmModel {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly upstreamProvider: string;
  readonly contextLength: number | null;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly pricingPromptPer1m: number | null;
  readonly pricingCompletionPer1m: number | null;
  readonly isActive: boolean;
  readonly defaultPlanKeys: readonly string[];
  readonly notes: string | null;
  readonly syncedAt: string | null;
}

export interface ModelSyncResult {
  readonly upserted: number;
  readonly total: number;
}

// ─── Políticas (F25-S03) ────────────────────────────────────────────────────
export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface WorkspaceAgentPolicy {
  readonly workspaceId: string;
  readonly allowedModels: readonly string[];
  readonly defaultChatModel: string | null;
  readonly allowStreaming: boolean;
  readonly allowInterrupts: boolean;
  readonly allowParallelTools: boolean;
  readonly allowVision: boolean;
  readonly allowTranscription: boolean;
  readonly allowPersistentCheckpoints: boolean;
  readonly allowAgentConversions: boolean;
  readonly agentConversionRequireApproval: boolean;
  readonly maxIterations: number;
  readonly maxToolsPerAgent: number;
  readonly maxTokensPerCall: number;
  readonly maxMonthlyCostUsd: string | null;
  readonly maxDailyInvocations: number | null;
  readonly allowedToolCategories: readonly string[];
  readonly updatedBy: string | null;
  readonly updatedAt: string | null;
}

// ─── Secrets (F25-S04) ──────────────────────────────────────────────────────
export interface PlatformSecretMeta {
  readonly key: string;
  readonly keyVersion: number;
  readonly updatedAt: string | null;
  /** `true` quando há um valor cifrado salvo (nunca o valor em si). */
  readonly isSet: boolean;
}

// ─── Uso (F25-S05) ──────────────────────────────────────────────────────────
export interface UsageBucket {
  /** workspaceId | model slug | 'YYYY-MM-DD', conforme `groupBy`. */
  readonly key: string;
  readonly label: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly requests: number;
}

export interface TopSpender {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly costUsd: number;
  readonly totalTokens: number;
}

export interface CapAlert {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly monthCostUsd: number;
  readonly capUsd: number;
  readonly pctOfCap: number;
}
