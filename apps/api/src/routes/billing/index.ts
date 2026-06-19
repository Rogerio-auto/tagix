/**
 * Billing self-serve do tenant (PAYMENTS_ABACATEPAY.md §5/§9).
 *
 * Rotas de produto, dentro do `withWorkspace`, para o workspace assinar/trocar
 * de plano via CHECKOUT HOSPEDADO (CARD+PIX), consultar a assinatura e cancelar.
 *
 *   POST /api/billing/checkout      inicia checkout hospedado  (billing.change_plan, OWNER)
 *   GET  /api/billing/subscription  estado atual + histórico   (billing.view, ADMINS)
 *   POST /api/billing/cancel        cancela / agenda corte     (billing.cancel, OWNER)
 *
 * SEGURANÇA (§9):
 * - Preço/plano são SEMPRE reconferidos server-side: o cliente só manda `planId`,
 *   `cycle` e `method`. O valor cobrado vem do catálogo `plans`, nunca do body.
 * - Tudo escopado por workspace (RLS via `req.scoped`). Inputs validados com Zod.
 * - O webhook HMAC (F41-S03) é a fonte da verdade do pagamento; aqui só INICIAMOS
 *   o fluxo e gravamos o "intent" (provider/customer/product/method) na subscription.
 * - A API key do gateway nunca é tocada aqui — fica dentro do provider.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type {
  BillingCycle,
  PaymentMethod,
  PaymentWorkspaceInput,
} from '@hm/payments';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { getPaymentProvider } from '../../services/billing/provider';
import { ensurePlanProduct, type PlanRow } from '../../services/billing/plan-sync';

const { plans, subscriptions, paymentEvents } = schema;

const PROVIDER_TAG = 'abacatepay';

/** Métodos liberados no checkout hospedado (§5). */
const HOSTED_METHODS: readonly PaymentMethod[] = ['card', 'pix'] as const;

const checkoutSchema = z
  .object({
    planId: z.string().uuid(),
    cycle: z.enum(['monthly', 'yearly']),
    method: z.enum(['card', 'pix']),
  })
  .strict();

/** Base pública do app (web) para montar return/completion URLs do checkout. */
function appBaseUrl(): string {
  return process.env['APP_PUBLIC_URL'] ?? process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';
}

/** Projeta a row de plano (catálogo de plataforma) para o subset do sync. */
function toPlanRow(row: typeof plans.$inferSelect): PlanRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceMonthlyCents: row.priceMonthlyCents,
    priceYearlyCents: row.priceYearlyCents,
    paymentProviderProductId: row.paymentProviderProductId,
  };
}

/** Preço server-side do plano para o ciclo. NUNCA vem do cliente. */
function priceForCycle(row: PlanRow, cycle: BillingCycle): number {
  if (cycle === 'yearly') {
    return row.priceYearlyCents > 0 ? row.priceYearlyCents : row.priceMonthlyCents * 12;
  }
  return row.priceMonthlyCents;
}

export function createBillingRouter(): Router {
  const router = Router();

  // ── POST /api/billing/checkout ────────────────────────────────────────────
  router.post(
    '/api/billing/checkout',
    requireAuth,
    withRLS,
    requireRole('billing.change_plan'),
    async (req: Request, res: Response) => {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const { planId, cycle, method } = parsed.data;
      const workspace = req.auth!.workspace;
      const billingEmail = req.auth!.member.email;

      // Plano vem do catálogo de plataforma (não-RLS) → preço/identidade server-side.
      const [planRowRaw] = await getDb()
        .select()
        .from(plans)
        .where(eq(plans.id, planId))
        .limit(1);
      if (!planRowRaw || !planRowRaw.isActive) {
        res.status(404).json({ error: 'plan_not_found' });
        return;
      }
      const planRow = toPlanRow(planRowRaw);
      const amountCents = priceForCycle(planRow, cycle);
      if (amountCents <= 0) {
        res.status(422).json({ error: 'plan_not_billable' });
        return;
      }

      const provider = getPaymentProvider();

      // Garante product (idempotente; grava plans.payment_provider_product_id) e customer.
      const externalProductId = await ensurePlanProduct(provider, planRow);

      const workspaceInput: PaymentWorkspaceInput = {
        id: workspace.id,
        name: workspace.name,
        billingEmail,
      };
      const customer = await provider.ensureCustomer(workspaceInput);

      const checkout = await provider.createHostedCheckout({
        plan: {
          id: planRow.id,
          name: planRow.name,
          priceMonthlyCents: planRow.priceMonthlyCents,
          priceYearlyCents: planRow.priceYearlyCents > 0 ? planRow.priceYearlyCents : undefined,
          description: planRow.description ?? undefined,
          externalProductId,
        },
        workspace: { ...workspaceInput, externalCustomerId: customer.externalCustomerId },
        cycle,
        methods: HOSTED_METHODS,
        // metadata/externalId carregam workspaceId+planId via as URLs de retorno.
        returnUrl: `${appBaseUrl()}/settings/billing?status=return&workspace=${workspace.id}&plan=${planRow.id}`,
        completionUrl: `${appBaseUrl()}/settings/billing?status=completed&workspace=${workspace.id}&plan=${planRow.id}`,
      });

      // Grava o INTENT na subscription (escopo RLS). O webhook (S03) confirma e
      // transiciona o status; aqui só registramos provider/customer/product/método.
      await req.scoped!((tx) =>
        tx
          .insert(subscriptions)
          .values({
            workspaceId: workspace.id,
            planId: planRow.id,
            billingCycle: cycle,
            paymentProvider: PROVIDER_TAG,
            externalCustomerId: customer.externalCustomerId,
            externalProductId,
            paymentMethod: method,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: subscriptions.workspaceId,
            set: {
              planId: planRow.id,
              billingCycle: cycle,
              paymentProvider: PROVIDER_TAG,
              externalCustomerId: customer.externalCustomerId,
              externalProductId,
              paymentMethod: method,
              updatedAt: new Date(),
            },
          }),
      );

      res.status(201).json({ redirectUrl: checkout.redirectUrl });
    },
  );

  // ── GET /api/billing/subscription ─────────────────────────────────────────
  router.get(
    '/api/billing/subscription',
    requireAuth,
    withRLS,
    requireRole('billing.view'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;

      const result = await req.scoped!(async (tx) => {
        const [sub] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.workspaceId, workspaceId))
          .limit(1);

        let plan: typeof plans.$inferSelect | undefined;
        if (sub) {
          [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
        }

        // Histórico de pagamentos do tenant (billing portal). Roda sob o tx
        // escopado (RLS) — o filtro explícito por workspace é o suspensório.
        const events = await tx
          .select()
          .from(paymentEvents)
          .where(eq(paymentEvents.workspaceId, workspaceId))
          .orderBy(desc(paymentEvents.receivedAt))
          .limit(50);
        return { sub, plan, events };
      });

      const { sub, plan, events } = result;

      res.json({
        subscription: sub
          ? {
              status: sub.status,
              billingCycle: sub.billingCycle,
              paymentProvider: sub.paymentProvider,
              paymentMethod: sub.paymentMethod,
              currentPeriodStart: sub.currentPeriodStart,
              currentPeriodEnd: sub.currentPeriodEnd,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              canceledAt: sub.canceledAt,
              plan: plan
                ? {
                    id: plan.id,
                    key: plan.key,
                    name: plan.name,
                    priceMonthlyCents: plan.priceMonthlyCents,
                    priceYearlyCents: plan.priceYearlyCents,
                  }
                : null,
            }
          : null,
        history: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          status: e.status,
          amountCents: e.amountCents,
          receivedAt: e.receivedAt,
          processedAt: e.processedAt,
        })),
      });
    },
  );

  // ── GET /api/billing/plans ────────────────────────────────────────────────
  // Catálogo de planos voltado ao tenant (self-serve). O `/api/platform/plans` é
  // gated por platform-admin; este expõe o subset público (preço/identidade) para
  // o billing portal. Catálogo é platform-level (não-RLS) → `getDb()`.
  router.get(
    '/api/billing/plans',
    requireAuth,
    withRLS,
    requireRole('billing.view'),
    async (_req: Request, res: Response) => {
      const rows = await getDb()
        .select({
          id: plans.id,
          key: plans.key,
          name: plans.name,
          priceMonthlyCents: plans.priceMonthlyCents,
          priceYearlyCents: plans.priceYearlyCents,
        })
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.position));
      res.json({ plans: rows });
    },
  );

  // ── POST /api/billing/cancel ──────────────────────────────────────────────
  router.post(
    '/api/billing/cancel',
    requireAuth,
    withRLS,
    requireRole('billing.cancel'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;

      const [sub] = await req.scoped!((tx) =>
        tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.workspaceId, workspaceId))
          .limit(1),
      );
      if (!sub) {
        res.status(404).json({ error: 'subscription_not_found' });
        return;
      }

      // Cartão: cancela no gateway (recorrência nativa). PIX: sem débito automático,
      // só marca para cortar no fim do ciclo — o webhook/worker (S03/S05) finaliza.
      if (sub.paymentMethod === 'card' && sub.externalSubscriptionId) {
        const provider = getPaymentProvider();
        await provider.cancelSubscription(sub.externalSubscriptionId);
        await req.scoped!((tx) =>
          tx
            .update(subscriptions)
            .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
            .where(eq(subscriptions.workspaceId, workspaceId)),
        );
        res.json({ canceled: true, method: 'card', effective: 'period_end' });
        return;
      }

      await req.scoped!((tx) =>
        tx
          .update(subscriptions)
          .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
          .where(eq(subscriptions.workspaceId, workspaceId)),
      );
      res.json({ canceled: true, method: sub.paymentMethod ?? 'pix', effective: 'period_end' });
    },
  );

  return router;
}

export { getPaymentProvider } from '../../services/billing/provider';
