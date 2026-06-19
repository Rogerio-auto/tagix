/**
 * Rotas de canais (DATA_MODEL §6.1/6.2; PERMISSIONS §2.6).
 *
 * Endpoints:
 *   GET    /api/channels                 — lista canais do workspace (RLS-escopada)
 *   POST   /api/channels/connect         — conecta um canal (Meta WhatsApp/IG via FB Login, ou WAHA)
 *   PATCH  /api/channels/:id/disable     — ativa/desativa um canal
 *   DELETE /api/channels/:id             — remove um canal (OWNER)
 *
 * Segredos (access/app/api tokens) são cifrados via @hm/db crypto e NUNCA
 * retornados em texto plano — o cliente só vê status e metadados públicos.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { encryptSecret, schema } from '@hm/db';
import { GraphClient } from '@hm/channels';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  IgConnectError,
  listInstagramAccounts,
  subscribeInstagramWebhook,
  sendInstagramTestMessage,
} from '../../services/channels/instagram-connect';
import {
  WaConnectError,
  exchangeCodeForToken,
  registerPhoneNumber,
  subscribeWabaApp,
} from '../../services/channels/whatsapp-connect';
import { platformSecrets } from '../../secrets';

/**
 * Campos de canal seguros para devolver ao cliente. NUNCA inclui colunas de
 * `channel_secrets`. `hasSecret` indica se há credencial cifrada associada,
 * sem expor qualquer parte dela.
 */
const PUBLIC_CHANNEL_COLUMNS = {
  id: schema.channels.id,
  provider: schema.channels.provider,
  name: schema.channels.name,
  displayHandle: schema.channels.displayHandle,
  phoneNumber: schema.channels.phoneNumber,
  igUsername: schema.channels.igUsername,
  igAccountType: schema.channels.igAccountType,
  wahaSessionId: schema.channels.wahaSessionId,
  isActive: schema.channels.isActive,
  isDefault: schema.channels.isDefault,
  createdAt: schema.channels.createdAt,
  updatedAt: schema.channels.updatedAt,
} as const;

/**
 * Payload de conexão — discriminado por `provider`. Cada provider exige as
 * colunas que o `channels_provider_columns` CHECK do schema obriga, mais o
 * token de acesso (cifrado antes de persistir).
 *
 * Meta (WhatsApp/Instagram): `accessToken` é o token de longa duração obtido
 * no fluxo de FB Login no cliente (ver seam documentado no frontend).
 * WAHA: `accessToken` é a API key da sessão.
 */
const connectSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('meta_whatsapp'),
    name: z.string().trim().min(1).max(120),
    displayHandle: z.string().trim().min(1).max(120).optional(),
    phoneNumber: z.string().trim().min(1).max(32).optional(),
    phoneNumberId: z.string().trim().min(1).max(64),
    wabaId: z.string().trim().min(1).max(64),
    accessToken: z.string().trim().min(1),
    appSecret: z.string().trim().min(1).optional(),
  }),
  z.object({
    provider: z.literal('meta_instagram'),
    name: z.string().trim().min(1).max(120),
    displayHandle: z.string().trim().min(1).max(120).optional(),
    igUserId: z.string().trim().min(1).max(64),
    igUsername: z.string().trim().min(1).max(120).optional(),
    igAccountType: z.enum(['business', 'creator']).optional(),
    fbPageId: z.string().trim().min(1).max(64),
    accessToken: z.string().trim().min(1),
    appSecret: z.string().trim().min(1).optional(),
  }),
  z.object({
    provider: z.literal('waha'),
    name: z.string().trim().min(1).max(120),
    displayHandle: z.string().trim().min(1).max(120).optional(),
    wahaSessionId: z.string().trim().min(1).max(120),
    apiKey: z.string().trim().min(1),
  }),
]);

const disableSchema = z.object({ isActive: z.boolean() });

/** Wizard IG: lista contas a partir do user access token do Embedded Signup. */
const igAccountsSchema = z.object({
  userAccessToken: z.string().trim().min(1),
});

/** Wizard IG: conecta a conta escolhida (subscribe + create + token cifrado + test). */
const igConnectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  pageId: z.string().trim().min(1).max(64),
  pageAccessToken: z.string().trim().min(1),
  igUserId: z.string().trim().min(1).max(64),
  igUsername: z.string().trim().min(1).max(120).optional(),
  igAccountType: z.enum(['business', 'creator']).optional(),
  appSecret: z.string().trim().min(1).optional(),
  /** IGSID alvo da mensagem de teste (default: o proprio dono). Opcional. */
  testRecipientIgsid: z.string().trim().min(1).max(64).optional(),
});

/**
 * Wizard WA: connect server-side (Embedded Signup / Tech Provider). Troca o
 * `code` por token long-lived, registra o numero (PIN), inscreve a WABA no app
 * (subscribed_apps — com campos de coexistencia quando `mode=coexistence`),
 * cria o canal e cifra o token. O token NUNCA volta ao cliente.
 */
const waConnectSchema = z.object({
  code: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1).max(64),
  wabaId: z.string().trim().min(1).max(64),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O PIN do WhatsApp deve ter 6 digitos.'),
  mode: z.enum(['cloud_api', 'coexistence']),
  name: z.string().trim().min(1).max(120),
  phoneNumber: z.string().trim().min(1).max(32).optional(),
  displayHandle: z.string().trim().min(1).max(120).optional(),
});

/** Narrowing de `req.params['x']` (string | string[] no @types/express 5). */
function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

export function createChannelsRouter(): Router {
  const router = Router();

  // GET /api/channels — lista canais do workspace (RLS-escopada). Sem segredos.
  router.get(
    '/api/channels',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const rows = await req.scoped!((tx) =>
        tx
          .select(PUBLIC_CHANNEL_COLUMNS)
          .from(schema.channels)
          .orderBy(asc(schema.channels.createdAt)),
      );
      res.json({ channels: rows });
    },
  );

  // POST /api/channels/connect — cria um canal + segredo cifrado (transação RLS).
  router.post(
    '/api/channels/connect',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const parsed = connectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados de conexão inválidos.' });
        return;
      }
      const input = parsed.data;
      const workspaceId = req.auth!.workspace.id;

      const created = await req.scoped!(async (tx) => {
        // Monta as colunas específicas do provider — o CHECK do schema garante
        // coerência, mas inserimos só o que o provider exige.
        const base = {
          workspaceId,
          provider: input.provider,
          name: input.name,
          displayHandle: input.displayHandle ?? null,
        };

        const values =
          input.provider === 'meta_whatsapp'
            ? {
                ...base,
                phoneNumber: input.phoneNumber ?? null,
                phoneNumberId: input.phoneNumberId,
                wabaId: input.wabaId,
              }
            : input.provider === 'meta_instagram'
              ? {
                  ...base,
                  igUserId: input.igUserId,
                  igUsername: input.igUsername ?? null,
                  igAccountType: input.igAccountType ?? null,
                  fbPageId: input.fbPageId,
                }
              : {
                  ...base,
                  wahaSessionId: input.wahaSessionId,
                };

        const [channel] = await tx
          .insert(schema.channels)
          .values(values)
          .returning(PUBLIC_CHANNEL_COLUMNS);

        if (!channel) throw new Error('Falha ao criar canal.');

        // Cifra e persiste o segredo. Meta usa accessToken (+ appSecret opcional);
        // WAHA usa apiKey. Nada disso volta ao cliente.
        const secretValues =
          input.provider === 'waha'
            ? { channelId: channel.id, accessTokenEnc: encryptSecret(input.apiKey), apiKeyEnc: encryptSecret(input.apiKey) }
            : {
                channelId: channel.id,
                accessTokenEnc: encryptSecret(input.accessToken),
                appSecretEnc: input.appSecret ? encryptSecret(input.appSecret) : null,
              };

        await tx.insert(schema.channelSecrets).values(secretValues);

        return channel;
      });

      res.status(201).json({ channel: created });
    },
  );

  // PATCH /api/channels/:id/disable — ativa/desativa (channel.disable = ADMINS).
  router.patch(
    '/api/channels/:id/disable',
    requireAuth,
    withRLS,
    requireRole('channel.disable'),
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      if (!id) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = disableSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Payload inválido.' });
        return;
      }

      const [updated] = await req.scoped!((tx) =>
        tx
          .update(schema.channels)
          .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
          .where(eq(schema.channels.id, id))
          .returning(PUBLIC_CHANNEL_COLUMNS),
      );

      if (!updated) {
        res.status(404).json({ message: 'Canal não encontrado.' });
        return;
      }
      res.json({ channel: updated });
    },
  );

  // DELETE /api/channels/:id — remove canal (channel.delete = OWNER).
  // `channel_secrets` cai por ON DELETE CASCADE.
  router.delete(
    '/api/channels/:id',
    requireAuth,
    withRLS,
    requireRole('channel.delete'),
    async (req: Request, res: Response) => {
      const id = param(req, 'id');
      if (!id) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const [deleted] = await req.scoped!((tx) =>
        tx
          .delete(schema.channels)
          .where(and(eq(schema.channels.id, id)))
          .returning({ id: schema.channels.id }),
      );
      if (!deleted) {
        res.status(404).json({ message: 'Canal não encontrado.' });
        return;
      }
      res.status(204).end();
    },
  );

  // --- Wizard Instagram (Embedded Signup / Tech Provider — INSTAGRAM.md 12.1) ---

  // POST /api/channels/instagram/accounts — lista Page+IGBA a partir do user token.
  router.post(
    '/api/channels/instagram/accounts',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const parsed = igAccountsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'userAccessToken obrigatorio.' });
        return;
      }
      try {
        const accounts = await listInstagramAccounts(new GraphClient(), parsed.data.userAccessToken);
        // Nunca devolve o pageAccessToken em claro? Ele e necessario no proximo passo;
        // o frontend o reenvia ao /connect. Mantido apenas em transito (TLS), nunca logado.
        res.json({
          accounts: accounts.map((a) => ({
            pageId: a.pageId,
            pageName: a.pageName,
            pageAccessToken: a.pageAccessToken,
            igUserId: a.igUserId,
            igUsername: a.igUsername,
            igAccountType: a.igAccountType,
          })),
        });
      } catch (err: unknown) {
        if (err instanceof IgConnectError) {
          res.status(422).json({ code: err.code, message: err.message });
          return;
        }
        res.status(502).json({ code: 'IG_CONNECT_GRAPH_ERROR', message: 'Falha ao consultar a Meta. Tente novamente.' });
      }
    },
  );

  // POST /api/channels/instagram/connect — subscribe webhook + cria canal + test.
  router.post(
    '/api/channels/instagram/connect',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const parsed = igConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados de conexao Instagram invalidos.' });
        return;
      }
      const input = parsed.data;
      const workspaceId = req.auth!.workspace.id;
      const graph = new GraphClient();

      // 1) Subscreve Page+IGBA no webhook do app (idempotente do lado Meta).
      try {
        await subscribeInstagramWebhook(graph, input.pageId, input.pageAccessToken);
      } catch (err: unknown) {
        const message = err instanceof IgConnectError ? err.message : 'Falha ao subscrever o webhook na Meta.';
        res.status(502).json({ code: 'IG_CONNECT_SUBSCRIBE_FAILED', message });
        return;
      }

      // 2) Cria o canal + cifra o token (mesmo padrao WA). Tudo sob RLS.
      const created = await req.scoped!(async (tx) => {
        const [channel] = await tx
          .insert(schema.channels)
          .values({
            workspaceId,
            provider: 'meta_instagram',
            name: input.name,
            displayHandle: input.igUsername ?? null,
            igUserId: input.igUserId,
            igUsername: input.igUsername ?? null,
            igAccountType: input.igAccountType ?? null,
            fbPageId: input.pageId,
            isActive: true,
          })
          .returning(PUBLIC_CHANNEL_COLUMNS);
        if (!channel) throw new Error('Falha ao criar canal Instagram.');

        await tx.insert(schema.channelSecrets).values({
          channelId: channel.id,
          accessTokenEnc: encryptSecret(input.pageAccessToken),
          appSecretEnc: input.appSecret ? encryptSecret(input.appSecret) : null,
        });
        return channel;
      });

      // 3) Mensagem de teste (best-effort — nao bloqueia a criacao do canal).
      let testMessageSent = false;
      if (input.testRecipientIgsid !== undefined) {
        try {
          testMessageSent = await sendInstagramTestMessage(
            graph,
            input.igUserId,
            input.testRecipientIgsid,
            input.pageAccessToken,
          );
        } catch {
          testMessageSent = false;
        }
      }

      res.status(201).json({ channel: created, testMessageSent });
    },
  );

  // --- Wizard WhatsApp (Embedded Signup / Tech Provider — server-side) ---

  // POST /api/channels/whatsapp/connect — exchange code → register → subscribe →
  // cria canal meta_whatsapp + cifra token long-lived. Dispatch por `mode`.
  router.post(
    '/api/channels/whatsapp/connect',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const parsed = waConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Dados de conexao WhatsApp invalidos.' });
        return;
      }
      const input = parsed.data;
      const workspaceId = req.auth!.workspace.id;

      const appId = platformSecrets.get('meta_app_id');
      const appSecret = platformSecrets.get('meta_app_secret');
      if (appId === undefined || appSecret === undefined) {
        res.status(503).json({
          code: 'WA_CONNECT_APP_NOT_CONFIGURED',
          message: 'Credenciais do app Meta nao configuradas na plataforma.',
        });
        return;
      }

      const graph = new GraphClient();
      const coexistence = input.mode === 'coexistence';

      // 1) Orquestra Graph: exchange → register → subscribe. Falha em qualquer
      // etapa aborta antes de criar o canal (token cifrado so se tudo passou).
      let token: string;
      try {
        token = await exchangeCodeForToken(graph, input.code, appId, appSecret);
        await registerPhoneNumber(graph, input.phoneNumberId, input.pin, token);
        await subscribeWabaApp(graph, input.wabaId, token, { coexistence });
      } catch (err: unknown) {
        if (err instanceof WaConnectError) {
          res.status(422).json({ code: err.code, message: err.message });
          return;
        }
        res.status(502).json({
          code: 'WA_CONNECT_GRAPH_ERROR',
          message: 'Falha ao conectar o WhatsApp na Meta. Tente novamente.',
        });
        return;
      }

      // 2) Cria o canal + cifra o token (mesmo padrao do connect legado). Tudo
      // sob RLS. O `mode` persiste em `metadata` (jsonb) — sem migracao de schema.
      const created = await req.scoped!(async (tx) => {
        const [channel] = await tx
          .insert(schema.channels)
          .values({
            workspaceId,
            provider: 'meta_whatsapp',
            name: input.name,
            displayHandle: input.displayHandle ?? null,
            phoneNumber: input.phoneNumber ?? null,
            phoneNumberId: input.phoneNumberId,
            wabaId: input.wabaId,
            metadata: { waConnectMode: input.mode },
            isActive: true,
          })
          .returning(PUBLIC_CHANNEL_COLUMNS);
        if (!channel) throw new Error('Falha ao criar canal WhatsApp.');

        await tx.insert(schema.channelSecrets).values({
          channelId: channel.id,
          accessTokenEnc: encryptSecret(token),
        });
        return channel;
      });

      res.status(201).json({ channel: created });
    },
  );

  return router;
}
