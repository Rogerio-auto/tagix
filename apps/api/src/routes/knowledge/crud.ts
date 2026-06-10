/**
 * CRUD da Knowledge Base (DATA_MODEL secao 8; PERMISSIONS kb.edit/kb.delete).
 *
 * Endpoints sob /api/knowledge, RLS-escopados via req.scoped:
 *   POST   /api/knowledge/documents               cria doc + publica ingest   (kb.edit)
 *   GET    /api/knowledge/documents               lista paginada + filtros     (kb.edit)
 *   GET    /api/knowledge/documents/:id           doc + chunks (preview)       (kb.edit)
 *   PATCH  /api/knowledge/documents/:id           metadados                    (kb.edit)
 *   POST   /api/knowledge/documents/:id/reprocess republica ingest             (kb.edit)
 *   DELETE /api/knowledge/documents/:id           archive (default)/delete      (kb.delete)
 *
 * RLS: kb_documents/kb_chunks estao em RLS_TABLES; toda query roda em req.scoped.
 * O doc nasce draft (aguardando indexacao) e a API publica kb.document.ingest;
 * o worker (F3-S03) gera chunks/embeddings e promove o doc para active. O enum
 * status (active/draft/archived) e o lifecycle do documento (DATA_MODEL 8.1) e
 * nao tem estado processing no schema.
 */
import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { publishKbIngest } from './publisher';

const KB_STATUSES = ['active', 'draft', 'archived'] as const;
const KB_SOURCES = ['upload', 'url', 'manual'] as const;

const DOC_LIST_COLUMNS = {
  id: schema.kbDocuments.id,
  workspaceId: schema.kbDocuments.workspaceId,
  title: schema.kbDocuments.title,
  source: schema.kbDocuments.source,
  sourceUrl: schema.kbDocuments.sourceUrl,
  category: schema.kbDocuments.category,
  tags: schema.kbDocuments.tags,
  language: schema.kbDocuments.language,
  priority: schema.kbDocuments.priority,
  status: schema.kbDocuments.status,
  visibleToAgents: schema.kbDocuments.visibleToAgents,
  version: schema.kbDocuments.version,
  createdAt: schema.kbDocuments.createdAt,
  updatedAt: schema.kbDocuments.updatedAt,
} as const;

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  source: z.enum(KB_SOURCES).default('manual'),
  sourceUrl: z.string().trim().url().max(2000).nullish(),
  sourceMime: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(120).nullish(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  language: z.string().trim().min(2).max(12).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  visibleToAgents: z.boolean().optional(),
  rawContent: z.string().min(1).max(2_000_000),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    category: z.string().trim().max(120).nullish(),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    priority: z.number().int().min(0).max(10).optional(),
    status: z.enum(KB_STATUSES).optional(),
    visibleToAgents: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nenhum campo para atualizar.' });

const listQuerySchema = z.object({
  status: z.enum(KB_STATUSES).optional(),
  category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const deleteQuerySchema = z.object({
  hard: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function createKnowledgeCrudRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('kb.edit')] as const;
  const deleteGuard = [requireAuth, withRLS, requireRole('kb.delete')] as const;

  router.post('/api/knowledge/documents', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Dados do documento invalidos.' });
      return;
    }
    const input = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const createdBy = req.auth!.member.id;
    const contentSha256 = sha256(input.rawContent);

    const created = await req.scoped!(async (tx) => {
      const [dup] = await tx
        .select({ id: schema.kbDocuments.id })
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.contentSha256, contentSha256))
        .limit(1);
      if (dup) return { duplicate: true as const, id: dup.id };

      const [doc] = await tx
        .insert(schema.kbDocuments)
        .values({
          workspaceId,
          title: input.title,
          source: input.source,
          sourceUrl: input.sourceUrl ?? null,
          sourceMime: input.sourceMime ?? null,
          category: input.category ?? null,
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.visibleToAgents !== undefined
            ? { visibleToAgents: input.visibleToAgents }
            : {}),
          status: 'draft',
          rawContent: input.rawContent,
          contentSha256,
          createdBy,
        })
        .returning(DOC_LIST_COLUMNS);
      if (!doc) throw new Error('Falha ao criar documento.');
      return { duplicate: false as const, doc };
    });

    if (created.duplicate) {
      res
        .status(409)
        .json({ message: 'Documento com conteudo identico ja existe.', documentId: created.id });
      return;
    }

    await publishKbIngest(workspaceId, created.doc.id, 'create');
    res.status(201).json({ document: created.doc });
  });

  router.get('/api/knowledge/documents', ...editGuard, async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'Filtros invalidos.' });
      return;
    }
    const { status, category, q, limit, offset } = parsed.data;
    const conds = [];
    if (status) conds.push(eq(schema.kbDocuments.status, status));
    if (category) conds.push(eq(schema.kbDocuments.category, category));
    if (q) conds.push(ilike(schema.kbDocuments.title, `%${q}%`));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const { documents, total } = await req.scoped!(async (tx) => {
      const rows = await tx
        .select(DOC_LIST_COLUMNS)
        .from(schema.kbDocuments)
        .where(where)
        .orderBy(desc(schema.kbDocuments.createdAt))
        .limit(limit)
        .offset(offset);
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.kbDocuments)
        .where(where);
      return { documents: rows, total: count?.n ?? 0 };
    });
    res.json({ documents, total, limit, offset });
  });

  router.get('/api/knowledge/documents/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const result = await req.scoped!(async (tx) => {
      const [doc] = await tx
        .select(DOC_LIST_COLUMNS)
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, id))
        .limit(1);
      if (!doc) return null;
      const chunks = await tx
        .select({
          id: schema.kbChunks.id,
          chunkIndex: schema.kbChunks.chunkIndex,
          content: schema.kbChunks.content,
          contentTokens: schema.kbChunks.contentTokens,
        })
        .from(schema.kbChunks)
        .where(eq(schema.kbChunks.documentId, id))
        .orderBy(asc(schema.kbChunks.chunkIndex))
        .limit(50);
      return { doc, chunks };
    });
    if (!result) {
      res.status(404).json({ message: 'Documento nao encontrado.' });
      return;
    }
    res.json({ document: result.doc, chunks: result.chunks, chunkCount: result.chunks.length });
  });

  router.patch('/api/knowledge/documents/:id', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!id) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Dados de atualizacao invalidos.' });
      return;
    }
    const input = parsed.data;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of ['title', 'category', 'tags', 'priority', 'status', 'visibleToAgents'] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    const [updated] = await req.scoped!((tx) =>
      tx
        .update(schema.kbDocuments)
        .set(patch)
        .where(eq(schema.kbDocuments.id, id))
        .returning(DOC_LIST_COLUMNS),
    );
    if (!updated) {
      res.status(404).json({ message: 'Documento nao encontrado.' });
      return;
    }
    res.json({ document: updated });
  });

  router.post(
    '/api/knowledge/documents/:id/reprocess',
    ...editGuard,
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      if (!id) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const workspaceId = req.auth!.workspace.id;
      const [doc] = await req.scoped!((tx) =>
        tx
          .select({ id: schema.kbDocuments.id })
          .from(schema.kbDocuments)
          .where(eq(schema.kbDocuments.id, id))
          .limit(1),
      );
      if (!doc) {
        res.status(404).json({ message: 'Documento nao encontrado.' });
        return;
      }
      await publishKbIngest(workspaceId, doc.id, 'reprocess');
      res.status(202).json({ documentId: doc.id, reason: 'reprocess' });
    },
  );

  router.delete(
    '/api/knowledge/documents/:id',
    ...deleteGuard,
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      if (!id) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsedQuery = deleteQuerySchema.safeParse(req.query);
      const hard = parsedQuery.success ? parsedQuery.data.hard : false;

      if (hard) {
        const deleted = await req.scoped!((tx) =>
          tx
            .delete(schema.kbDocuments)
            .where(eq(schema.kbDocuments.id, id))
            .returning({ id: schema.kbDocuments.id }),
        );
        if (deleted.length === 0) {
          res.status(404).json({ message: 'Documento nao encontrado.' });
          return;
        }
        res.status(204).end();
        return;
      }

      const [archived] = await req.scoped!((tx) =>
        tx
          .update(schema.kbDocuments)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(schema.kbDocuments.id, id))
          .returning(DOC_LIST_COLUMNS),
      );
      if (!archived) {
        res.status(404).json({ message: 'Documento nao encontrado.' });
        return;
      }
      res.json({ document: archived });
    },
  );

  return router;
}
