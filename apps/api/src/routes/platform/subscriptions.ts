/**
 * API de plataforma -- assinatura por tenant + entitlement overrides (F26-S04, secao 5.2/5.3).
 *
 *   GET /api/platform/tenants/:id/subscription            plano+status+trial+override+efetivos
 *   PUT /api/platform/tenants/:id/subscription            troca plano/status/trial/cycle
 *   PUT /api/platform/tenants/:id/entitlement-overrides   limites/features override (custom plan)
 *
 * Gestao INTERNA (sem Stripe). Mantem workspaces.{plan_id,subscription_status,trial_ends_at}
 * e a linha em `subscriptions` coerentes. Toda mutacao com before/after em audit_logs +
 * updated_by. resolveEntitlements e a fonte unica dos efetivos. Cross-workspace como owner;
 * gated por requirePlatformAdmin. Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { entitlementOverridesRepo, getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { resolveEntitlements } from '../../services/platform/entitlements';
import { planFeaturesSchema, planLimitsSchema } from './plans';

const { workspaces, plans, subscriptions, auditLogs } = schema;

const STATUSES = ['trial', 'active', 'past_due', 'canceled', 'expired'] as const;
const CYCLES = ['monthly', 'yearly'] as const;

const idParam = z.string().uuid();

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

  return router;
}
