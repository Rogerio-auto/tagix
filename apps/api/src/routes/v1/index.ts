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
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { schema, withWorkspace, type DbTx } from '@hm/db';
import { triggerFlow } from '@hm/flow-engine';
import { moveDealToStage, TransitionError } from '../../services/deal-move';
import { createEvent, EventServiceError } from '../../services/event-service';
import { registerConversion } from '../conversions/register';
import swaggerUi from 'swagger-ui-express';
import { requireApiKey, requireScope } from '../../middlewares/api-key';
import { publishOutboundJob } from '../../mq/outbound-publisher';
import { buildOpenApiDocument } from './openapi';
import {
  API_SCOPES,
  createConversionBody,
  createEventBody,
  listContactsQuery,
  listConversationsQuery,
  listConversionsQuery,
  listDealsQuery,
  listEventsQuery,
  listFlowsQuery,
  moveDealBody,
  sendMediaBody,
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

  // ─── GET /api/v1/contacts ───────────────────────────────────────────────────
  router.get(
    '/api/v1/contacts',
    auth,
    requireScope(API_SCOPES.readContacts),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listContactsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { q, limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const rows = await withWorkspace(workspaceId, (tx) => {
        const conds: SQL[] = [isNull(schema.contacts.deletedAt)];
        if (q) {
          const term = `%${q}%`;
          const match = or(
            ilike(schema.contacts.displayName, term),
            ilike(schema.contacts.phone, term),
            ilike(schema.contacts.email, term),
          );
          if (match) conds.push(match);
        }
        return tx
          .select()
          .from(schema.contacts)
          .where(and(...conds))
          .orderBy(desc(schema.contacts.createdAt))
          .limit(limit);
      });
      res.json({ contacts: rows });
    },
  );

  // ─── GET /api/v1/contacts/:id ───────────────────────────────────────────────
  router.get(
    '/api/v1/contacts/:id',
    auth,
    requireScope(API_SCOPES.readContacts),
    async (req: Request, res: Response): Promise<void> => {
      const id = paramId(req, 'id');
      if (!id) return badRequest(res, 'id ausente.');
      const workspaceId = req.apiAuth!.workspaceId;
      const [contact] = await withWorkspace(workspaceId, (tx) =>
        tx
          .select()
          .from(schema.contacts)
          .where(and(eq(schema.contacts.id, id), isNull(schema.contacts.deletedAt)))
          .limit(1),
      );
      if (!contact) {
        res.status(404).json({ error: 'not_found', message: 'Contato não encontrado.' });
        return;
      }
      res.json({ contact });
    },
  );

  // ─── POST /api/v1/messages/media ────────────────────────────────────────────
  router.post(
    '/api/v1/messages/media',
    auth,
    requireScope(API_SCOPES.sendMessages),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = sendMediaBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para send_media.');
      const { conversationId, mediaKind, mediaUrl, mime, caption } = parsed.data;
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
            senderType: 'system',
            type: mediaKind,
            content: caption ?? null,
            mediaUrl,
            mediaMime: mime,
            mediaCaption: caption ?? null,
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
        kind: 'media',
        channelId: result.conv.channelId,
        conversationId,
        messageId: result.message.id,
        chatId: result.conv.remoteId,
        mediaKind,
        publicMediaUrl: mediaUrl,
        mime,
        ...(caption ? { caption } : {}),
      });
      res.status(201).json({ message: result.message });
    },
  );

  // ─── GET /api/v1/deals ──────────────────────────────────────────────────────
  router.get(
    '/api/v1/deals',
    auth,
    requireScope(API_SCOPES.readDeals),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listDealsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { pipelineId, stageId, contactId, limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const rows = await withWorkspace(workspaceId, (tx) => {
        const conds: SQL[] = [];
        if (pipelineId) conds.push(eq(schema.deals.pipelineId, pipelineId));
        if (stageId) conds.push(eq(schema.deals.stageId, stageId));
        if (contactId) conds.push(eq(schema.deals.contactId, contactId));
        return tx
          .select()
          .from(schema.deals)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(schema.deals.createdAt))
          .limit(limit);
      });
      res.json({ deals: rows });
    },
  );

  // ─── GET /api/v1/deals/:id ──────────────────────────────────────────────────
  router.get(
    '/api/v1/deals/:id',
    auth,
    requireScope(API_SCOPES.readDeals),
    async (req: Request, res: Response): Promise<void> => {
      const id = paramId(req, 'id');
      if (!id) return badRequest(res, 'id ausente.');
      const workspaceId = req.apiAuth!.workspaceId;
      const [deal] = await withWorkspace(workspaceId, (tx) =>
        tx.select().from(schema.deals).where(eq(schema.deals.id, id)).limit(1),
      );
      if (!deal) {
        res.status(404).json({ error: 'not_found', message: 'Deal não encontrado.' });
        return;
      }
      res.json({ deal });
    },
  );

  // ─── POST /api/v1/deals/:id/move ────────────────────────────────────────────
  router.post(
    '/api/v1/deals/:id/move',
    auth,
    requireScope(API_SCOPES.writeDeals),
    async (req: Request, res: Response): Promise<void> => {
      const id = paramId(req, 'id');
      if (!id) return badRequest(res, 'id ausente.');
      const parsed = moveDealBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para move_deal_stage.');
      const { stageId } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      try {
        const out = await withWorkspace(workspaceId, (tx) =>
          moveDealToStage(tx, { dealId: id, newStageId: stageId, workspaceId, actor: { type: 'api' } }),
        );
        res.json({ deal: out.deal, fromStageId: out.fromStageId, toStageId: out.toStageId });
      } catch (err: unknown) {
        if (err instanceof TransitionError) {
          res.status(422).json({ error: err.code, message: err.message });
          return;
        }
        const code = err instanceof Error ? err.message : 'error';
        if (code === 'deal_not_found' || code === 'stage_not_found') {
          res.status(404).json({ error: 'not_found', message: 'Deal ou stage não encontrado.' });
          return;
        }
        throw err;
      }
    },
  );

  // ─── POST /api/v1/conversions ───────────────────────────────────────────────
  router.post(
    '/api/v1/conversions',
    auth,
    requireScope(API_SCOPES.writeConversions),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = createConversionBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para create_conversion.');
      const body = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      // Dedup same-day: `registerConversion` captura a violação UNIQUE mas NÃO faz
      // ROLLBACK do statement, o que envenena a transação RLS e estoura no commit.
      // Como o repo de conversões (register.ts) está fora do escopo deste slot,
      // pré-checamos a existência de um evento same-day (não cancelado) e curto-
      // circuitamos em `deduped` — sem o INSERT que aborta a transação. Ver COMMS.
      const result = await withWorkspace(workspaceId, async (tx) => {
        const [type] = await tx
          .select({ id: schema.conversionTypes.id })
          .from(schema.conversionTypes)
          .where(
            and(
              eq(schema.conversionTypes.workspaceId, workspaceId),
              eq(schema.conversionTypes.key, body.conversionTypeKey),
            ),
          )
          .limit(1);
        if (!type) return { kind: 'type_not_found' as const };

        const [dup] = await tx
          .select({ id: schema.conversionEvents.id })
          .from(schema.conversionEvents)
          .where(
            and(
              eq(schema.conversionEvents.conversionTypeId, type.id),
              eq(schema.conversionEvents.contactId, body.contactId),
              isNull(schema.conversionEvents.cancelledAt),
              sql`(${schema.conversionEvents.occurredAt} at time zone 'UTC')::date = (now() at time zone 'UTC')::date`,
            ),
          )
          .limit(1);
        if (dup) return { kind: 'deduped' as const };

        return registerConversion(tx, {
          workspaceId,
          conversionTypeId: type.id,
          contactId: body.contactId,
          conversationId: body.conversationId ?? null,
          dealId: body.dealId ?? null,
          valueCents: body.valueCents ?? null,
          currency: body.currency,
          note: body.note ?? null,
          source: 'api',
        });
      });

      if (result.kind === 'type_not_found') {
        res.status(404).json({ error: 'not_found', message: 'Tipo de conversão não encontrado.' });
        return;
      }
      if (result.kind === 'value_required') {
        res.status(422).json({ error: 'value_required', message: 'Este tipo de conversão exige valueCents.' });
        return;
      }
      if (result.kind === 'deduped') {
        res.status(200).json({ status: 'deduped', conversion: null });
        return;
      }
      res.status(201).json({ status: 'created', conversion: result.event });
    },
  );

  // ─── GET /api/v1/conversions ────────────────────────────────────────────────
  router.get(
    '/api/v1/conversions',
    auth,
    requireScope(API_SCOPES.readConversions),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listConversionsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { contactId, limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const rows = await withWorkspace(workspaceId, (tx) =>
        tx
          .select()
          .from(schema.conversionEvents)
          .where(contactId ? eq(schema.conversionEvents.contactId, contactId) : undefined)
          .orderBy(desc(schema.conversionEvents.occurredAt))
          .limit(limit),
      );
      res.json({ conversions: rows });
    },
  );

  // ─── GET /api/v1/flows ──────────────────────────────────────────────────────
  router.get(
    '/api/v1/flows',
    auth,
    requireScope(API_SCOPES.readFlows),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listFlowsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;
      const rows = await withWorkspace(workspaceId, (tx) =>
        tx.select().from(schema.flows).orderBy(desc(schema.flows.createdAt)).limit(limit),
      );
      res.json({ flows: rows });
    },
  );

  // ─── GET /api/v1/events ─────────────────────────────────────────────────────
  router.get(
    '/api/v1/events',
    auth,
    requireScope(API_SCOPES.readCalendar),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = listEventsQuery.safeParse(req.query);
      if (!parsed.success) return badRequest(res, 'Query inválida.');
      const { from, to, limit } = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      const rows = await withWorkspace(workspaceId, (tx) => {
        const conds: SQL[] = [];
        if (from) conds.push(gte(schema.events.startAt, new Date(from)));
        if (to) conds.push(lte(schema.events.startAt, new Date(to)));
        return tx
          .select()
          .from(schema.events)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(asc(schema.events.startAt))
          .limit(limit);
      });
      res.json({ events: rows });
    },
  );

  // ─── POST /api/v1/events ────────────────────────────────────────────────────
  router.post(
    '/api/v1/events',
    auth,
    requireScope(API_SCOPES.writeCalendar),
    async (req: Request, res: Response): Promise<void> => {
      const parsed = createEventBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, 'Body inválido para create_event.');
      const body = parsed.data;
      const workspaceId = req.apiAuth!.workspaceId;

      try {
        const event = await withWorkspace(workspaceId, (tx) =>
          createEvent(
            tx,
            {
              workspaceId,
              calendarId: body.calendarId,
              title: body.title,
              startAt: new Date(body.startAt),
              endAt: new Date(body.endAt),
              type: body.type,
              description: body.description ?? null,
              location: body.location ?? null,
              contactId: body.contactId ?? null,
            },
            { type: 'api' },
          ),
        );
        res.status(201).json({ event });
      } catch (err: unknown) {
        if (err instanceof EventServiceError) {
          res.status(err.status).json({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }
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
