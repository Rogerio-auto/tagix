/**
 * resolveEntitlements -- fonte UNICA de entitlements efetivos (F26-S04, secao 5.3).
 *
 * Entitlements efetivos de um workspace = `plan.limits/features` MERGE
 * `workspace_entitlement_overrides` (override do tenant). O override VENCE o plano
 * (custom plan / grandfathering). E a unica funcao que resolve isso -- UI e (futuro)
 * enforcement do produto leem DAQUI, nunca hardcode. A IA (allowed_models/caps) ja
 * tem sua propria resolucao em workspace_agent_policies (F25-S03); aqui sao os
 * limites/features NAO-IA (canais/membros/mensagens/features de produto).
 *
 * Roda como owner (camada de plataforma, gated por requirePlatformAdmin). Sem RLS.
 */
import { eq } from 'drizzle-orm';
import { entitlementOverridesRepo, getDb, schema } from '@hm/db';

const { workspaces, plans } = schema;

export interface EffectiveEntitlements {
  workspaceId: string;
  planId: string | null;
  planKey: string | null;
  planName: string | null;
  /** Limites efetivos (override > plano). */
  limits: Record<string, number>;
  /** Features efetivas (override > plano). */
  features: Record<string, boolean>;
  /** O que veio so do plano (antes do merge) -- para a UI mostrar a origem. */
  planLimits: Record<string, number>;
  planFeatures: Record<string, boolean>;
  /** O override cru aplicado (vazio se nao ha override). */
  overrideLimits: Record<string, number>;
  overrideFeatures: Record<string, boolean>;
}

/**
 * Resolve os entitlements efetivos de um workspace. Retorna null se o workspace
 * nao existe. Se nao houver plano, parte de limites/features vazios + override.
 */
export async function resolveEntitlements(
  workspaceId: string,
): Promise<EffectiveEntitlements | null> {
  const db = getDb();

  const [ws] = await db
    .select({
      id: workspaces.id,
      planId: workspaces.planId,
      planKey: plans.key,
      planName: plans.name,
      planLimits: plans.limits,
      planFeatures: plans.features,
    })
    .from(workspaces)
    .leftJoin(plans, eq(plans.id, workspaces.planId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return null;

  const override = await entitlementOverridesRepo.findByWorkspace(db, workspaceId);

  const planLimits = ws.planLimits ?? {};
  const planFeatures = ws.planFeatures ?? {};
  const overrideLimits = override?.limits ?? {};
  const overrideFeatures = override?.features ?? {};

  return {
    workspaceId: ws.id,
    planId: ws.planId,
    planKey: ws.planKey,
    planName: ws.planName,
    // Merge: override vence o plano (custom plan / grandfathering).
    limits: { ...planLimits, ...overrideLimits },
    features: { ...planFeatures, ...overrideFeatures },
    planLimits,
    planFeatures,
    overrideLimits,
    overrideFeatures,
  };
}
