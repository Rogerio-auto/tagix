/**
 * Catálogo de tools + toggle de `agent_tools` (DATA_MODEL §7.4–7.6 /
 * AGENTS_LANGGRAPH §6; PERMISSIONS §2.3).
 *
 * Endpoints:
 *   GET  /api/agents/tools                 — catálogo de tools visível ao workspace
 *                                            (globais + custom do workspace)        (agent.list)
 *   GET  /api/agents/:id/tools             — estado por agente: cada tool do catálogo
 *                                            com seu `isEnabled`/`overrides`          (agent.list)
 *   PUT  /api/agents/:id/tools/:toolId     — upsert do toggle agent↔tool             (agent.toggle_tools)
 *
 * RLS: `agent_tools` está em RLS_TABLES (isolada por subquery em `agents`) → toda
 * leitura/escrita roda em `req.scoped`. `tools` NÃO é RLS-scoped (linhas globais
 * com `workspace_id IS NULL` precisam ser legíveis por todos) → o filtro
 * global-vs-workspace é app-side via `or(isNull(workspaceId), eq(...))`.
 *
 * O toggle valida que o agente alvo existe DENTRO do escopo do workspace (a
 * própria RLS de `agents` garante isso na sub-checagem) antes do upsert, evitando
 * criar `agent_tools` órfãos para um agent_id de outro tenant.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Colunas públicas de uma tool do catálogo (sem expor nada sensível extra). */
const PUBLIC_TOOL_COLUMNS = {
  id: schema.tools.id,
  workspaceId: schema.tools.workspaceId,
  key: schema.tools.key,
  name: schema.tools.name,
  description: schema.tools.description,
  category: schema.tools.category,
  schema: schema.tools.schema,
  handlerConfig: schema.tools.handlerConfig,
  isGlobal: schema.tools.isGlobal,
  isActive: schema.tools.isActive,
} as const;

const toggleSchema = z.object({
  isEnabled: z.boolean(),
  overrides: z.record(z.string(), z.unknown()).optional(),
});

/** Narrowing de `req.params['x']` (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export function createAgentToolsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;
  const toggleGuard = [requireAuth, withRLS, requireRole('agent.toggle_tools')] as const;

  // GET /api/agents/tools — catálogo de tools visível ao workspace.
  // (Rota declarada antes de /api/agents/:id/tools para não colidir com :id.)
  router.get('/api/agents/tools', ...viewGuard, async (req: Request, res: Response) => {
    const workspaceId = req.auth!.workspace.id;
    const rows = await req.scoped!((tx) =>
      tx
        .select(PUBLIC_TOOL_COLUMNS)
        .from(schema.tools)
        .where(
          and(
            eq(schema.tools.isActive, true),
            or(isNull(schema.tools.workspaceId), eq(schema.tools.workspaceId, workspaceId)),
          ),
        )
        .orderBy(asc(schema.tools.category), asc(schema.tools.name)),
    );
    res.json({ tools: rows });
  });

  // GET /api/agents/:id/tools — catálogo + estado (isEnabled/overrides) por agente.
  router.get('/api/agents/:id/tools', ...viewGuard, async (req: Request, res: Response) => {
    const agentId = param(req, 'id');
    if (!agentId) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;

    const result = await req.scoped!(async (tx) => {
      // Confirma que o agente existe no escopo do workspace (RLS).
      const [agent] = await tx
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      if (!agent) return null;

      const catalog = await tx
        .select(PUBLIC_TOOL_COLUMNS)
        .from(schema.tools)
        .where(
          and(
            eq(schema.tools.isActive, true),
            or(isNull(schema.tools.workspaceId), eq(schema.tools.workspaceId, workspaceId)),
          ),
        )
        .orderBy(asc(schema.tools.category), asc(schema.tools.name));

      const links = await tx
        .select({
          toolId: schema.agentTools.toolId,
          isEnabled: schema.agentTools.isEnabled,
          overrides: schema.agentTools.overrides,
        })
        .from(schema.agentTools)
        .where(eq(schema.agentTools.agentId, agentId));

      const linkByTool = new Map(links.map((l) => [l.toolId, l]));
      return catalog.map((tool) => {
        const link = linkByTool.get(tool.id);
        return {
          ...tool,
          // Tool sem linha em agent_tools = não atribuída (desabilitada por default).
          isEnabled: link?.isEnabled ?? false,
          overrides: link?.overrides ?? {},
        };
      });
    });

    if (result === null) {
      res.status(404).json({ message: 'Agente não encontrado.' });
      return;
    }
    res.json({ tools: result });
  });

  // PUT /api/agents/:id/tools/:toolId — upsert do toggle agent↔tool.
  router.put(
    '/api/agents/:id/tools/:toolId',
    ...toggleGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      const toolId = param(req, 'toolId');
      if (!agentId || !toolId) {
        res.status(400).json({ message: 'id/toolId ausente.' });
        return;
      }
      const parsed = toggleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Payload de toggle inválido.' });
        return;
      }
      const workspaceId = req.auth!.workspace.id;

      const result = await req.scoped!(async (tx) => {
        // Agente precisa existir no workspace (RLS sobre `agents`).
        const [agent] = await tx
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(eq(schema.agents.id, agentId))
          .limit(1);
        if (!agent) return { error: 'agent' as const };

        // Tool precisa existir no catálogo visível (global ou do workspace) e ativa.
        const [tool] = await tx
          .select({ id: schema.tools.id })
          .from(schema.tools)
          .where(
            and(
              eq(schema.tools.id, toolId),
              eq(schema.tools.isActive, true),
              or(isNull(schema.tools.workspaceId), eq(schema.tools.workspaceId, workspaceId)),
            ),
          )
          .limit(1);
        if (!tool) return { error: 'tool' as const };

        const [link] = await tx
          .insert(schema.agentTools)
          .values({
            agentId,
            toolId,
            isEnabled: parsed.data.isEnabled,
            ...(parsed.data.overrides !== undefined ? { overrides: parsed.data.overrides } : {}),
          })
          .onConflictDoUpdate({
            target: [schema.agentTools.agentId, schema.agentTools.toolId],
            set: {
              isEnabled: parsed.data.isEnabled,
              ...(parsed.data.overrides !== undefined ? { overrides: parsed.data.overrides } : {}),
            },
          })
          .returning({
            agentId: schema.agentTools.agentId,
            toolId: schema.agentTools.toolId,
            isEnabled: schema.agentTools.isEnabled,
            overrides: schema.agentTools.overrides,
          });

        return { link };
      });

      if ('error' in result) {
        res
          .status(404)
          .json({ message: result.error === 'agent' ? 'Agente não encontrado.' : 'Tool não encontrada.' });
        return;
      }
      res.json({ agentTool: result.link });
    },
  );

  return router;
}
