/**
 * Catálogo de templates de agente para o wizard de criação (F2-S17).
 *
 * `GET /api/agents/templates` devolve os templates visíveis ao workspace
 * (globais `workspace_id IS NULL` + do próprio tenant) com suas perguntas de
 * wizard (`agent_template_questions`) agrupadas e ordenadas por `position`.
 * `agent_templates`/`agent_template_questions` estão fora de RLS (catálogo
 * global) — o filtro global-vs-workspace é app-side.
 *
 * Gap-fill de orquestração: complementa o F2-S16; o wizard (F2-S17) consome este
 * contrato.
 */
import { Router, type Request, type Response } from 'express';
import { asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

interface TemplateQuestion {
  key: string;
  label: string;
  type: string;
  required: boolean;
  help: string | null;
  options: unknown[];
}

export function createAgentTemplatesRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;

  router.get('/api/agents/templates', ...viewGuard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;

    const templates = await req.scoped!(async (tx) => {
      const rows = await tx
        .select({
          id: schema.agentTemplates.id,
          key: schema.agentTemplates.key,
          name: schema.agentTemplates.name,
          category: schema.agentTemplates.category,
          description: schema.agentTemplates.description,
          defaultModel: schema.agentTemplates.defaultModel,
        })
        .from(schema.agentTemplates)
        .where(
          or(
            isNull(schema.agentTemplates.workspaceId),
            eq(schema.agentTemplates.workspaceId, workspaceId),
          ),
        )
        .orderBy(asc(schema.agentTemplates.name));

      if (rows.length === 0) return [];

      const questions = await tx
        .select({
          templateId: schema.agentTemplateQuestions.templateId,
          key: schema.agentTemplateQuestions.key,
          label: schema.agentTemplateQuestions.label,
          type: schema.agentTemplateQuestions.type,
          required: schema.agentTemplateQuestions.required,
          help: schema.agentTemplateQuestions.help,
          options: schema.agentTemplateQuestions.options,
        })
        .from(schema.agentTemplateQuestions)
        .where(
          inArray(
            schema.agentTemplateQuestions.templateId,
            rows.map((t) => t.id),
          ),
        )
        .orderBy(asc(schema.agentTemplateQuestions.position));

      const byTemplate = new Map<string, TemplateQuestion[]>();
      for (const q of questions) {
        const list = byTemplate.get(q.templateId) ?? [];
        list.push({
          key: q.key,
          label: q.label,
          type: q.type,
          required: q.required,
          help: q.help,
          options: q.options,
        });
        byTemplate.set(q.templateId, list);
      }

      return rows.map((t) => ({ ...t, questions: byTemplate.get(t.id) ?? [] }));
    });

    res.json({ templates });
  });

  return router;
}
