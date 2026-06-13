/**
 * API de plataforma — editor de `workspace_agent_policies` por workspace (F25-S03).
 *
 *   GET /api/platform/workspaces                                lista (seletor)
 *   GET /api/platform/workspaces/:workspaceId/agent-policy      lê (cria default se ausente)
 *   PUT /api/platform/workspaces/:workspaceId/agent-policy      atualiza campos validados
 *
 * Cross-workspace pela plataforma → sem RLS de tenant: roda sob `getDb()` (owner) e
 * filtra pelo `workspaceId` do path explicitamente. Gated por `requirePlatformAdmin`.
 * Cada PUT registra `updated_by` + audit_logs. Wire em app.ts é do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';

const { workspaces, workspaceAgentPolicies, llmModelsWhitelist, auditLogs } = schema;

const nonNegInt = z.number().int().min(0);

const putSchema = z
  .object({
    allowedModels: z.array(z.string().trim().min(1)).max(200).optional(),
    defaultChatModel: z.string().trim().min(1).nullable().optional(),
    allowStreaming: z.boolean().optional(),
    allowInterrupts: z.boolean().optional(),
    allowParallelTools: z.boolean().optional(),
    allowVision: z.boolean().optional(),
    allowTranscription: z.boolean().optional(),
    allowPersistentCheckpoints: z.boolean().optional(),
    allowAgentConversions: z.boolean().optional(),
    agentConversionRequireApproval: z.boolean().optional(),
    maxIterations: nonNegInt.optional(),
    maxToolsPerAgent: nonNegInt.optional(),
    maxTokensPerCall: nonNegInt.optional(),
    maxMonthlyCostUsd: z.number().min(0).nullable().optional(),
    maxDailyInvocations: nonNegInt.nullable().optional(),
    allowedToolCategories: z
      .array(z.enum(['database', 'http', 'workflow', 'calendar', 'knowledge']))
      .max(5)
      .optional(),
  })
  .strict();

function serialize(p: typeof workspaceAgentPolicies.$inferSelect) {
  return {
    workspaceId: p.workspaceId,
    allowedModels: p.allowedModels,
    defaultChatModel: p.defaultChatModel,
    allowStreaming: p.allowStreaming,
    allowInterrupts: p.allowInterrupts,
    allowParallelTools: p.allowParallelTools,
    allowVision: p.allowVision,
    allowTranscription: p.allowTranscription,
    allowPersistentCheckpoints: p.allowPersistentCheckpoints,
    allowAgentConversions: p.allowAgentConversions,
    agentConversionRequireApproval: p.agentConversionRequireApproval,
    maxIterations: p.maxIterations,
    maxToolsPerAgent: p.maxToolsPerAgent,
    maxTokensPerCall: p.maxTokensPerCall,
    maxMonthlyCostUsd: p.maxMonthlyCostUsd === null ? null : Number(p.maxMonthlyCostUsd),
    maxDailyInvocations: p.maxDailyInvocations,
    allowedToolCategories: p.allowedToolCategories,
    updatedBy: p.updatedBy,
    updatedAt: p.updatedAt,
  };
}

export function createPlatformPoliciesRouter(): Router {
  const router = Router();
  const db = getDb();

  router.get('/api/platform/workspaces', ...requirePlatformAdmin, async (_req, res: Response) => {
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .orderBy(asc(workspaces.name));
    res.json({ workspaces: rows });
  });

  router.get(
    '/api/platform/workspaces/:workspaceId/agent-policy',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const wid = z.string().uuid().safeParse(req.params['workspaceId']);
      if (!wid.success) {
        res.status(400).json({ error: 'invalid_workspace_id' });
        return;
      }
      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wid.data));
      if (!ws) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }
      let [policy] = await db
        .select()
        .from(workspaceAgentPolicies)
        .where(eq(workspaceAgentPolicies.workspaceId, wid.data));
      if (!policy) {
        [policy] = await db
          .insert(workspaceAgentPolicies)
          .values({ workspaceId: wid.data })
          .returning();
      }
      res.json({ policy: serialize(policy!) });
    },
  );

  router.put(
    '/api/platform/workspaces/:workspaceId/agent-policy',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const wid = z.string().uuid().safeParse(req.params['workspaceId']);
      if (!wid.success) {
        res.status(400).json({ error: 'invalid_workspace_id' });
        return;
      }
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const body = parsed.data;

      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, wid.data));
      if (!ws) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }

      // Validação de modelos: allowed_models ⊆ whitelist ATIVA; default ∈ allowed.
      const nextAllowed = body.allowedModels;
      if (nextAllowed && nextAllowed.length > 0) {
        const active = await db
          .select({ slug: llmModelsWhitelist.slug })
          .from(llmModelsWhitelist)
          .where(
            and(eq(llmModelsWhitelist.isActive, true), inArray(llmModelsWhitelist.slug, nextAllowed)),
          );
        const activeSet = new Set(active.map((m) => m.slug));
        const unknown = nextAllowed.filter((s) => !activeSet.has(s));
        if (unknown.length > 0) {
          res.status(400).json({ error: 'models_not_in_active_whitelist', unknown });
          return;
        }
      }
      if (
        body.defaultChatModel &&
        nextAllowed &&
        nextAllowed.length > 0 &&
        !nextAllowed.includes(body.defaultChatModel)
      ) {
        res.status(400).json({ error: 'default_model_not_allowed' });
        return;
      }

      const updatedBy = req.auth!.member.id;
      const now = new Date();
      const set: Partial<typeof workspaceAgentPolicies.$inferInsert> = {
        ...body,
        maxMonthlyCostUsd:
          body.maxMonthlyCostUsd === undefined
            ? undefined
            : body.maxMonthlyCostUsd === null
              ? null
              : body.maxMonthlyCostUsd.toFixed(2),
        updatedBy,
        updatedAt: now,
      };

      const [policy] = await db
        .insert(workspaceAgentPolicies)
        .values({ workspaceId: wid.data, ...set })
        .onConflictDoUpdate({ target: workspaceAgentPolicies.workspaceId, set })
        .returning();

      await db.insert(auditLogs).values({
        workspaceId: wid.data,
        actorMemberId: updatedBy,
        actorType: 'platform_admin',
        action: 'platform.agent_policy_updated',
        resourceType: 'workspace_agent_policy',
        resourceId: wid.data,
        metadata: { fields: Object.keys(body) },
      });

      res.json({ policy: serialize(policy!) });
    },
  );

  return router;
}
