/**
 * API de plataforma -- catalogo comercial de planos (F26-S03).
 *
 *   GET    /api/platform/plans         lista (inclui inativos; ordena por position)
 *   POST   /api/platform/plans         cria
 *   PATCH  /api/platform/plans/:id     edita (parcial)
 *   DELETE /api/platform/plans/:id     soft-delete (is_active=false)
 *
 * Gestao INTERNA (BILLING_ENABLED=false): campos stripe_* sao editaveis mas opcionais
 * e NENHUMA chamada Stripe e feita. Os limits/features sao TIPADOS (chaves conhecidas),
 * fonte da verdade do catalogo de entitlements -- F26-S04 (resolveEntitlements) reusa
 * os schemas exportados aqui. Cross-workspace como owner; gated por requirePlatformAdmin;
 * toda mutacao em audit_logs. Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';

const { plans, auditLogs } = schema;

/**
 * unique_violation (Postgres 23505). O drizzle envolve o erro do driver num
 * DrizzleQueryError, expondo o erro original em `cause` -- checamos ambos os niveis.
 */
function isUniqueViolation(err: unknown): boolean {
  const direct = (err as { code?: string } | null)?.code;
  const cause = (err as { cause?: { code?: string } } | null)?.cause?.code;
  return direct === '23505' || cause === '23505';
}

// ─── Contrato TIPADO de limits/features (reusado pela F26-S04) ────────────────
/** Limites numericos conhecidos do catalogo (nao-IA). */
export const LIMIT_KEYS = [
  'max_agents',
  'max_channels',
  'max_members',
  'max_monthly_messages',
  'max_flows',
  'max_knowledge_documents',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Flags de feature conhecidas do catalogo (nao-IA). */
export const FEATURE_KEYS = [
  'instagram',
  'flows',
  'api_access',
  'campaigns',
  'calendar',
  'knowledge_base',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Limits tipados: so chaves conhecidas, valores inteiros >= 0. Rejeita chave desconhecida. */
export const planLimitsSchema = z
  .object(
    Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).optional()])) as Record<
      LimitKey,
      z.ZodOptional<z.ZodNumber>
    >,
  )
  .strict();

/** Features tipadas: so chaves conhecidas, booleanas. Rejeita chave desconhecida. */
export const planFeaturesSchema = z
  .object(
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      FeatureKey,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .strict();

export type PlanLimits = z.infer<typeof planLimitsSchema>;
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

const createSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_-]+$/, 'key deve ser slug minusculo (a-z0-9_-)'),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    priceMonthlyCents: z.number().int().min(0).default(0),
    priceYearlyCents: z.number().int().min(0).default(0),
    limits: planLimitsSchema.default({}),
    features: planFeaturesSchema.default({}),
    stripeProductId: z.string().trim().max(120).nullable().optional(),
    stripeMonthlyPriceId: z.string().trim().max(120).nullable().optional(),
    stripeYearlyPriceId: z.string().trim().max(120).nullable().optional(),
    isActive: z.boolean().default(true),
    position: z.number().int().min(0).default(0),
  })
  .strict();

const patchSchema = createSchema.partial().strict();

const idParam = z.string().uuid();

function serialize(p: typeof plans.$inferSelect) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    priceMonthlyCents: p.priceMonthlyCents,
    priceYearlyCents: p.priceYearlyCents,
    limits: p.limits,
    features: p.features,
    stripeProductId: p.stripeProductId,
    stripeMonthlyPriceId: p.stripeMonthlyPriceId,
    stripeYearlyPriceId: p.stripeYearlyPriceId,
    isActive: p.isActive,
    position: p.position,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Audit best-effort de uma mutacao de plano (actor = platform_admin). */
async function audit(
  req: Request,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const member = req.auth?.member;
  try {
    await getDb()
      .insert(auditLogs)
      .values({
        workspaceId: member?.workspaceId ?? null,
        actorMemberId: member?.id ?? null,
        actorType: 'platform_admin',
        action,
        resourceType: 'plan',
        resourceId,
        metadata,
      });
  } catch {
    // Auditoria nunca derruba o fluxo.
  }
}

export function createPlatformPlansRouter(): Router {
  const router = Router();
  const db = getDb();

  router.get('/api/platform/plans', ...requirePlatformAdmin, async (_req: Request, res: Response) => {
    const rows = await db.select().from(plans).orderBy(asc(plans.position), asc(plans.name));
    res.json({ plans: rows.map(serialize) });
  });

  router.post('/api/platform/plans', ...requirePlatformAdmin, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    try {
      const [row] = await db
        .insert(plans)
        .values({
          key: d.key,
          name: d.name,
          description: d.description ?? null,
          priceMonthlyCents: d.priceMonthlyCents,
          priceYearlyCents: d.priceYearlyCents,
          limits: d.limits as Record<string, number>,
          features: d.features as Record<string, boolean>,
          stripeProductId: d.stripeProductId ?? null,
          stripeMonthlyPriceId: d.stripeMonthlyPriceId ?? null,
          stripeYearlyPriceId: d.stripeYearlyPriceId ?? null,
          isActive: d.isActive,
          position: d.position,
        })
        .returning();
      if (!row) throw new Error('insert failed');
      await audit(req, 'plan.created', row.id, { key: row.key, name: row.name });
      res.status(201).json({ plan: serialize(row) });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: 'plan_key_conflict' });
        return;
      }
      throw err;
    }
  });

  router.patch(
    '/api/platform/plans/:id',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const d = parsed.data;
      const patch: Record<string, unknown> = {};
      if (d.key !== undefined) patch['key'] = d.key;
      if (d.name !== undefined) patch['name'] = d.name;
      if (d.description !== undefined) patch['description'] = d.description;
      if (d.priceMonthlyCents !== undefined) patch['priceMonthlyCents'] = d.priceMonthlyCents;
      if (d.priceYearlyCents !== undefined) patch['priceYearlyCents'] = d.priceYearlyCents;
      if (d.limits !== undefined) patch['limits'] = d.limits;
      if (d.features !== undefined) patch['features'] = d.features;
      if (d.stripeProductId !== undefined) patch['stripeProductId'] = d.stripeProductId;
      if (d.stripeMonthlyPriceId !== undefined)
        patch['stripeMonthlyPriceId'] = d.stripeMonthlyPriceId;
      if (d.stripeYearlyPriceId !== undefined) patch['stripeYearlyPriceId'] = d.stripeYearlyPriceId;
      if (d.isActive !== undefined) patch['isActive'] = d.isActive;
      if (d.position !== undefined) patch['position'] = d.position;
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: 'empty_patch' });
        return;
      }
      const [row] = await db.update(plans).set(patch).where(eq(plans.id, id.data)).returning();
      if (!row) {
        res.status(404).json({ error: 'plan_not_found' });
        return;
      }
      await audit(req, 'plan.updated', row.id, { fields: Object.keys(patch) });
      res.json({ plan: serialize(row) });
    },
  );

  router.delete(
    '/api/platform/plans/:id',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      // Soft-delete: nunca remove a linha (subscriptions referenciam plan_id).
      const [row] = await db
        .update(plans)
        .set({ isActive: false })
        .where(eq(plans.id, id.data))
        .returning();
      if (!row) {
        res.status(404).json({ error: 'plan_not_found' });
        return;
      }
      await audit(req, 'plan.deactivated', row.id, { key: row.key });
      res.json({ plan: serialize(row) });
    },
  );

  return router;
}
