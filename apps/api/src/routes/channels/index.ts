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
import { decryptSecret, encryptSecret, metaConnectionsRepo, schema } from '@hm/db';
import { GraphClient, MetaError } from '@hm/channels';
import { createLogger } from '@hm/logger';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import {
  IgConnectError,
  listInstagramAccounts,
  subscribeInstagramWebhook,
  sendInstagramTestMessage,
} from '../../services/channels/instagram-connect';
import { WaConnectError, runWhatsAppConnect } from '../../services/channels/whatsapp-connect';
import { platformSecrets } from '../../secrets';
import { missingByUseCase } from '../../services/meta/permissions';
import { createMessageTemplatesRouter } from './templates';

// Logger do connect de canais. As falhas de connect Meta (exchange/register/
// subscribe) eram invisíveis: a rota devolvia 502 genérico e descartava o motivo
// real da Graph. Aqui logamos código/subcódigo/mensagem da Meta (sem segredos)
// e devolvemos a razão real ao cliente — diagnóstico de connect deixa de ser cego.
const connectLogger = createLogger('info', { svc: 'channel-connect' });

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

/**
 * Wizard IG: lista as contas a partir da CONEXÃO Meta do workspace (F69-S02).
 *
 * Antes recebia o token de usuário do navegador e devolvia o token de cada página
 * para o navegador reenviar no passo seguinte. Agora o navegador só conhece o id
 * da conexão; todo token fica no servidor.
 */
const igAccountsSchema = z.object({
  connectionId: z.string().uuid(),
});

/**
 * Wizard IG: conecta a conta escolhida (subscribe + create + token cifrado + test).
 *
 * Sem `pageAccessToken` e sem `appSecret` vindos do cliente: o token da página é
 * obtido no servidor a partir da conexão, e o App Secret é da plataforma. Aceitar
 * segredo digitado no navegador era guardar, cifrado, algo que nenhum código lia.
 */
const igConnectSchema = z.object({
  connectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  pageId: z.string().trim().min(1).max(64),
  igUserId: z.string().trim().min(1).max(64),
  igUsername: z.string().trim().min(1).max(120).optional(),
  igAccountType: z.enum(['business', 'creator']).optional(),
  /** IGSID alvo da mensagem de teste (default: o proprio dono). Opcional. */
  testRecipientIgsid: z.string().trim().min(1).max(64).optional(),
});

/**
 * Wizard WA: connect server-side (Embedded Signup / Tech Provider). Troca o
 * `code` por token long-lived, inscreve a WABA no app (subscribed_apps — com
 * campos de coexistencia quando `mode=coexistence`), cria o canal e cifra o token.
 * O token NUNCA volta ao cliente.
 *
 * **Sem PIN / sem /register:** a Graph rejeita `/{phone_number_id}/register` para
 * numeros SMB ("Register endpoint is not available for SMB businesses", code 100) —
 * confirmado em producao 2026-06-20. Na coexistencia o numero ja e verificado no
 * app WhatsApp Business durante o Embedded Signup; numero novo (`cloud_api`) e
 * provisionado pelo proprio Signup. `pin` permanece opcional/ignorado (compat).
 */
const waConnectSchema = z.object({
  code: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1).max(64),
  wabaId: z.string().trim().min(1).max(64),
  pin: z.string().trim().optional(),
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

/**
 * Token de usuário da conexão Meta do workspace — só no servidor (F69-S02).
 *
 * 404 quando a conexão não é deste workspace (a RLS nem a devolve), 409 quando o
 * acesso foi revogado: a saída é conectar de novo, e a resposta diz isso.
 */
async function tokenDaConexao(
  req: Request,
  connectionId: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; status: number; body: { code: string; message: string; missing?: string[] } }
> {
  const conexao = await req.scoped!((tx) =>
    metaConnectionsRepo.getWithToken(tx, req.auth!.workspace.id, connectionId),
  );
  if (conexao === null) {
    return {
      ok: false,
      status: 404,
      body: { code: 'META_CONNECTION_NOT_FOUND', message: 'Conexão com a Meta não encontrada.' },
    };
  }
  if (conexao.status === 'revoked' || conexao.accessTokenEnc === null) {
    return {
      ok: false,
      status: 409,
      body: { code: 'META_RECONNECT_REQUIRED', message: 'O acesso à Meta foi removido. Conecte de novo.' },
    };
  }
  // Checagem ANTES de chamar a Meta: falta de permissão vira resposta que diz o que
  // autorizar, em vez de um erro da Graph no meio da conexão do Instagram.
  const faltando = missingByUseCase(['instagram'], conexao.grantedPermissions).instagram ?? [];
  if (faltando.length > 0) {
    return {
      ok: false,
      status: 409,
      body: {
        code: 'META_PERMISSION_MISSING',
        message: `Falta autorizar na Meta: ${faltando.join(', ')}. Reconecte em Configurações › Meta.`,
        missing: faltando,
      },
    };
  }
  return { ok: true, token: decryptSecret(conexao.accessTokenEnc, conexao.keyVersion) };
}

/** Falha do wizard IG em resposta acionável, sem token no log. */
function responderFalhaInstagram(res: Response, err: unknown, etapa: string): void {
  if (err instanceof IgConnectError) {
    connectLogger.warn('instagram: erro de domínio', { etapa, stage: err.code, message: err.message });
    res.status(422).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof MetaError) {
    connectLogger.error('instagram: Graph API recusou', {
      etapa,
      httpStatus: err.httpStatus,
      graphCode: err.code,
      graphSubcode: err.subcode,
      message: err.message,
    });
    res.status(502).json({ code: 'IG_CONNECT_GRAPH_ERROR', message: `A Meta recusou: ${err.message}` });
    return;
  }
  connectLogger.error('instagram: erro inesperado', {
    etapa,
    message: err instanceof Error ? err.message : String(err),
  });
  res.status(502).json({ code: 'IG_CONNECT_GRAPH_ERROR', message: 'Falha ao consultar a Meta. Tente novamente.' });
}

export function createChannelsRouter(): Router {
  const router = Router();

  router.use(createMessageTemplatesRouter());

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

  // POST /api/channels/instagram/accounts — lista Page+IGBA a partir da conexão Meta.
  router.post(
    '/api/channels/instagram/accounts',
    requireAuth,
    withRLS,
    requireRole('channel.connect'),
    async (req: Request, res: Response) => {
      const parsed = igAccountsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'Conecte a Meta antes de escolher a conta do Instagram.' });
        return;
      }
      const acesso = await tokenDaConexao(req, parsed.data.connectionId);
      if (!acesso.ok) {
        res.status(acesso.status).json(acesso.body);
        return;
      }
      try {
        const accounts = await listInstagramAccounts(new GraphClient(), acesso.token);
        // F69-S02: SEM o token da página. O passo seguinte o obtém no servidor.
        res.json({
          accounts: accounts.map((a) => ({
            pageId: a.pageId,
            pageName: a.pageName,
            igUserId: a.igUserId,
            igUsername: a.igUsername,
            igAccountType: a.igAccountType,
          })),
        });
      } catch (err: unknown) {
        responderFalhaInstagram(res, err, 'accounts');
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

      const acesso = await tokenDaConexao(req, input.connectionId);
      if (!acesso.ok) {
        res.status(acesso.status).json(acesso.body);
        return;
      }

      // 0) O token da página vem da Meta, pela conexão — e só se a conta escolhida
      // estiver entre as que esta pessoa administra. Aceitar pageId arbitrário
      // permitiria ligar ao workspace uma página de outra pessoa.
      let pageAccessToken: string;
      try {
        const contas = await listInstagramAccounts(graph, acesso.token);
        const conta = contas.find((a) => a.pageId === input.pageId && a.igUserId === input.igUserId);
        if (conta === undefined) {
          res.status(422).json({
            code: 'IG_CONNECT_ACCOUNT_NOT_FOUND',
            message: 'Esta conta do Instagram não está entre as que você administra na Meta.',
          });
          return;
        }
        pageAccessToken = conta.pageAccessToken;
      } catch (err: unknown) {
        responderFalhaInstagram(res, err, 'connect.accounts');
        return;
      }

      // 1) Subscreve Page+IGBA no webhook do app (idempotente do lado Meta).
      try {
        await subscribeInstagramWebhook(graph, input.pageId, pageAccessToken);
      } catch (err: unknown) {
        if (err instanceof MetaError) {
          connectLogger.error('instagram connect: Graph API recusou subscribe', {
            httpStatus: err.httpStatus,
            graphCode: err.code,
            graphSubcode: err.subcode,
            message: err.message,
          });
        } else {
          connectLogger.error('instagram connect: erro ao subscrever webhook', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
        const message = err instanceof Error ? err.message : 'Falha ao subscrever o webhook na Meta.';
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
          accessTokenEnc: encryptSecret(pageAccessToken),
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
            pageAccessToken,
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

      // 1) Orquestra Graph: exchange → (coexistencia? register com PIN) → subscribe.
      // Numero novo NAO registra/pede PIN. Falha em qualquer etapa aborta antes de
      // criar o canal (token cifrado so se tudo passou).
      let token: string;
      try {
        token = await runWhatsAppConnect(
          graph,
          {
            code: input.code,
            phoneNumberId: input.phoneNumberId,
            wabaId: input.wabaId,
            pin: input.pin,
            mode: input.mode,
          },
          { appId, appSecret },
        );
      } catch (err: unknown) {
        if (err instanceof WaConnectError) {
          connectLogger.warn('whatsapp connect: erro de domínio', {
            stage: err.code,
            message: err.message,
            mode: input.mode,
          });
          res.status(422).json({ code: err.code, message: err.message });
          return;
        }
        if (err instanceof MetaError) {
          // Motivo REAL da recusa da Meta (ex.: code 100 param inválido, code 190
          // token, code 10/200 permissão/IP). fbtrace_id ajuda o suporte da Meta.
          connectLogger.error('whatsapp connect: Graph API recusou', {
            httpStatus: err.httpStatus,
            graphCode: err.code,
            graphSubcode: err.subcode,
            message: err.message,
            mode: input.mode,
          });
          res.status(502).json({
            code: 'WA_CONNECT_GRAPH_ERROR',
            message: `A Meta recusou a conexão: ${err.message}`,
          });
          return;
        }
        connectLogger.error('whatsapp connect: erro inesperado', {
          message: err instanceof Error ? err.message : String(err),
        });
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
