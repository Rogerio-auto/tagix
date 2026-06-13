/**
 * API de plataforma — catálogo global de modelos LLM (F25-S02).
 *
 *   GET   /api/platform/models            lista a whitelist (todas as colunas)
 *   PATCH /api/platform/models/:id        is_active | default_plan_keys | notes
 *   POST  /api/platform/models/sync       sync OpenRouter /models (upsert por slug)
 *
 * GLOBAL (sem workspace) → roda sob `getDb()` (owner, sem RLS de tenant). Gated por
 * `requirePlatformAdmin` (F25-S01). Wire em app.ts é do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { syncOpenRouterModels } from '../../services/platform/openrouter-models';

const { llmModelsWhitelist } = schema;

const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    defaultPlanKeys: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nada para atualizar.' });

/** numeric volta como string no driver; expomos number|null ao cliente. */
function serialize(m: typeof llmModelsWhitelist.$inferSelect) {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    upstreamProvider: m.upstreamProvider,
    contextLength: m.contextLength,
    supportsTools: m.supportsTools,
    supportsVision: m.supportsVision,
    supportsStreaming: m.supportsStreaming,
    pricingPromptPer1m: m.pricingPromptPer1m === null ? null : Number(m.pricingPromptPer1m),
    pricingCompletionPer1m:
      m.pricingCompletionPer1m === null ? null : Number(m.pricingCompletionPer1m),
    isActive: m.isActive,
    defaultPlanKeys: m.defaultPlanKeys,
    notes: m.notes,
    syncedAt: m.syncedAt,
  };
}

export function createPlatformModelsRouter(): Router {
  const router = Router();
  const db = getDb();

  router.get('/api/platform/models', ...requirePlatformAdmin, async (_req, res: Response) => {
    const rows = await db
      .select()
      .from(llmModelsWhitelist)
      .orderBy(asc(llmModelsWhitelist.slug));
    res.json({ models: rows.map(serialize) });
  });

  router.patch(
    '/api/platform/models/:id',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = z.string().uuid().safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const [updated] = await db
        .update(llmModelsWhitelist)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(llmModelsWhitelist.id, id.data))
        .returning();
      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ model: serialize(updated) });
    },
  );

  router.post(
    '/api/platform/models/sync',
    ...requirePlatformAdmin,
    async (_req: Request, res: Response) => {
      try {
        const result = await syncOpenRouterModels({ db });
        res.json(result);
      } catch (err) {
        if (err instanceof Error && err.message === 'OPENROUTER_KEY_MISSING') {
          res.status(409).json({
            error: 'openrouter_key_missing',
            message: 'Configure a API key da OpenRouter em Secrets antes de sincronizar.',
          });
          return;
        }
        res.status(502).json({
          error: 'openrouter_sync_failed',
          message: 'Falha ao sincronizar com a OpenRouter.',
        });
      }
    },
  );

  return router;
}
