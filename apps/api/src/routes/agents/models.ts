/**
 * Catálogo de modelos LLM para o wizard de criação de agentes (F2-S17).
 *
 * `GET /api/agents/models` devolve a whitelist global (`llm_models_whitelist`,
 * fora de RLS) com um flag `allowed` por modelo, derivado da policy do workspace
 * (`workspace_agent_policies.allowed_models` via `@hm/agents-core`). Lista vazia
 * de `allowedModels` na policy = sem restrição → todos `allowed: true`.
 *
 * Gap-fill de orquestração: o slot F2-S16 não cobriu este endpoint; o wizard
 * (F2-S17) foi codado contra este contrato.
 */
import { Router, type Request, type Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { resolvePolicy } from '@hm/agents-core';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

export function createAgentModelsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;

  router.get('/api/agents/models', ...viewGuard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;

    // Policy do workspace: se `allowedModels` é não-vazia, restringe o picker.
    const resolved = await resolvePolicy(workspaceId);
    const allowedModels = new Set(resolved.policy.allowedModels ?? []);
    const restrict = allowedModels.size > 0;

    const rows = await req.scoped!((tx) =>
      tx
        .select({
          slug: schema.llmModelsWhitelist.slug,
          displayName: schema.llmModelsWhitelist.displayName,
          provider: schema.llmModelsWhitelist.upstreamProvider,
          contextWindow: schema.llmModelsWhitelist.contextLength,
          promptUsd: schema.llmModelsWhitelist.pricingPromptPer1m,
          completionUsd: schema.llmModelsWhitelist.pricingCompletionPer1m,
          supportsTools: schema.llmModelsWhitelist.supportsTools,
          supportsVision: schema.llmModelsWhitelist.supportsVision,
        })
        .from(schema.llmModelsWhitelist)
        .where(eq(schema.llmModelsWhitelist.isActive, true))
        .orderBy(asc(schema.llmModelsWhitelist.slug)),
    );

    // `numeric` volta como string no driver; o cliente quer number|null.
    const models = rows.map((m) => ({
      slug: m.slug,
      displayName: m.displayName,
      provider: m.provider,
      contextWindow: m.contextWindow,
      promptUsd: m.promptUsd === null ? null : Number(m.promptUsd),
      completionUsd: m.completionUsd === null ? null : Number(m.completionUsd),
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
      allowed: !restrict || allowedModels.has(m.slug),
    }));

    res.json({ models });
  });

  return router;
}
