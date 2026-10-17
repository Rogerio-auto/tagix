/**
 * Principal do Copiloto (ADR-003 §1 e §3.4–§3.5): QUEM está pedindo, resolvido no servidor.
 *
 * Nada do modelo, do contexto de página nem dos `args` entra aqui. A identidade vem do grant
 * (verificado) e é recarregada do banco a CADA chamada, sem cache: rebaixar, remover ou
 * desativar alguém vale na chamada seguinte, no meio do turno; uma assinatura que venceu
 * agora já bloqueia a próxima escrita.
 *
 * Custo: 2 queries indexadas por PK (membro ⨝ workspace; `copilot_settings`).
 */
import { and, eq } from 'drizzle-orm';
import { copilotSettingsRepo, schema, type CopilotSettingsView, type DbTx } from '@hm/db';
import {
  CAPABILITY_KEYS,
  COPILOT_MATRIX_USE_KEY,
  ROLES,
  effectiveCapabilities,
  type CapabilityMatrix,
  type CapabilityMatrixKey,
  type EffectiveCapabilities,
  type Role,
} from '@hm/shared';
import {
  effectiveSubscriptionStatus,
  isSubscriptionInactive,
} from '../../../middlewares/subscription-guard';

export interface CopilotSubscriptionState {
  /** `trial` vencido já conta como `expired` (mesma régua do guard de assinatura). */
  readonly effectiveStatus: string;
  /** Só leitura: consultas seguem, nenhuma escrita passa (P9). */
  readonly inactive: boolean;
}

export interface CopilotPrincipal {
  readonly workspaceId: string;
  /** Membro cujas permissões são usadas. */
  readonly memberId: string;
  /** Quem pediu. Igual a `memberId` no Copiloto; só difere no fluxo de aprovação (S05). */
  readonly requestedByMemberId: string;
  /** Papel ATUAL, relido agora. */
  readonly role: Role;
  /** `active` é o único que autoriza alguma coisa. */
  readonly memberStatus: string;
  readonly subscription: CopilotSubscriptionState;
  /** Configuração efetiva (linha gravada ou defaults). */
  readonly settings: CopilotSettingsView;
  /** Matriz saneada (só papéis, capacidades e booleanos conhecidos). */
  readonly matrix: CapabilityMatrix;
  /** `can(role, perm) ∧ matriz[role][cap] ≠ false`, para 1 alvo. */
  readonly effectiveCapabilities: EffectiveCapabilities;
}

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);
const MATRIX_KEYS: ReadonlySet<string> = new Set<string>([
  ...CAPABILITY_KEYS,
  COPILOT_MATRIX_USE_KEY,
]);

function isRole(value: string): value is Role {
  return ROLE_SET.has(value);
}

function isMatrixKey(value: string): value is CapabilityMatrixKey {
  return MATRIX_KEYS.has(value);
}

/**
 * A matriz vem de `jsonb`. Só sobrevivem `{ papel conhecido: { chave conhecida: boolean } }`;
 * o resto é descartado. Descartar uma entrada nunca CONCEDE nada: a matriz só restringe, e
 * ausente = herda o papel.
 */
export function sanitizeCapabilityMatrix(raw: unknown): CapabilityMatrix {
  const out: CapabilityMatrix = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [role, row] of Object.entries(raw)) {
    if (!isRole(role) || typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const clean: Partial<Record<CapabilityMatrixKey, boolean>> = {};
    for (const [key, value] of Object.entries(row)) {
      if (isMatrixKey(key) && typeof value === 'boolean') clean[key] = value;
    }
    out[role] = clean;
  }
  return out;
}

/** Monta o principal a partir de dados já carregados (rotas que já têm `req.auth`). */
export function buildCopilotPrincipal(input: {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
  readonly memberStatus: string;
  readonly subscriptionStatus: string;
  readonly trialEndsAt: Date | null;
  readonly settings: CopilotSettingsView;
  readonly now?: Date;
}): CopilotPrincipal {
  const now = input.now ?? new Date();
  const matrix = sanitizeCapabilityMatrix(input.settings.capabilityMatrix);
  return {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    requestedByMemberId: input.memberId,
    role: input.role,
    memberStatus: input.memberStatus,
    subscription: {
      effectiveStatus: effectiveSubscriptionStatus(
        input.subscriptionStatus,
        input.trialEndsAt,
        now,
      ),
      inactive: isSubscriptionInactive(input.subscriptionStatus, input.trialEndsAt, now),
    },
    settings: input.settings,
    matrix,
    effectiveCapabilities: effectiveCapabilities(input.role, matrix),
  };
}

/**
 * Recarrega membro, workspace e `copilot_settings` sob o `tx` RLS do workspace.
 *
 * `null` quando o membro não existe NESTE workspace ou tem papel desconhecido: o chamador
 * recusa (falha fechada). Membro existente mas não `active` volta com `memberStatus`, e a
 * autorização recusa por `role`.
 */
export async function resolveCopilotPrincipal(
  tx: DbTx,
  input: { readonly workspaceId: string; readonly memberId: string; readonly now?: Date },
): Promise<CopilotPrincipal | null> {
  const { members, workspaces } = schema;
  const [row] = await tx
    .select({
      role: members.role,
      status: members.status,
      subscriptionStatus: workspaces.subscriptionStatus,
      trialEndsAt: workspaces.trialEndsAt,
    })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(and(eq(members.id, input.memberId), eq(members.workspaceId, input.workspaceId)))
    .limit(1);
  if (!row || !isRole(row.role)) return null;
  const settings = await copilotSettingsRepo.get(tx, input.workspaceId);
  return buildCopilotPrincipal({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    role: row.role,
    memberStatus: row.status,
    subscriptionStatus: row.subscriptionStatus,
    trialEndsAt: row.trialEndsAt,
    settings,
    ...(input.now ? { now: input.now } : {}),
  });
}
