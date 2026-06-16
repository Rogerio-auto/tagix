/**
 * CRUD de agentes IA (DATA_MODEL §7.1 / AGENTS_LANGGRAPH §6, §16; PERMISSIONS §2.3).
 *
 * Endpoints (todos sob `/api/agents`, RLS-escopados via `req.scoped`):
 *   GET    /api/agents              — lista agentes do workspace            (agent.list)
 *   GET    /api/agents/:id          — detalhe de um agente                  (agent.list)
 *   POST   /api/agents              — cria agente (opcionalmente a partir de
 *                                     um template global/do workspace)      (agent.edit)
 *   PATCH  /api/agents/:id          — edita config/modelo/prompt/status     (agent.edit)
 *   PATCH  /api/agents/:id/status   — ativa/desativa/arquiva                (agent.edit)
 *
 * RLS: `agents` está em RLS_TABLES → toda query roda dentro de `req.scoped`
 * (transação com `app.workspace_id` setado). O INSERT carrega `workspace_id`
 * explícito por defesa-em-profundidade, mas a RLS já isola o tenant.
 *
 * Criar-a-partir-de-template: materializa `model`/`model_params`/`system_prompt`
 * a partir do `agent_templates` escolhido e cria as linhas `agent_tools` default
 * resolvendo `template.default_tools` (tool keys) contra o catálogo `tools`
 * (globais + do workspace). `agent_templates`/`tools` NÃO são RLS-scoped — o
 * filtro global-vs-workspace é app-side via `or(isNull(workspaceId), eq(...))`.
 *
 * Seam S09 (cost-guard/policy): create/update que mexem em `model` devem, quando
 * F2-S09 estiver ligado, consultar `resolvePolicy(workspaceId)` de
 * `@hm/agents-core` e validar `model ∈ policy.allowedModels`
 * (e usar `policy.defaultChatModel` como fallback). Hoje deixamos o seam marcado
 * (ver TODO(F2-S09)) sem acoplar a policy aqui.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { agentDepartmentsRepo, schema, type DbTx } from '@hm/db';
import type { AgentDepartmentItem, DepartmentLink } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const AGENT_STATUSES = ['active', 'inactive', 'archived'] as const;

/**
 * Colunas públicas de um agente devolvidas ao cliente. `api_token_hash` NUNCA
 * é exposto (segredo de autenticação do agente).
 */
const PUBLIC_AGENT_COLUMNS = {
  id: schema.agents.id,
  workspaceId: schema.agents.workspaceId,
  templateId: schema.agents.templateId,
  name: schema.agents.name,
  description: schema.agents.description,
  systemPrompt: schema.agents.systemPrompt,
  model: schema.agents.model,
  modelParams: schema.agents.modelParams,
  visionModel: schema.agents.visionModel,
  transcriptionModel: schema.agents.transcriptionModel,
  status: schema.agents.status,
  aggregationEnabled: schema.agents.aggregationEnabled,
  aggregationWindowSec: schema.agents.aggregationWindowSec,
  maxBatchMessages: schema.agents.maxBatchMessages,
  replyIfIdleSec: schema.agents.replyIfIdleSec,
  allowHandoff: schema.agents.allowHandoff,
  ignoreGroupMessages: schema.agents.ignoreGroupMessages,
  enabledChannelIds: schema.agents.enabledChannelIds,
  createdAt: schema.agents.createdAt,
  updatedAt: schema.agents.updatedAt,
} as const;

/** Sub-schema reutilizável dos campos editáveis de comportamento do agente. */
const agentBehaviorSchema = z.object({
  description: z.string().trim().max(2000).nullish(),
  systemPrompt: z.string().trim().min(1).max(20000).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  modelParams: z.record(z.string(), z.unknown()).optional(),
  visionModel: z.string().trim().min(1).max(120).nullish(),
  transcriptionModel: z.string().trim().min(1).max(120).nullish(),
  aggregationEnabled: z.boolean().optional(),
  aggregationWindowSec: z.number().int().min(0).max(600).optional(),
  maxBatchMessages: z.number().int().min(1).max(200).optional(),
  replyIfIdleSec: z.number().int().min(0).max(86400).nullish(),
  allowHandoff: z.boolean().optional(),
  ignoreGroupMessages: z.boolean().optional(),
  enabledChannelIds: z.array(z.string().uuid()).optional(),
});

/**
 * Vínculo agente↔departamento (F34-S02). N:N: cada item liga o agente a um
 * departamento; `isDefault` marca o agente DE ENTRADA daquele departamento.
 *
 * Regras app-side (defesa em profundidade — o índice parcial único do schema é a
 * garantia final): sem departamentos repetidos no mesmo payload e no máximo 1
 * default por departamento. Como cada `departmentId` aparece no máximo 1×, a
 * unicidade de departamento já garante ≤ 1 default por dept dentro do payload.
 */
const agentDepartmentSchema = z.object({
  departmentId: z.string().uuid(),
  isDefault: z.boolean().default(false),
});

const departmentsSchema = z
  .array(agentDepartmentSchema)
  .max(100)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.departmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Departamento repetido no conjunto.',
        });
        return;
      }
      seen.add(item.departmentId);
    }
  });

/**
 * Valida que todos os departamentos referenciados existem, são do workspace e
 * estão ATIVOS (`is_active = 'active'`, não arquivados). Roda dentro da `tx`
 * RLS-escopada, então só enxerga departamentos do tenant corrente.
 */
async function assertDepartmentsValid(
  tx: DbTx,
  items: AgentDepartmentItem[],
): Promise<void> {
  if (items.length === 0) return;
  const ids = items.map((i) => i.departmentId);
  const rows = await tx
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(
      and(
        inArray(schema.departments.id, ids),
        eq(schema.departments.isActive, 'active'),
      ),
    );
  const valid = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!valid.has(id)) {
      throw new HttpError(400, 'Departamento inválido, arquivado ou de outro workspace.');
    }
  }
}

/**
 * Criação. Dois modos:
 *  - a partir de template (`templateId`): `systemPrompt`/`model` herdam do template
 *    se omitidos; cria `agent_tools` default das `default_tools` do template.
 *  - do zero: `systemPrompt` é obrigatório.
 * A validação cruzada (prompt obrigatório quando sem template) é feita no handler.
 */
const createSchema = agentBehaviorSchema.extend({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().uuid().optional(),
  departments: departmentsSchema.optional(),
});

const updateSchema = agentBehaviorSchema
  .extend({
    name: z.string().trim().min(1).max(120).optional(),
    status: z.enum(AGENT_STATUSES).optional(),
    departments: departmentsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nenhum campo para atualizar.' });

const statusSchema = z.object({ status: z.enum(AGENT_STATUSES) });

/** Narrowing de `req.params['x']` (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Resolve um template visível ao workspace (global OU do próprio workspace).
 * `agent_templates` está fora de RLS_TABLES → filtro app-side.
 */
async function findTemplate(tx: DbTx, templateId: string, workspaceId: string) {
  const [row] = await tx
    .select()
    .from(schema.agentTemplates)
    .where(
      and(
        eq(schema.agentTemplates.id, templateId),
        or(
          isNull(schema.agentTemplates.workspaceId),
          eq(schema.agentTemplates.workspaceId, workspaceId),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function createAgentsCrudRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('agent.edit')] as const;

  // GET /api/agents — lista agentes do workspace (RLS-escopada).
  router.get('/api/agents', ...viewGuard, async (req: Request, res: Response) => {
    const rows = await req.scoped!((tx) =>
      tx
        .select(PUBLIC_AGENT_COLUMNS)
        .from(schema.agents)
        .orderBy(asc(schema.agents.createdAt)),
    );
    res.json({ agents: rows });
  });

  // GET /api/agents/:id — detalhe de um agente (RLS-escopada).
  router.get('/api/agents/:id', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const result = await req.scoped!(async (tx) => {
      const [agent] = await tx
        .select(PUBLIC_AGENT_COLUMNS)
        .from(schema.agents)
        .where(eq(schema.agents.id, id))
        .limit(1);
      if (!agent) return null;
      const departments = await agentDepartmentsRepo.listDepartmentsForAgent(tx, agent.id);
      return { agent, departments };
    });
    if (!result) {
      res.status(404).json({ message: 'Agente não encontrado.' });
      return;
    }
    res.json({ agent: { ...result.agent, departments: result.departments } });
  });

  // POST /api/agents — cria agente (do zero ou a partir de template).
  router.post('/api/agents', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Dados do agente inválidos.' });
      return;
    }
    const input = parsed.data;
    const workspaceId = req.auth!.workspace.id;

    try {
      const created = await req.scoped!(async (tx) => {
        let templateId: string | null = null;
        let defaultToolKeys: string[] = [];
        // Defaults vindos do template (quando aplicável).
        const tpl = input.templateId
          ? await findTemplate(tx, input.templateId, workspaceId)
          : null;

        if (input.templateId && !tpl) {
          throw new HttpError(404, 'Template não encontrado.');
        }
        if (tpl) {
          templateId = tpl.id;
          defaultToolKeys = tpl.defaultTools;
        }

        const systemPrompt = input.systemPrompt ?? tpl?.promptTemplate;
        if (!systemPrompt) {
          // Sem template e sem prompt explícito → inválido.
          throw new HttpError(400, 'systemPrompt é obrigatório quando não há template.');
        }

        // TODO(F2-S09): consultar resolvePolicy(workspaceId) de apps/api/src/agents
        // para validar `model ∈ allowed_models` e aplicar `default_chat_model`.
        const model = input.model ?? tpl?.defaultModel;
        const modelParams = input.modelParams ?? tpl?.defaultModelParams;

        const [agent] = await tx
          .insert(schema.agents)
          .values({
            workspaceId,
            templateId,
            name: input.name,
            description: input.description ?? null,
            systemPrompt,
            ...(model ? { model } : {}),
            ...(modelParams ? { modelParams } : {}),
            ...(input.visionModel !== undefined ? { visionModel: input.visionModel } : {}),
            ...(input.transcriptionModel !== undefined
              ? { transcriptionModel: input.transcriptionModel }
              : {}),
            ...(input.aggregationEnabled !== undefined
              ? { aggregationEnabled: input.aggregationEnabled }
              : {}),
            ...(input.aggregationWindowSec !== undefined
              ? { aggregationWindowSec: input.aggregationWindowSec }
              : {}),
            ...(input.maxBatchMessages !== undefined
              ? { maxBatchMessages: input.maxBatchMessages }
              : {}),
            ...(input.replyIfIdleSec !== undefined ? { replyIfIdleSec: input.replyIfIdleSec } : {}),
            ...(input.allowHandoff !== undefined ? { allowHandoff: input.allowHandoff } : {}),
            ...(input.ignoreGroupMessages !== undefined
              ? { ignoreGroupMessages: input.ignoreGroupMessages }
              : {}),
            ...(input.enabledChannelIds !== undefined
              ? { enabledChannelIds: input.enabledChannelIds }
              : {}),
          })
          .returning(PUBLIC_AGENT_COLUMNS);

        if (!agent) throw new Error('Falha ao criar agente.');

        // Materializa agent_tools default a partir das tool keys do template.
        // Resolve keys → ids no catálogo (globais OU do workspace); ignora keys
        // sem match (template pode referenciar tools ainda não provisionadas).
        if (defaultToolKeys.length > 0) {
          const toolRows = await tx
            .select({ id: schema.tools.id })
            .from(schema.tools)
            .where(
              and(
                inArray(schema.tools.key, defaultToolKeys),
                eq(schema.tools.isActive, true),
                or(isNull(schema.tools.workspaceId), eq(schema.tools.workspaceId, workspaceId)),
              ),
            );
          if (toolRows.length > 0) {
            await tx
              .insert(schema.agentTools)
              .values(toolRows.map((t) => ({ agentId: agent.id, toolId: t.id, isEnabled: true })))
              .onConflictDoNothing();
          }
        }

        // F34-S02: vínculos agente↔departamento (N:N) na MESMA transação.
        let departments: DepartmentLink[] = [];
        if (input.departments !== undefined) {
          const items: AgentDepartmentItem[] = input.departments;
          await assertDepartmentsValid(tx, items);
          await agentDepartmentsRepo.setAgentDepartments(tx, workspaceId, agent.id, items);
          departments = items.map((i) => ({
            departmentId: i.departmentId,
            isDefault: i.isDefault,
          }));
        }

        return { ...agent, departments };
      });

      res.status(201).json({ agent: created });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      throw err;
    }
  });

  // PATCH /api/agents/:id — edita config/modelo/prompt/status do agente.
  router.patch('/api/agents/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Dados de atualização inválidos.' });
      return;
    }
    const input = parsed.data;
    const workspaceId = req.auth!.workspace.id;

    // TODO(F2-S09): se `input.model` presente, validar contra resolvePolicy(workspaceId).
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'name',
      'description',
      'systemPrompt',
      'model',
      'modelParams',
      'visionModel',
      'transcriptionModel',
      'status',
      'aggregationEnabled',
      'aggregationWindowSec',
      'maxBatchMessages',
      'replyIfIdleSec',
      'allowHandoff',
      'ignoreGroupMessages',
      'enabledChannelIds',
    ] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }

    try {
      // Update do agente + replace-all dos departamentos na MESMA transação
      // (F34-S02) — atomicidade entre config e roteamento.
      const result = await req.scoped!(async (tx) => {
        const [updated] = await tx
          .update(schema.agents)
          .set(patch)
          .where(eq(schema.agents.id, id))
          .returning(PUBLIC_AGENT_COLUMNS);
        if (!updated) return null;

        // `departments` ausente = não mexe nos vínculos; presente (incl. `[]`) =
        // substitui o conjunto inteiro.
        if (input.departments !== undefined) {
          const items: AgentDepartmentItem[] = input.departments;
          await assertDepartmentsValid(tx, items);
          await agentDepartmentsRepo.setAgentDepartments(tx, workspaceId, updated.id, items);
        }

        const departments = await agentDepartmentsRepo.listDepartmentsForAgent(tx, updated.id);
        return { ...updated, departments };
      });

      if (!result) {
        res.status(404).json({ message: 'Agente não encontrado.' });
        return;
      }
      res.json({ agent: result });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      throw err;
    }
  });

  // PATCH /api/agents/:id/status — ativa/desativa/arquiva (atalho de toggle).
  router.patch('/api/agents/:id/status', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Status inválido.' });
      return;
    }
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(schema.agents)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(schema.agents.id, id))
        .returning(PUBLIC_AGENT_COLUMNS),
    );
    if (!updated) {
      res.status(404).json({ message: 'Agente não encontrado.' });
      return;
    }
    res.json({ agent: updated });
  });

  return router;
}

/** Erro com status HTTP — usado para abortar a transação de criação com código apropriado. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
