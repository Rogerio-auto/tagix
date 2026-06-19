/**
 * API de plataforma -- assinatura por tenant + entitlement overrides (F26-S04, secao 5.2/5.3).
 *
 *   GET  /api/platform/tenants/:id/subscription            plano+status+trial+override+efetivos
 *   PUT  /api/platform/tenants/:id/subscription            troca plano/status/trial/cycle
 *   PUT  /api/platform/tenants/:id/entitlement-overrides   limites/features override (custom plan)
 *   POST /api/platform/tenants/:id/billing/checkout        gera checkout HOSPEDADO (cobranca real)
 *
 * Gestao INTERNA (sem Stripe). Mantem workspaces.{plan_id,subscription_status,trial_ends_at}
 * e a linha em `subscriptions` coerentes. Toda mutacao com before/after em audit_logs +
 * updated_by. resolveEntitlements e a fonte unica dos efetivos. Cross-workspace como owner;
 * gated por requirePlatformAdmin. Wire em app.ts e do orchestrator.
 *
 * O fluxo ASSISTIDO (PAYMENTS_ABACATEPAY.md §7) reusa o MESMO provider do self-serve
 * (`getPaymentProvider()` do S04) — o super-admin so gera o link; quem transiciona o
 * status e sempre o webhook HMAC (S03). Preco/plano sao SEMPRE reconferidos server-side
 * (cliente nunca dita valor); a API key do gateway nunca e tocada/logada aqui.
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { entitlementOverridesRepo, getDb, schema } from '@hm/db';
import type { BillingCycle, PaymentMethod, PaymentWorkspaceInput } from '@hm/payments';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { resolveEntitlements } from '../../services/platform/entitlements';
import { getPaymentProvider } from '../../services/billing/provider';
import { ensurePlanProduct, type PlanRow } from '../../services/billing/plan-sync';
import { planFeaturesSchema, planLimitsSchema } from './plans';

const { workspaces, members, plans, subscriptions, auditLogs } = schema;

const STATUSES = ['trial', 'active', 'past_due', 'canceled', 'expired'] as const;
const CYCLES = ['monthly', 'yearly'] as const;

/** Tag do gateway gravada no intent da subscription (PAYMENTS_ABACATEPAY.md §2). */
const PROVIDER_TAG = 'abacatepay';

/** Metodos liberados no checkout hospedado (§5). */
const HOSTED_METHODS: readonly PaymentMethod[] = ['card', 'pix'] as const;

const idParam = z.string().uuid();

/** Body do checkout assistido — espelha o self-serve (§5/§7); preco vem do catalogo. */
const checkoutSchema = z
  .object({
    planId: z.string().uuid(),
    cycle: z.enum(CYCLES),
    method: z.enum(['card', 'pix']),
  })
  .strict();

/** Base publica do app (web) para montar return/completion URLs do checkout. */
function appBaseUrl(): string {
  return process.env['APP_PUBLIC_URL'] ?? process.env['CORS_ORIGIN'] ?? 'http://localhost:3000';
}

/** Projeta a row de plano (catalogo de plataforma) para o subset do sync. */
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

/** Preco server-side do plano para o ciclo. NUNCA vem do cliente. */
function priceForCycle(row: PlanRow, cycle: BillingCycle): number {
  if (cycle === 'yearly') {
    return row.priceYearlyCents > 0 ? row.priceYearlyCents : row.priceMonthlyCents * 12;
  }
  return row.priceMonthlyCents;
}

const putSubscriptionSchema = z
  .object({
    planId: z.string().uuid().nullable().optional(),
    status: z.enum(STATUSES).optional(),
    billingCycle: z.enum(CYCLES).optional(),
    trialEndsAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'empty_patch' });

const putOverridesSchema = z
  .object({
    limits: planLimitsSchema.default({}),
    features: planFeaturesSchema.default({}),
  })
  .strict();

async function audit(
  req: Request,
  action: string,
  workspaceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const member = req.auth?.member;
  try {
    await getDb()
      .insert(auditLogs)
      .values({
        workspaceId,
        actorMemberId: member?.id ?? null,
        actorType: 'platform_admin',
        action,
        resourceType: 'subscription',
        resourceId: workspaceId,
        metadata,
      });
  } catch {
    // best-effort
  }
}

export function createPlatformSubscriptionsRouter(): Router {
  const router = Router();
  const db = getDb();

  // ─── GET subscription (plano+status+trial+override+efetivos) ────────────────
  router.get(
    '/api/platform/tenants/:id/subscription',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const entitlements = await resolveEntitlements(id.data);
      if (!entitlements) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      const [ws] = await db
        .select({
          subscriptionStatus: workspaces.subscriptionStatus,
          trialEndsAt: workspaces.trialEndsAt,
          planId: workspaces.planId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, id.data))
        .limit(1);
      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, id.data))
        .limit(1);

      res.json({
        workspaceId: id.data,
        planId: ws?.planId ?? null,
        status: ws?.subscriptionStatus ?? 'trial',
        trialEndsAt: ws?.trialEndsAt ? ws.trialEndsAt.toISOString() : null,
        billingCycle: sub?.billingCycle ?? 'monthly',
        entitlements,
      });
    },
  );

  // ─── PUT subscription (troca plano/status/trial/cycle) ──────────────────────
  router.put(
    '/api/platform/tenants/:id/subscription',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = putSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const d = parsed.data;

      const [before] = await db
        .select({
          status: workspaces.subscriptionStatus,
          trialEndsAt: workspaces.trialEndsAt,
          planId: workspaces.planId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, id.data))
        .limit(1);
      if (!before) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }

      // Valida o plano alvo (se informado e nao-null) e que esta ativo.
      let targetPlanId = before.planId;
      if (d.planId !== undefined) {
        if (d.planId === null) {
          targetPlanId = null;
        } else {
          const [plan] = await db.select().from(plans).where(eq(plans.id, d.planId)).limit(1);
          if (!plan) {
            res.status(400).json({ error: 'plan_not_found' });
            return;
          }
          if (!plan.isActive) {
            res.status(400).json({ error: 'plan_inactive' });
            return;
          }
          targetPlanId = d.planId;
        }
      }

      const newStatus = d.status ?? before.status;
      const newTrial =
        d.trialEndsAt === undefined
          ? before.trialEndsAt
          : d.trialEndsAt === null
            ? null
            : new Date(d.trialEndsAt);

      // Atualiza workspaces (fonte da verdade do status/plano/trial).
      await db
        .update(workspaces)
        .set({
          planId: targetPlanId,
          subscriptionStatus: newStatus,
          trialEndsAt: newTrial,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, id.data));

      // Mantem a linha em subscriptions coerente (upsert) -- so quando ha plano.
      if (targetPlanId) {
        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.workspaceId, id.data))
          .limit(1);
        if (existing) {
          await db
            .update(subscriptions)
            .set({
              planId: targetPlanId,
              status: newStatus,
              billingCycle: d.billingCycle ?? existing.billingCycle,
              trialEndsAt: newTrial,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.workspaceId, id.data));
        } else {
          await db.insert(subscriptions).values({
            workspaceId: id.data,
            planId: targetPlanId,
            status: newStatus,
            billingCycle: d.billingCycle ?? 'monthly',
            trialEndsAt: newTrial,
          });
        }
      }

      await audit(req, 'subscription.updated', id.data, {
        before: { status: before.status, planId: before.planId },
        after: { status: newStatus, planId: targetPlanId, billingCycle: d.billingCycle },
      });

      const entitlements = await resolveEntitlements(id.data);
      res.json({
        workspaceId: id.data,
        planId: targetPlanId,
        status: newStatus,
        trialEndsAt: newTrial ? newTrial.toISOString() : null,
        billingCycle: d.billingCycle ?? 'monthly',
        entitlements,
      });
    },
  );

  // ─── PUT entitlement-overrides (custom plan: limites/features nao-IA) ───────
  router.put(
    '/api/platform/tenants/:id/entitlement-overrides',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = putOverridesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }

      // Workspace precisa existir.
      const [ws] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, id.data))
        .limit(1);
      if (!ws) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }

      const before = await entitlementOverridesRepo.findByWorkspace(db, id.data);
      await entitlementOverridesRepo.upsert(db, {
        workspaceId: id.data,
        limits: parsed.data.limits as Record<string, number>,
        features: parsed.data.features as Record<string, boolean>,
        updatedBy: req.auth?.member.id ?? null,
      });

      await audit(req, 'entitlement_override.updated', id.data, {
        before: { limits: before?.limits ?? {}, features: before?.features ?? {} },
        after: { limits: parsed.data.limits, features: parsed.data.features },
      });

      const entitlements = await resolveEntitlements(id.data);
      res.json({ workspaceId: id.data, entitlements });
    },
  );

  // ─── POST billing/checkout (cobranca real assistida — §7) ───────────────────
  router.post(
    '/api/platform/tenants/:id/billing/checkout',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const { planId, cycle, method } = parsed.data;

      // Tenant precisa existir (camada de plataforma é cross-workspace, sem RLS).
      const [ws] = await db
        .select({ id: workspaces.id, name: workspaces.name, planId: workspaces.planId })
        .from(workspaces)
        .where(eq(workspaces.id, id.data))
        .limit(1);
      if (!ws) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }

      // Plano vem do catálogo de plataforma → preço/identidade SEMPRE server-side.
      const [planRowRaw] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
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

      // E-mail de cobrança é do TENANT (não do super-admin): OWNER ativo, com
      // fallback para qualquer membro ativo. Sem membro faturável → 422.
      const billable = await db
        .select({ email: members.email, role: members.role })
        .from(members)
        .where(eq(members.workspaceId, id.data));
      const owner = billable.find((m) => m.role === 'OWNER' && !!m.email);
      const billingEmail = owner?.email ?? billable.find((m) => !!m.email)?.email;
      if (!billingEmail) {
        res.status(422).json({ error: 'no_billing_contact' });
        return;
      }

      // Reusa o MESMO provider do self-serve (mock em dev/teste, real com a key).
      const provider = getPaymentProvider();

      // Garante product (idempotente; grava plans.payment_provider_product_id) e customer.
      const externalProductId = await ensurePlanProduct(provider, planRow);

      const workspaceInput: PaymentWorkspaceInput = {
        id: ws.id,
        name: ws.name,
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
        returnUrl: `${appBaseUrl()}/settings/billing?status=return&workspace=${ws.id}&plan=${planRow.id}`,
        completionUrl: `${appBaseUrl()}/settings/billing?status=completed&workspace=${ws.id}&plan=${planRow.id}`,
      });

      // Grava o INTENT na subscription (sem RLS aqui — plataforma é owner). O webhook
      // (S03) confirma/transiciona o status; aqui só registramos provider/customer/método.
      const [existing] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, id.data))
        .limit(1);
      const before = existing
        ? {
            planId: existing.planId,
            billingCycle: existing.billingCycle,
            paymentMethod: existing.paymentMethod,
            externalCustomerId: existing.externalCustomerId,
          }
        : null;

      await db
        .insert(subscriptions)
        .values({
          workspaceId: id.data,
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
        });

      await audit(req, 'subscription.checkout_generated', id.data, {
        before,
        after: {
          planId: planRow.id,
          billingCycle: cycle,
          paymentMethod: method,
          provider: PROVIDER_TAG,
          externalCustomerId: customer.externalCustomerId,
          externalProductId,
          externalCheckoutId: checkout.externalId,
          amountCents,
        },
      });

      res.status(201).json({
        workspaceId: id.data,
        planId: planRow.id,
        cycle,
        method,
        amountCents,
        redirectUrl: checkout.redirectUrl,
      });
    },
  );

  return router;
}
