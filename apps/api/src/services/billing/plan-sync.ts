/**
 * Sync plano ↔ product do gateway (PAYMENTS_ABACATEPAY.md §3/§5).
 *
 * Garante (cria-ou-recupera) o `product` AbacatePay correspondente a um plano
 * Leadium e persiste o id em `plans.payment_provider_product_id`. Idempotente:
 * se a coluna já estiver preenchida, devolve direto; o provider também é
 * idempotente por `externalId = plan.id`, então uma corrida resulta no mesmo id.
 *
 * `plans` é catálogo de PLATAFORMA (não está em RLS_TABLES) → leitura/escrita via
 * `getDb()` (owner). Não há `workspace_id` aqui; o vínculo com o tenant acontece
 * na `subscription`, não no product.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { IPaymentProvider, PaymentPlanInput } from '@hm/payments';

const { plans } = schema;

/** Row mínima de plano necessária para o sync (subset de `plans`). */
export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMonthlyCents: number;
  readonly priceYearlyCents: number;
  readonly paymentProviderProductId: string | null;
}

/** Projeta uma row de `plans` para o input de domínio do provider. */
function toPaymentPlanInput(plan: PlanRow): PaymentPlanInput {
  return {
    id: plan.id,
    name: plan.name,
    priceMonthlyCents: plan.priceMonthlyCents,
    priceYearlyCents: plan.priceYearlyCents > 0 ? plan.priceYearlyCents : undefined,
    description: plan.description ?? undefined,
    externalProductId: plan.paymentProviderProductId ?? undefined,
  };
}

/**
 * Garante o product do gateway para um plano e devolve o `externalProductId`.
 *
 * - Se `plan.paymentProviderProductId` já existe → retorna sem tocar o gateway.
 * - Caso contrário chama `provider.ensureProduct(...)` e grava o id no `plans`.
 *
 * Idempotente e seguro para chamadas concorrentes (o id é estável por plano).
 */
export async function ensurePlanProduct(
  provider: IPaymentProvider,
  plan: PlanRow,
): Promise<string> {
  if (plan.paymentProviderProductId) return plan.paymentProviderProductId;

  const product = await provider.ensureProduct(toPaymentPlanInput(plan));

  await getDb()
    .update(plans)
    .set({ paymentProviderProductId: product.externalProductId })
    .where(eq(plans.id, plan.id));

  return product.externalProductId;
}
