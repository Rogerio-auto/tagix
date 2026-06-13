/**
 * Repo de entitlement overrides (F26-S01). `workspace_entitlement_overrides` é
 * workspace-scoped (RLS). A camada de plataforma lê/escreve como owner (gated por
 * `requirePlatformAdmin`), por isso os métodos recebem o `db`/`tx` por parâmetro:
 * a API de plataforma passa `getDb()` (owner, sem RLS); o produto, no futuro, passa
 * o `tx` de `withWorkspace`. `resolveEntitlements` (F26-S04) lê via `findByWorkspace`.
 */
import { eq } from 'drizzle-orm';
import type { DB, DbTx } from '../client';
import { workspaceEntitlementOverrides } from '../schema';

export type WorkspaceEntitlementOverride = typeof workspaceEntitlementOverrides.$inferSelect;

type Executor = DB | DbTx;

export const entitlementOverridesRepo = {
  /** Busca o override de um workspace (ou null se nunca foi definido). */
  async findByWorkspace(
    db: Executor,
    workspaceId: string,
  ): Promise<WorkspaceEntitlementOverride | null> {
    const [row] = await db
      .select()
      .from(workspaceEntitlementOverrides)
      .where(eq(workspaceEntitlementOverrides.workspaceId, workspaceId))
      .limit(1);
    return row ?? null;
  },

  /**
   * Upsert do override (1:1 por workspace). Sobrescreve limits/features inteiros
   * (a API resolve o merge parcial antes de chamar). Registra `updatedBy`/`updatedAt`.
   */
  async upsert(
    db: Executor,
    input: {
      workspaceId: string;
      limits: Record<string, number>;
      features: Record<string, boolean>;
      updatedBy: string | null;
    },
  ): Promise<WorkspaceEntitlementOverride> {
    const [row] = await db
      .insert(workspaceEntitlementOverrides)
      .values({
        workspaceId: input.workspaceId,
        limits: input.limits,
        features: input.features,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceEntitlementOverrides.workspaceId,
        set: {
          limits: input.limits,
          features: input.features,
          updatedBy: input.updatedBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('Falha ao gravar workspace_entitlement_overrides.');
    return row;
  },
};
