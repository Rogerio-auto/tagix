/**
 * Onboarding por nicho (gap-fill F5-S15). POST /api/onboarding/niche cria, sob
 * RLS, o pipeline do template do nicho (+ stages/custom_fields) e, opcionalmente,
 * um agente a partir do agent_template do nicho. Reusa as DEFINICOES de seed
 * (PIPELINE_TEMPLATES) — fonte unica com packages/db/src/seed.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hm/db';
import { PIPELINE_TEMPLATES } from '@hm/db/seed/pipeline_templates';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { pipelines, stages, agents, agentTemplates } = schema;

const NICHE_AGENT_TEMPLATE_KEY: Record<string, string> = {
  real_estate: 'sales_real_estate',
  clinic: 'support_clinic',
};

const bodySchema = z.object({
  niche: z.enum(['real_estate', 'clinic']),
  createAgent: z.boolean().default(true),
});

export function createOnboardingRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('pipeline.edit')] as const;

  router.post('/api/onboarding/niche', ...guard, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const { niche, createAgent } = parsed.data;
    const tpl = PIPELINE_TEMPLATES.find((t) => t.key === niche);
    if (!tpl) {
      res.status(404).json({ error: 'niche_not_found' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;

    const result = await req.scoped!(async (tx) => {
      // Pipeline (idempotente por workspace+name).
      const [existing] = await tx
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.workspaceId, workspaceId), eq(pipelines.name, tpl.name)))
        .limit(1);
      let pipelineId = existing?.id;
      if (!pipelineId) {
        const [created] = await tx
          .insert(pipelines)
          .values({
            workspaceId,
            name: tpl.name,
            description: tpl.description,
            industry: tpl.industry,
            settings: { custom_fields: tpl.customFields },
          })
          .returning({ id: pipelines.id });
        pipelineId = created!.id;
        for (const s of tpl.stages) {
          await tx.insert(stages).values({
            workspaceId,
            pipelineId,
            name: s.name,
            color: s.color,
            position: s.position,
            isWon: s.isWon ?? false,
            isLost: s.isLost ?? false,
            probability: s.probability == null ? null : String(s.probability),
          });
        }
      }

      // Agente (opcional) a partir do agent_template do nicho.
      let agentId: string | null = null;
      if (createAgent) {
        const key = NICHE_AGENT_TEMPLATE_KEY[niche];
        const [at] = await tx
          .select()
          .from(agentTemplates)
          .where(eq(agentTemplates.key, key!))
          .limit(1);
        if (at) {
          const [agent] = await tx
            .insert(agents)
            .values({
              workspaceId,
              templateId: at.id,
              name: at.name,
              description: at.description,
              systemPrompt: at.promptTemplate,
              model: at.defaultModel,
              modelParams: at.defaultModelParams,
            })
            .returning({ id: agents.id });
          agentId = agent?.id ?? null;
        }
      }

      return { pipelineId, agentId };
    });

    res.status(201).json(result);
  });

  return router;
}
