/**
 * Versionamento de prompt do agente — "prompt como código" (F56-S31 / AUDITORIA_TECNICA §3.3, AG-04).
 *
 * `agents.system_prompt`/`model`/`model_params` guardam o estado LIVE (o que o runtime
 * lê). A tabela `agent_prompt_versions` é o histórico append-only + staging:
 *   - draft    → rascunho staged, não aplicado; editável até publicar.
 *   - live     → versão publicada (espelha o agente). No máx. 1 por agente (índice único).
 *   - archived → versão que já foi live e foi substituída.
 *
 * Endpoints (montados pelo CRUD router, sob `/api/agents`, RLS-escopados via `req.scoped`):
 *   GET    /api/agents/:id/versions                       — histórico          (agent.list)
 *   GET    /api/agents/:id/versions/diff?from=&to=        — duas versões p/ diff (agent.list)
 *   POST   /api/agents/:id/versions                       — cria um DRAFT       (agent.edit)
 *   PATCH  /api/agents/:id/versions/:versionId            — edita um DRAFT      (agent.edit)
 *   DELETE /api/agents/:id/versions/:versionId            — descarta um DRAFT   (agent.edit)
 *   POST   /api/agents/:id/versions/:versionId/publish    — draft→live          (agent.edit)
 *   POST   /api/agents/:id/versions/:versionId/rollback   — republica como live (agent.edit)
 *
 * Publicar/rollback aplicam o snapshot ao agente e arquivam o live anterior — tudo
 * na MESMA transação RLS-escopada (atomicidade entre agente e histórico). O histórico
 * é append-only: rollback NUNCA muta uma versão antiga, cria uma nova live a partir dela.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Colunas públicas de uma versão de prompt devolvidas ao cliente. */
const PUBLIC_VERSION_COLUMNS = {
  id: schema.agentPromptVersions.id,
  agentId: schema.agentPromptVersions.agentId,
  version: schema.agentPromptVersions.version,
  status: schema.agentPromptVersions.status,
  systemPrompt: schema.agentPromptVersions.systemPrompt,
  model: schema.agentPromptVersions.model,
  modelParams: schema.agentPromptVersions.modelParams,
  label: schema.agentPromptVersions.label,
  note: schema.agentPromptVersions.note,
  authorMemberId: schema.agentPromptVersions.authorMemberId,
  rolledBackFrom: schema.agentPromptVersions.rolledBackFrom,
  createdAt: schema.agentPromptVersions.createdAt,
  publishedAt: schema.agentPromptVersions.publishedAt,
} as const;

/** Narrowing de `req.params['x']` (string | undefined no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/** Erro com status HTTP — aborta a transação com código apropriado. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Garante que o agente existe DENTRO do workspace corrente (RLS já isola, mas
 * checamos para devolver 404 explícito em vez de silêncio). Roda dentro da `tx`.
 */
async function assertAgentVisible(tx: DbTx, agentId: string): Promise<void> {
  const [row] = await tx
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);
  if (!row) throw new HttpError(404, 'Agente não encontrado.');
}

/** Próximo número de versão (monotônico por agente). */
async function nextVersionNumber(tx: DbTx, agentId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${schema.agentPromptVersions.version}), 0)` })
    .from(schema.agentPromptVersions)
    .where(eq(schema.agentPromptVersions.agentId, agentId));
  return (row?.max ?? 0) + 1;
}

/**
 * Snapshot de "cérebro" a congelar numa versão. `model`/`modelParams` são opcionais:
 * quando ausentes, a versão herda o default do agente na leitura pelo runtime.
 */
export interface PromptSnapshot {
  readonly systemPrompt: string;
  readonly model?: string | null;
  readonly modelParams?: Record<string, unknown>;
}

/** Metadados de auditoria de uma nova versão. */
interface VersionMeta {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly authorMemberId?: string | null;
  readonly label?: string | null;
  readonly note?: string | null;
  readonly rolledBackFrom?: number | null;
}

/**
 * Arquiva o live atual do agente (se houver). Necessário ANTES de inserir/promover
 * uma nova live — o índice parcial único `(agent_id) WHERE status='live'` é checado
 * imediatamente por linha, então dois lives no mesmo agente violariam a constraint.
 */
async function archiveCurrentLive(tx: DbTx, agentId: string): Promise<void> {
  await tx
    .update(schema.agentPromptVersions)
    .set({ status: 'archived' })
    .where(
      and(
        eq(schema.agentPromptVersions.agentId, agentId),
        eq(schema.agentPromptVersions.status, 'live'),
      ),
    );
}

/**
 * Aplica um snapshot ao AGENTE (colunas live) — o que o runtime passa a ler.
 * `model`/`modelParams` só são tocados quando presentes no snapshot.
 */
async function applySnapshotToAgent(
  tx: DbTx,
  agentId: string,
  snapshot: PromptSnapshot,
): Promise<void> {
  const patch: Record<string, unknown> = {
    systemPrompt: snapshot.systemPrompt,
    updatedAt: new Date(),
  };
  if (snapshot.model !== undefined && snapshot.model !== null) patch['model'] = snapshot.model;
  if (snapshot.modelParams !== undefined) patch['modelParams'] = snapshot.modelParams;
  await tx.update(schema.agents).set(patch).where(eq(schema.agents.id, agentId));
}

/**
 * Grava uma nova versão LIVE a partir de um snapshot e aplica ao agente (append-only).
 * Arquiva o live anterior na MESMA transação. Usada por:
 *   - o hook do CRUD (create/PATCH que muda o prompt) — captura o estado aplicado;
 *   - o rollback (republica o conteúdo de uma versão antiga como nova live).
 *
 * Idempotência de numeração: `version = max+1`. `applyToAgent=false` é usado quando o
 * agente JÁ foi atualizado pelo caller (hook do PATCH) — evita update redundante.
 */
export async function recordLivePromptVersion(
  tx: DbTx,
  snapshot: PromptSnapshot,
  meta: VersionMeta,
  opts: { applyToAgent: boolean },
): Promise<void> {
  await archiveCurrentLive(tx, meta.agentId);
  const version = await nextVersionNumber(tx, meta.agentId);
  await tx.insert(schema.agentPromptVersions).values({
    workspaceId: meta.workspaceId,
    agentId: meta.agentId,
    version,
    status: 'live',
    systemPrompt: snapshot.systemPrompt,
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    ...(snapshot.modelParams !== undefined ? { modelParams: snapshot.modelParams } : {}),
    ...(meta.authorMemberId ? { authorMemberId: meta.authorMemberId } : {}),
    ...(meta.label !== undefined ? { label: meta.label } : {}),
    ...(meta.note !== undefined ? { note: meta.note } : {}),
    ...(meta.rolledBackFrom !== undefined ? { rolledBackFrom: meta.rolledBackFrom } : {}),
    publishedAt: new Date(),
  });
  if (opts.applyToAgent) await applySnapshotToAgent(tx, meta.agentId, snapshot);
}

// ─── Schemas de input ─────────────────────────────────────────────────────────

const createDraftSchema = z.object({
  systemPrompt: z.string().trim().min(1).max(20000),
  model: z.string().trim().min(1).max(120).nullish(),
  modelParams: z.record(z.string(), z.unknown()).optional(),
  label: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(2000).nullish(),
});

const updateDraftSchema = z
  .object({
    systemPrompt: z.string().trim().min(1).max(20000).optional(),
    model: z.string().trim().min(1).max(120).nullish(),
    modelParams: z.record(z.string(), z.unknown()).optional(),
    label: z.string().trim().max(200).nullish(),
    note: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nenhum campo para atualizar.' });

const rollbackSchema = z
  .object({ note: z.string().trim().max(2000).nullish() })
  .optional();

const diffQuerySchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

export function createAgentVersionsRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('agent.list')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('agent.edit')] as const;

  // GET /api/agents/:id/versions — histórico (append-only, mais recente primeiro).
  router.get(
    '/api/agents/:id/versions',
    ...viewGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      if (!agentId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      try {
        const versions = await req.scoped!(async (tx) => {
          await assertAgentVisible(tx, agentId);
          return tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(eq(schema.agentPromptVersions.agentId, agentId))
            .orderBy(desc(schema.agentPromptVersions.version));
        });
        res.json({ versions });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // GET /api/agents/:id/versions/diff?from=&to= — devolve as duas versões p/ diff.
  router.get(
    '/api/agents/:id/versions/diff',
    ...viewGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      if (!agentId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = diffQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ message: 'Parâmetros de diff inválidos (from/to).' });
        return;
      }
      const { from, to } = parsed.data;
      try {
        const result = await req.scoped!(async (tx) => {
          await assertAgentVisible(tx, agentId);
          const [fromRow] = await tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.agentId, agentId),
                eq(schema.agentPromptVersions.version, from),
              ),
            )
            .limit(1);
          const [toRow] = await tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.agentId, agentId),
                eq(schema.agentPromptVersions.version, to),
              ),
            )
            .limit(1);
          if (!fromRow || !toRow) throw new HttpError(404, 'Versão não encontrada.');
          return { from: fromRow, to: toRow };
        });
        res.json(result);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // POST /api/agents/:id/versions — cria um DRAFT (staging, não aplica ao agente).
  router.post(
    '/api/agents/:id/versions',
    ...editGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      if (!agentId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = createDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados do rascunho inválidos.' });
        return;
      }
      const input = parsed.data;
      const workspaceId = req.auth!.workspace.id;
      const authorMemberId = req.auth!.member.id;
      try {
        const version = await req.scoped!(async (tx) => {
          await assertAgentVisible(tx, agentId);
          const nextVersion = await nextVersionNumber(tx, agentId);
          const [row] = await tx
            .insert(schema.agentPromptVersions)
            .values({
              workspaceId,
              agentId,
              version: nextVersion,
              status: 'draft',
              systemPrompt: input.systemPrompt,
              ...(input.model !== undefined ? { model: input.model } : {}),
              ...(input.modelParams !== undefined ? { modelParams: input.modelParams } : {}),
              ...(input.label !== undefined ? { label: input.label } : {}),
              ...(input.note !== undefined ? { note: input.note } : {}),
              authorMemberId,
            })
            .returning(PUBLIC_VERSION_COLUMNS);
          if (!row) throw new Error('Falha ao criar rascunho.');
          return row;
        });
        res.status(201).json({ version });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // PATCH /api/agents/:id/versions/:versionId — edita um DRAFT (só draft é mutável).
  router.patch(
    '/api/agents/:id/versions/:versionId',
    ...editGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      const versionId = param(req, 'versionId');
      if (!agentId || !versionId) {
        res.status(400).json({ message: 'id/versionId ausente.' });
        return;
      }
      const parsed = updateDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados de atualização inválidos.' });
        return;
      }
      const input = parsed.data;
      const patch: Record<string, unknown> = {};
      for (const key of ['systemPrompt', 'model', 'modelParams', 'label', 'note'] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      try {
        const version = await req.scoped!(async (tx) => {
          const [existing] = await tx
            .select({ status: schema.agentPromptVersions.status })
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.id, versionId),
                eq(schema.agentPromptVersions.agentId, agentId),
              ),
            )
            .limit(1);
          if (!existing) throw new HttpError(404, 'Versão não encontrada.');
          if (existing.status !== 'draft') {
            throw new HttpError(409, 'Só rascunhos podem ser editados. Publicadas são imutáveis.');
          }
          const [row] = await tx
            .update(schema.agentPromptVersions)
            .set(patch)
            .where(eq(schema.agentPromptVersions.id, versionId))
            .returning(PUBLIC_VERSION_COLUMNS);
          return row ?? null;
        });
        if (!version) {
          res.status(404).json({ message: 'Versão não encontrada.' });
          return;
        }
        res.json({ version });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // DELETE /api/agents/:id/versions/:versionId — descarta um DRAFT (nunca live/archived).
  router.delete(
    '/api/agents/:id/versions/:versionId',
    ...editGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      const versionId = param(req, 'versionId');
      if (!agentId || !versionId) {
        res.status(400).json({ message: 'id/versionId ausente.' });
        return;
      }
      try {
        await req.scoped!(async (tx) => {
          const [existing] = await tx
            .select({ status: schema.agentPromptVersions.status })
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.id, versionId),
                eq(schema.agentPromptVersions.agentId, agentId),
              ),
            )
            .limit(1);
          if (!existing) throw new HttpError(404, 'Versão não encontrada.');
          if (existing.status !== 'draft') {
            throw new HttpError(409, 'Só rascunhos podem ser descartados.');
          }
          await tx
            .delete(schema.agentPromptVersions)
            .where(eq(schema.agentPromptVersions.id, versionId));
        });
        res.status(204).end();
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // POST /api/agents/:id/versions/:versionId/publish — draft→live (aplica ao agente).
  router.post(
    '/api/agents/:id/versions/:versionId/publish',
    ...editGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      const versionId = param(req, 'versionId');
      if (!agentId || !versionId) {
        res.status(400).json({ message: 'id/versionId ausente.' });
        return;
      }
      try {
        const version = await req.scoped!(async (tx) => {
          const [target] = await tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.id, versionId),
                eq(schema.agentPromptVersions.agentId, agentId),
              ),
            )
            .limit(1);
          if (!target) throw new HttpError(404, 'Versão não encontrada.');
          if (target.status === 'live') {
            throw new HttpError(409, 'Esta versão já está publicada.');
          }
          // Arquiva o live atual, promove a alvo a live e aplica ao agente.
          await archiveCurrentLive(tx, agentId);
          const [row] = await tx
            .update(schema.agentPromptVersions)
            .set({ status: 'live', publishedAt: new Date() })
            .where(eq(schema.agentPromptVersions.id, versionId))
            .returning(PUBLIC_VERSION_COLUMNS);
          if (!row) throw new Error('Falha ao publicar versão.');
          await applySnapshotToAgent(tx, agentId, {
            systemPrompt: target.systemPrompt,
            model: target.model,
            modelParams: target.modelParams,
          });
          return row;
        });
        res.json({ version });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  // POST /api/agents/:id/versions/:versionId/rollback — republica uma versão antiga
  // como uma NOVA live (append-only; o histórico nunca é mutado).
  router.post(
    '/api/agents/:id/versions/:versionId/rollback',
    ...editGuard,
    async (req: Request, res: Response) => {
      const agentId = param(req, 'id');
      const versionId = param(req, 'versionId');
      if (!agentId || !versionId) {
        res.status(400).json({ message: 'id/versionId ausente.' });
        return;
      }
      const parsed = rollbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados de rollback inválidos.' });
        return;
      }
      const note = parsed.data?.note;
      const workspaceId = req.auth!.workspace.id;
      const authorMemberId = req.auth!.member.id;
      try {
        const version = await req.scoped!(async (tx) => {
          const [target] = await tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.id, versionId),
                eq(schema.agentPromptVersions.agentId, agentId),
              ),
            )
            .limit(1);
          if (!target) throw new HttpError(404, 'Versão não encontrada.');
          if (target.status === 'live') {
            throw new HttpError(409, 'Esta versão já é a live atual.');
          }
          await recordLivePromptVersion(
            tx,
            {
              systemPrompt: target.systemPrompt,
              model: target.model,
              modelParams: target.modelParams,
            },
            {
              workspaceId,
              agentId,
              authorMemberId,
              label: target.label ? `Rollback → v${target.version} (${target.label})` : `Rollback → v${target.version}`,
              note: note ?? null,
              rolledBackFrom: target.version,
            },
            { applyToAgent: true },
          );
          const [row] = await tx
            .select(PUBLIC_VERSION_COLUMNS)
            .from(schema.agentPromptVersions)
            .where(
              and(
                eq(schema.agentPromptVersions.agentId, agentId),
                eq(schema.agentPromptVersions.status, 'live'),
              ),
            )
            .limit(1);
          if (!row) throw new Error('Falha ao aplicar rollback.');
          return row;
        });
        res.status(201).json({ version });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  return router;
}
