/**
 * Repositório de assinaturas de Web Push (F61-S03).
 *
 * Todas as funções recebem `tx` e rodam sob RLS — o isolamento por workspace é da
 * política no banco, não de um `where` que alguém pode esquecer.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbTx } from '../client';
import { pushSubscriptions, type PushSubscriptionRow } from '../schema/push';

/** O que o navegador entrega em `PushSubscription.toJSON()`. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly label?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Registra ou atualiza a assinatura deste aparelho.
 *
 * `onConflictDoUpdate` no `endpoint` porque o navegador **rotaciona as chaves**
 * periodicamente mantendo o mesmo endpoint: tratar isso como inserção nova daria
 * violação de unicidade, e tratar como "já existe, ignora" deixaria a linha com
 * chaves velhas — e uma chave velha faz o envio falhar silenciosamente, que é a
 * pior forma de falhar num canal de aviso.
 *
 * O `failure_count` zera: se o aparelho está reassinando, ele está vivo.
 */
export async function upsertSubscription(
  tx: DbTx,
  input: PushSubscriptionInput & { workspaceId: string; memberId: string },
): Promise<PushSubscriptionRow> {
  const [row] = await tx
    .insert(pushSubscriptions)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // O aparelho pode ter trocado de dono (mesmo celular, outro login).
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        userAgent: input.userAgent ?? null,
        failureCount: 0,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (row === undefined) {
    throw new Error('push: assinatura não materializou após upsert.');
  }
  return row;
}

/** Assinaturas vivas de um membro — o hot path do envio. */
export async function listForMember(
  tx: DbTx,
  input: { workspaceId: string; memberId: string },
): Promise<PushSubscriptionRow[]> {
  return tx
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.workspaceId, input.workspaceId),
        eq(pushSubscriptions.memberId, input.memberId),
      ),
    );
}

/**
 * Remove uma assinatura pelo endpoint.
 *
 * Usado tanto pelo cancelamento explícito quanto pela limpeza automática de
 * endpoint morto (404/410 do provedor).
 */
export async function removeByEndpoint(tx: DbTx, endpoint: string): Promise<void> {
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Marca envio bem-sucedido: carimba o uso e zera as falhas ambíguas. */
export async function markUsed(tx: DbTx, endpoint: string): Promise<void> {
  await tx
    .update(pushSubscriptions)
    .set({ lastUsedAt: new Date(), failureCount: 0, updatedAt: new Date() })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * Falha ambígua (rede, 5xx): incrementa sem apagar.
 *
 * Um serviço de push fora do ar por dez minutos não pode custar a base de
 * assinaturas do cliente. Só o provedor dizendo `404`/`410` — "este endereço não
 * existe" — justifica apagar.
 */
export async function markFailure(tx: DbTx, endpoint: string): Promise<void> {
  await tx
    .update(pushSubscriptions)
    .set({
      failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * Fachada do repositório, no mesmo padrão dos demais (`consentRepo`,
 * `calendarRepo`): um objeto só, para o chamador não importar seis nomes soltos.
 */
export const pushRepo = {
  upsertSubscription,
  listForMember,
  removeByEndpoint,
  markUsed,
  markFailure,
} as const;
