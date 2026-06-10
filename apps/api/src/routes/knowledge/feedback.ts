/**
 * Feedback de citações da Knowledge Base (DATA_MODEL secao 8.3; PERMISSIONS kb.edit).
 *
 * Fecha o ciclo de qualidade do RAG: quando o agente cita um documento (via
 * search_knowledge_base, F3-S05), o usuario marca util/nao-util; o sinal entra em
 * kb_feedback e alimenta o re-ranking do retrieval (ja lido por F3-S05).
 *
 * Router proprio (montado em app.ts pelo orchestrator). NAO toca o router de CRUD
 * de F3-S04 (boundary do slot).
 *
 * Endpoints (sob /api/knowledge, RLS via req.scoped):
 *   POST /api/knowledge/feedback                      grava kb_feedback   (kb.edit)
 *   GET  /api/knowledge/feedback?documentId=...       agregado por doc     (kb.edit)
 *
 * Dedup razoavel: antes de inserir, se ja existe feedback do mesmo (document_id,
 * chunk_id, conversation_id) com o mesmo `helpful`, e no-op (evita spam de cliques).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const feedbackSchema = z.object({
  documentId: z.string().uuid(),
  chunkId: z.string().uuid().nullish(),
  agentId: z.string().uuid().nullish(),
  conversationId: z.string().uuid().nullish(),
  helpful: z.boolean(),
  reason: z.string().trim().max(2000).nullish(),
});

const aggregateQuerySchema = z.object({
  documentId: z.string().uuid(),
});

export function createKnowledgeFeedbackRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('kb.edit')] as const;

  // POST /api/knowledge/feedback
  router.post('/api/knowledge/feedback', ...guard, async (req: Request, res: Response) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Dados de feedback invalidos.' });
      return;
    }
    const input = parsed.data;
    const workspaceId = req.auth!.workspace.id;

    const created = await req.scoped!(async (tx) => {
      // Confirma que o documento pertence ao workspace (RLS ja isola; checagem
      // explicita devolve 404 limpo em vez de violar FK).
      const [doc] = await tx
        .select({ id: schema.kbDocuments.id })
        .from(schema.kbDocuments)
        .where(eq(schema.kbDocuments.id, input.documentId))
        .limit(1);
      if (!doc) return { notFound: true as const };

      // Dedup razoavel: mesmo (doc, chunk, conversation, helpful) -> no-op.
      const chunkCond = input.chunkId
        ? eq(schema.kbFeedback.chunkId, input.chunkId)
        : isNull(schema.kbFeedback.chunkId);
      const convCond = input.conversationId
        ? eq(schema.kbFeedback.conversationId, input.conversationId)
        : isNull(schema.kbFeedback.conversationId);
      const [dup] = await tx
        .select({ id: schema.kbFeedback.id })
        .from(schema.kbFeedback)
        .where(
          and(
            eq(schema.kbFeedback.documentId, input.documentId),
            chunkCond,
            convCond,
            eq(schema.kbFeedback.helpful, input.helpful),
          ),
        )
        .limit(1);
      if (dup) return { duplicate: true as const, id: dup.id };

      const [row] = await tx
        .insert(schema.kbFeedback)
        .values({
          workspaceId,
          documentId: input.documentId,
          chunkId: input.chunkId ?? null,
          agentId: input.agentId ?? null,
          conversationId: input.conversationId ?? null,
          helpful: input.helpful,
          reason: input.reason ?? null,
        })
        .returning({ id: schema.kbFeedback.id });
      if (!row) throw new Error('Falha ao gravar feedback.');
      return { id: row.id };
    });

    if ('notFound' in created) {
      res.status(404).json({ message: 'Documento nao encontrado.' });
      return;
    }
    res.status(201).json({ id: created.id, deduped: 'duplicate' in created });
  });

  // GET /api/knowledge/feedback?documentId=...  -> { helpful, notHelpful, total }
  router.get('/api/knowledge/feedback', ...guard, async (req: Request, res: Response) => {
    const parsed = aggregateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'documentId invalido.' });
      return;
    }
    const { documentId } = parsed.data;
    const [agg] = await req.scoped!((tx) =>
      tx
        .select({
          helpful: sql<number>`count(*) filter (where ${schema.kbFeedback.helpful})::int`,
          notHelpful: sql<number>`count(*) filter (where not ${schema.kbFeedback.helpful})::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(schema.kbFeedback)
        .where(eq(schema.kbFeedback.documentId, documentId)),
    );
    res.json({
      documentId,
      helpful: agg?.helpful ?? 0,
      notHelpful: agg?.notHelpful ?? 0,
      total: agg?.total ?? 0,
    });
  });

  return router;
}
