import { Router, type Request, type Response } from 'express';
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  MetaTemplateError,
  MetaTemplatesClient,
  validateMetaTemplateCreateInput,
  type MetaTemplateCreateInput,
} from '@hm/channels';
import { decryptSecret, schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../../middlewares/auth';
import {
  claimTemplateSync,
  loadTemplateChannel,
  markTemplateSyncFailed,
  persistCreatedTemplate,
  reconcileTemplates,
  type TemplateChannelLookup,
} from './service';

const listQuerySchema = z.object({
  status: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().max(120).optional(),
  availability: z.enum(['all', 'available', 'unavailable']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const createTemplateSchema = z
  .object({
    name: z.string().min(1).max(512),
    language: z.string().min(1).max(40),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    components: z.array(z.record(z.unknown())).min(1).max(10),
    allowCategoryChange: z.boolean().optional(),
  })
  .strict();

type TemplatesClient = Pick<MetaTemplatesClient, 'listAll' | 'create'>;

export interface MessageTemplatesRouterOptions {
  readonly client?: TemplatesClient;
  readonly now?: () => Date;
  readonly decrypt?: typeof decryptSecret;
}

function channelId(req: Request): string {
  const value = req.params['id'];
  return typeof value === 'string' ? value : '';
}

function sendChannelError(res: Response, lookup: Exclude<TemplateChannelLookup, { ok: true }>): void {
  const responses = {
    not_found: {
      status: 404,
      code: 'MESSAGE_TEMPLATE_CHANNEL_NOT_FOUND',
      message: 'Canal não encontrado neste workspace.',
    },
    wrong_provider: {
      status: 422,
      code: 'MESSAGE_TEMPLATE_UNSUPPORTED_CHANNEL',
      message: 'Modelos estão disponíveis somente para canais oficiais do WhatsApp.',
    },
    inactive: {
      status: 409,
      code: 'MESSAGE_TEMPLATE_CHANNEL_INACTIVE',
      message: 'Reconecte e ative o canal do WhatsApp antes de usar modelos.',
    },
    missing_credentials: {
      status: 409,
      code: 'MESSAGE_TEMPLATE_CHANNEL_CREDENTIALS_MISSING',
      message: 'Reconecte o canal do WhatsApp para restaurar a credencial de acesso.',
    },
  } as const;
  const response = responses[lookup.reason];
  res.status(response.status).json({ code: response.code, message: response.message });
}

function metaErrorResponse(res: Response, error: unknown): void {
  if (!(error instanceof MetaTemplateError)) {
    res.status(503).json({
      code: 'MESSAGE_TEMPLATE_PROVIDER_UNAVAILABLE',
      message: 'Não foi possível falar com a Meta agora. Tente novamente.',
    });
    return;
  }
  if (error.retryAfterMs !== undefined) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
  }
  const status =
    error.kind === 'validation'
      ? 400
      : error.kind === 'rate_limit'
        ? 429
        : error.permanence === 'permanent'
          ? 422
          : 503;
  const messages = {
    validation: 'Revise os campos indicados antes de enviar o modelo.',
    authentication: 'A credencial do canal expirou. Reconecte o WhatsApp.',
    permission: 'A Meta não autorizou esta ação. Revise as permissões do canal.',
    payload: 'A Meta recusou os dados do modelo. Revise o conteúdo e tente novamente.',
    rate_limit: 'A Meta limitou as solicitações. Aguarde e tente novamente.',
    unavailable: 'A Meta está temporariamente indisponível. Tente novamente.',
    timeout: 'A Meta demorou para responder. Tente novamente.',
    network: 'Não foi possível conectar à Meta. Tente novamente.',
    invalid_response: 'A Meta devolveu uma resposta inválida. Sincronize novamente.',
    pagination: 'A lista da Meta não pôde ser concluída com segurança. Tente novamente.',
  } as const;
  res.status(status).json({
    code: `MESSAGE_TEMPLATE_${error.kind.toUpperCase()}`,
    message: messages[error.kind],
    retryable: error.retryable,
    ...(error.issues === undefined
      ? {}
      : {
          issues: error.issues.map((issue) => ({
            path: issue.path.split('.').map((part) =>
              /^\d+$/.test(part) ? Number(part) : part,
            ),
            code: issue.code,
            message: 'Revise este campo para atender às regras de modelos do WhatsApp.',
          })),
        }),
  });
}

export function createMessageTemplatesRouter(options: MessageTemplatesRouterOptions = {}): Router {
  const router = Router();
  const client = options.client ?? new MetaTemplatesClient();
  const now = options.now ?? (() => new Date());
  const decrypt = options.decrypt ?? decryptSecret;

  router.get(
    '/api/channels/:id/message-templates',
    requireAuth,
    withRLS,
    requireRole('message_template.view'),
    async (req: Request, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ code: 'MESSAGE_TEMPLATE_INVALID_FILTERS', message: 'Filtros inválidos.' });
        return;
      }
      const workspaceId = req.auth!.workspace.id;
      const id = channelId(req);
      const lookup = await req.scoped!((tx) => loadTemplateChannel(tx, workspaceId, id));
      if (!lookup.ok) {
        sendChannelError(res, lookup);
        return;
      }

      const query = parsed.data;
      const conditions: SQL[] = [
        eq(schema.channelMessageTemplates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplates.channelId, id),
      ];
      if (query.status) conditions.push(eq(schema.channelMessageTemplates.status, query.status));
      if (query.category) conditions.push(eq(schema.channelMessageTemplates.category, query.category));
      if (query.language) conditions.push(eq(schema.channelMessageTemplates.language, query.language));
      if (query.search) conditions.push(ilike(schema.channelMessageTemplates.name, `%${query.search}%`));
      if (query.availability !== 'all') {
        conditions.push(
          eq(schema.channelMessageTemplates.isAvailable, query.availability === 'available'),
        );
      }
      const offset = (query.page - 1) * query.limit;
      const result = await req.scoped!(async (tx) => {
        const where = and(...conditions);
        const [templates, [count], [syncState]] = await Promise.all([
          tx
            .select()
            .from(schema.channelMessageTemplates)
            .where(where)
            .orderBy(desc(schema.channelMessageTemplates.lastSyncedAt), asc(schema.channelMessageTemplates.name))
            .limit(query.limit)
            .offset(offset),
          tx
            .select({ total: sql<number>`count(*)::int` })
            .from(schema.channelMessageTemplates)
            .where(where),
          tx
            .select()
            .from(schema.channelMessageTemplateSyncStates)
            .where(
              and(
                eq(schema.channelMessageTemplateSyncStates.workspaceId, workspaceId),
                eq(schema.channelMessageTemplateSyncStates.channelId, id),
              ),
            )
            .limit(1),
        ]);
        return { templates, total: count?.total ?? 0, syncState };
      });
      res.json({
        templates: result.templates,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / query.limit),
        },
        syncState: result.syncState ?? {
          syncStatus: 'idle',
          lastAttemptAt: null,
          lastSuccessfulSyncAt: null,
          lastFailedAt: null,
          lastError: null,
          lastItemCount: null,
        },
      });
    },
  );

  router.post(
    '/api/channels/:id/message-templates/sync',
    requireAuth,
    withRLS,
    requireRole('message_template.manage'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const id = channelId(req);
      const startedAt = now();
      const prepared = await req.scoped!(async (tx) => {
        const lookup = await loadTemplateChannel(tx, workspaceId, id);
        if (!lookup.ok) return { lookup } as const;
        const claim = await claimTemplateSync(tx, workspaceId, id, startedAt);
        return { lookup, claim } as const;
      });
      if (!prepared.lookup.ok) {
        sendChannelError(res, prepared.lookup);
        return;
      }
      const claim = 'claim' in prepared ? prepared.claim : undefined;
      if (claim === undefined) {
        res.sendStatus(500);
        return;
      }
      if (!claim.acquired) {
        res.setHeader('Retry-After', String(claim.retryAfterSeconds ?? 1));
        res.status(409).json({
          code: 'MESSAGE_TEMPLATE_SYNC_IN_PROGRESS',
          message: 'Já existe uma sincronização em andamento para este canal.',
        });
        return;
      }

      let accessToken: string;
      try {
        accessToken = decrypt(
          prepared.lookup.value.accessTokenEnc,
          prepared.lookup.value.keyVersion,
        );
      } catch {
        await req.scoped!((tx) =>
          markTemplateSyncFailed(tx, workspaceId, id, now(), 'authentication'),
        );
        res.status(409).json({
          code: 'MESSAGE_TEMPLATE_CHANNEL_CREDENTIALS_INVALID',
          message: 'Reconecte o canal do WhatsApp para restaurar a credencial de acesso.',
        });
        return;
      }

      try {
        const templates = await client.listAll({
          wabaId: prepared.lookup.value.wabaId,
          accessToken,
        });
        const completedAt = now();
        const summary = await req.scoped!((tx) =>
          reconcileTemplates(tx, workspaceId, id, templates, completedAt),
        );
        res.json({ summary });
      } catch (error: unknown) {
        const safeError = error instanceof MetaTemplateError ? error.kind : 'unavailable';
        await req.scoped!((tx) =>
          markTemplateSyncFailed(tx, workspaceId, id, now(), safeError),
        );
        metaErrorResponse(res, error);
      }
    },
  );

  router.post(
    '/api/channels/:id/message-templates',
    requireAuth,
    withRLS,
    requireRole('message_template.manage'),
    async (req: Request, res: Response) => {
      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          code: 'MESSAGE_TEMPLATE_VALIDATION',
          message: 'Revise os campos indicados antes de enviar o modelo.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        });
        return;
      }
      const template = parsed.data as unknown as MetaTemplateCreateInput;
      try {
        validateMetaTemplateCreateInput(template);
      } catch (error: unknown) {
        metaErrorResponse(res, error);
        return;
      }

      const workspaceId = req.auth!.workspace.id;
      const id = channelId(req);
      const lookup = await req.scoped!((tx) => loadTemplateChannel(tx, workspaceId, id));
      if (!lookup.ok) {
        sendChannelError(res, lookup);
        return;
      }
      let accessToken: string;
      try {
        accessToken = decrypt(lookup.value.accessTokenEnc, lookup.value.keyVersion);
      } catch {
        res.status(409).json({
          code: 'MESSAGE_TEMPLATE_CHANNEL_CREDENTIALS_INVALID',
          message: 'Reconecte o canal do WhatsApp para restaurar a credencial de acesso.',
        });
        return;
      }

      let created;
      try {
        created = await client.create({ wabaId: lookup.value.wabaId, accessToken, template });
      } catch (error: unknown) {
        metaErrorResponse(res, error);
        return;
      }

      try {
        const persisted = await req.scoped!((tx) =>
          persistCreatedTemplate(tx, workspaceId, id, created, now()),
        );
        res.status(201).json({ template: persisted });
      } catch {
        res.status(503).json({
          code: 'MESSAGE_TEMPLATE_CREATED_NOT_SAVED',
          message: 'O modelo foi enviado à Meta, mas não foi salvo aqui. Sincronize antes de tentar criar novamente.',
          providerAccepted: true,
        });
      }
    },
  );

  return router;
}
