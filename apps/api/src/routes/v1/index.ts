/**
 * API pública v1 (F9-S03). Endpoints `/api/v1/*` gated por `requireApiKey` + scope.
 *
 * Cada handler é um WRAPPER FINO sobre serviço existente — sem reimplementar regra:
 * - send_message / send_template → persiste mensagem `pending` sob RLS + publica
 *   `OutboundJob` em `hm.q.outbound` (mesmo contrato do `messages.ts` da F1-S24).
 * - upsert_contact → contacts (upsert por id/phone/email) sob RLS.
 * - trigger_flow → `@hm/flow-engine`.triggerFlow com `triggeredBy: 'api'`.
 * - GET conversations / :id → query existente sob RLS.
 *
 * Isolamento: o tenant vem da chave (`req.apiAuth.workspaceId`); todo acesso a dados
 * roda em `withWorkspace(workspaceId, ...)` → RLS aplica.
 *
 * Router NÃO montado aqui — montado em `apps/api/src/app.ts` (gap-fill).
 */
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema, withWorkspace, type DbTx } from '@hm/db';
import { triggerFlow } from '@hm/flow-engine';
import swaggerUi from 'swagger-ui-express';
import { requireApiKey, requireScope } from '../../middlewares/api-key';
import { publishOutboundJob } from '../../mq/outbound-publisher';
import { buildOpenApiDocument } from './openapi';
import {
  API_SCOPES,
  listConversationsQuery,
  sendMessageBody,
  sendTemplateBody,
  triggerFlowBody,
  upsertContactBody,
} from './schemas';

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: 'invalid_request', message });
}

/** Resolve a conversa (channelId/remoteId) no workspace; null se não existe. */
async function resolveConversation(
  tx: DbTx,
  conversationId: string,
): Promise<{ channelId: string; remoteId: string } | null> {
  const [conv] = await tx
    .select({ channelId: schema.conversations.channelId, remoteId: schema.conversations.remoteId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  return conv ?? null;
}

export function createV1Router(): Router {
  const router = Router();

  // ─── Swagger UI + spec JSON (públicos; documentação não exige a chave) ──────
  const doc = buildOpenApiDocument();
  router.get('/api/v1/openapi.json', (_req, res) => res.json(doc));
  router.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(doc));

  // Gate comum a todos os endpoints de dados.
  const auth = requireApiKey;

  // ─── POST /api/v1/send_message ──────────────────────────────────────────────
  router.post(
    '/api/v1/send_message',
    auth,
    requireScope(API_SCOPES.sendMessages),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = sendMessageBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para send_message.');
      const { conversationId, text } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const result = await withWorkspace(workspaceId, async (tx) => {
        const conv = await resolveConversation(tx, conversationId);
        if (!conv) return null;
        const [message] = await tx
          .insert(schema.messages)
          .values({
            workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'system', // API pública: sem member; 'system' é o sender_type permitido (CHECK)
            type: 'text',
            content: text,
            viewStatus: 'pending',
          })
          .returning();
        return message ? { conv, message } : null;
      });
      if (!result) {
        res.status(404).json({ error: 'not_found', message: 'Conversa não encontrada.' });
        return;
      }

      await publishOutboundJob(workspaceId, {
        kind: 'text',
        channelId: result.conv.channelId,
        conversationId,
        messageId: result.message.id,
        chatId: result.conv.remoteId,
        text,
      });
      res.status(201).json({ message: result.message });
    },
  );

  // ─── POST /api/v1/send_template ─────────────────────────────────────────────
  router.post(
    '/api/v1/send_template',
    auth,
    requireScope(API_SCOPES.sendTemplates),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = sendTemplateBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para send_template.');
      const { conversationId, templateName, languageCode, components } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const result = await withWorkspace(workspaceId, async (tx) => {
        const conv = await resolveConversation(tx, conversationId);
        if (!conv) return null;
        const [message] = await tx
          .insert(schema.messages)
          .values({
            workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'system', // API pública: sem member; 'system' é o sender_type permitido (CHECK)
            type: 'template',
            content: templateName,
            viewStatus: 'pending',
          })
          .returning();
        return message ? { conv, message } : null;
      });
      if (!result) {
        res.status(404).json({ error: 'not_found', message: 'Conversa não encontrada.' });
        return;
      }

      await publishOutboundJob(workspaceId, {
        kind: 'template',
        channelId: result.conv.channelId,
        conversationId,
        messageId: result.message.id,
        chatId: result.conv.remoteId,
        templateName,
        languageCode,
        components,
      });
      res.status(201).json({ message: result.message });
    },
  );

  // ─── POST /api/v1/upsert_contact ────────────────────────────────────────────
  router.post(
    '/api/v1/upsert_contact',
    auth,
    requireScope(API_SCOPES.writeContacts),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = upsertContactBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para upsert_contact.');
      const body = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const outcome = await withWorkspace(workspaceId, async (tx) => {
        // Identidade de match: id explícito > phone > email.
        const existing = await findExistingContact(tx, body);
        const values = {
          displayName: body.displayName ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          notes: body.notes ?? null,
          language: body.language ?? null,
          source: body.source ?? null,
          customFields: body.customFields ?? {},
        };
        if (existing) {
          // Patch parcial: só sobrescreve o que veio no body (não zera campos omitidos).
          const patch: Record<string, unknown> = { updatedAt: new Date() };
          if (body.displayName !== undefined) patch['displayName'] = body.displayName;
          if (body.phone !== undefined) patch['phone'] = body.phone;
          if (body.email !== undefined) patch['email'] = body.email;
          if (body.notes !== undefined) patch['notes'] = body.notes;
          if (body.language !== undefined) patch['language'] = body.language;
          if (body.source !== undefined) patch['source'] = body.source;
          if (body.customFields !== undefined) patch['customFields'] = body.customFields;
          const [updated] = await tx
            .update(schema.contacts)
            .set(patch)
            .where(eq(schema.contacts.id, existing.id))
            .returning();
          return { contact: updated, created: false };
        }
        const [created] = await tx
          .insert(schema.contacts)
          .values({ workspaceId, ...values, source: body.source ?? 'api' })
          .returning();
        return { contact: created, created: true };
      });

      if (!outcome?.contact) {
        res.status(404).json({ error: 'not_found', message: 'Contato não encontrado.' });
        return;
      }
      res.status(200).json({ contact: outcome.contact, created: outcome.created });
    },
  );

  // ─── POST /api/v1/trigger_flow ──────────────────────────────────────────────
  router.post(
    '/api/v1/trigger_flow',
    auth,
    requireScope(API_SCOPES.triggerFlows),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = triggerFlowBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para trigger_flow.');
      const { flowId, conversationId, contactId, triggerData } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      // Confirma que o flow existe e está no workspace da chave (RLS) antes de disparar.
      const exists = await withWorkspace(workspaceId, async (tx) => {
        const [flow] = await tx
          .select({ id: schema.flows.id })
          .from(schema.flows)
          .where(eq(schema.flows.id, flowId))
          .limit(1);
        return Boolean(flow);
      });
      if (!exists) {
        res.status(404).json({ error: 'not_found', message: 'Flow não encontrado.' });
        return;
      }

      const { executionId } = await triggerFlow({
        workspaceId,
        flowId,
        conversationId,
        contactId,
        triggerData,
        triggeredBy: 'api',
      });
      res.status(202).json({ executionId });
    },
  );

  // ─── GET /api/v1/conversations ──────────────────────────────────────────────
  router.get(
    '/api/v1/conversations',
    auth,
    requireScope(API_SCOPES.readConversations),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listConversationsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { status, limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const rows = await withWorkspace(workspaceId, (tx) => {
        const where = status ? eq(schema.conversations.status, status) : undefined;
        return tx
          .select()
          .from(schema.conversations)
          .where(where)
          .orderBy(desc(schema.conversations.lastMessageAt))
          .limit(limit);
      });
      res.json({ conversations: rows });
    },
  );

  // ─── GET /api/v1/conversations/:id ──────────────────────────────────────────
  router.get(
    '/api/v1/conversations/:id',
    auth,
    requireScope(API_SCOPES.readConversations),
    async (req: Request, res: Response): Promise<void> => {
      const id = paramId(req, 'id');
      if (!id) return badRequest(res, 'id ausente.');
      const workspaceId = req.apiAuth!.workspaceId;

      const [conversation] = await withWorkspace(workspaceId, (tx) =>
        tx.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1),
      );
      if (!conversation) {
        res.status(404).json({ error: 'not_found', message: 'Conversa não encontrada.' });
        return;
      }
      res.json({ conversation });
    },
  );

  return router;
}

/** Resolve o contato-alvo do upsert pela identidade fornecida (id > phone > email). */
async function findExistingContact(
  tx: DbTx,
  body: { id?: string; phone?: string; email?: string },
): Promise<{ id: string } | null> {
  if (body.id) {
    const [byId] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, body.id))
      .limit(1);
    return byId ?? null;
  }
  if (body.phone) {
    // Só faz match em contato vivo (deleted_at NULL) — espelha o unique parcial de phone.
    const [byPhone] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.phone, body.phone), isNull(schema.contacts.deletedAt)))
      .limit(1);
    if (byPhone) return byPhone;
  }
  if (body.email) {
    const [byEmail] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.email, body.email), isNull(schema.contacts.deletedAt)))
      .limit(1);
    return byEmail ?? null;
  }
  return null;
}
