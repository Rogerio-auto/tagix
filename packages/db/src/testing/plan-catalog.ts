import { getDb } from '../client';
import { plans } from '../schema';

/**
 * Catálogo mínimo usado por testes que exercitam provisionamento e billing.
 *
 * Cada suíte chama este helper no próprio setup para não depender de `pnpm seed`
 * nem da ordem em que os packages forem executados. O upsert é intencionalmente
 * idempotente: o catálogo é global e pode ser preparado por mais de uma suíte.
 */
export const TEST_PLAN_CATALOG: (typeof plans.$inferInsert)[] = [
  { key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0 },
  { key: 'starter', name: 'Starter', position: 1, priceMonthlyCents: 9900 },
  { key: 'pro', name: 'Pro', position: 2, priceMonthlyCents: 29900 },
  { key: 'business', name: 'Business', position: 3, priceMonthlyCents: 99900 },
];

export async function ensureTestPlanCatalog(): Promise<void> {
  const db = getDb();
  await db.insert(plans).values(TEST_PLAN_CATALOG).onConflictDoNothing({ target: plans.key });
}
