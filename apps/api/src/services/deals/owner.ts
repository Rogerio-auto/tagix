/**
 * Trocar o responsável de um negócio (F73-S08, extraído de `PUT /api/deals/:id`).
 *
 * Um só caminho para a tela e para o Copiloto: confere que o novo responsável é membro DESTE
 * workspace (a FK ignora RLS, F70-S11), grava `deals.owner_id` e registra `deal_history`
 * `owner_changed` com o ator e a correlação (`metadata.via`/`proposal_id` quando vem do
 * Copiloto). Trocar para o mesmo responsável é no-op (sem histórico).
 *
 * Roda na transação RLS do chamador; não emite socket (o chamador emite `deal:updated` depois
 * do commit).
 */
import { eq } from 'drizzle-orm';
import { requireRefsInWorkspace, schema, type DbTx } from '@hm/db';
import type { DealActor, DealMoveMetadata } from '../deal-move';

const { deals, dealHistory } = schema;

export type DealRow = typeof deals.$inferSelect;

export interface AssignDealOwnerInput {
  readonly workspaceId: string;
  readonly dealId: string;
  /** Novo responsável; `null` tira o responsável. */
  readonly ownerId: string | null;
  readonly actor: DealActor;
  readonly metadata?: DealMoveMetadata;
}

export interface AssignDealOwnerResult {
  readonly deal: DealRow;
  readonly fromOwnerId: string | null;
  readonly toOwnerId: string | null;
  /** `false` = já era esse responsável (nada gravado). */
  readonly changed: boolean;
}

/**
 * Troca o responsável. `null` = negócio inexistente/invisível sob RLS. Responsável de outro
 * workspace (ou inexistente) lança `TenantRefError` (a rota responde 422).
 */
export async function assignDealOwner(
  tx: DbTx,
  input: AssignDealOwnerInput,
): Promise<AssignDealOwnerResult | null> {
  const [current] = await tx
    .select()
    .from(deals)
    .where(eq(deals.id, input.dealId))
    .limit(1)
    .for('update');
  if (!current) return null;
  await requireRefsInWorkspace(tx, [{ kind: 'member', id: input.ownerId, field: 'ownerId' }]);
  if (current.ownerId === input.ownerId) {
    return {
      deal: current,
      fromOwnerId: current.ownerId,
      toOwnerId: input.ownerId,
      changed: false,
    };
  }
  const [updated] = await tx
    .update(deals)
    .set({ ownerId: input.ownerId, updatedAt: new Date() })
    .where(eq(deals.id, input.dealId))
    .returning();
  if (!updated) return null;
  await tx.insert(dealHistory).values({
    dealId: input.dealId,
    workspaceId: input.workspaceId,
    eventType: 'owner_changed',
    fromValue: { ownerId: current.ownerId },
    toValue: { ownerId: input.ownerId },
    actorMemberId: input.actor.memberId ?? null,
    actorType: input.actor.type,
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  });
  return { deal: updated, fromOwnerId: current.ownerId, toOwnerId: input.ownerId, changed: true };
}
