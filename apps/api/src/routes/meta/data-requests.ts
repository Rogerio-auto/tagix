/**
 * Callbacks de dados de usuário exigidos pela Meta (F69-S01).
 *
 *  - `POST /meta/data-deletion` — a pessoa removeu o app e pediu exclusão dos
 *    dados. Responde `{ url, confirmation_code }`, como a Meta exige.
 *  - `POST /meta/deauthorize`   — a pessoa tirou o acesso do app. Paramos de usar
 *    os tokens dela na hora.
 *  - `GET  /api/meta/data-deletion/:code` — estado do pedido, para a página
 *    pública de acompanhamento. Não devolve dado de ninguém.
 *
 * ## Sem estes endpoints, nenhuma permissão é aprovada
 *
 * É requisito de plataforma do App Review, independente do caso de uso. URL que
 * devolve erro na hora da revisão reprova o app inteiro.
 *
 * ## O que é apagado hoje
 *
 * O Leadium ainda **não guarda o ID de usuário da Meta** em lugar nenhum: os
 * tokens dos canais são de página e de conta de WhatsApp, não de pessoa. Então,
 * hoje, todo pedido termina em `no_data` — que é a resposta verdadeira. A partir
 * da F69-S02, a conexão por workspace passa a registrar esse ID, e a porta
 * `deleteForMetaUser` passa a encontrar e remover os tokens e vínculos dela.
 * Responder "apagado" sem ter o que apagar seria mentir num registro de
 * conformidade.
 */
import { randomBytes } from 'node:crypto';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { MetaDataRequest, MetaDataRequestKind, MetaDataRequestStatus } from '@hm/db';
import { createLogger } from '@hm/logger';
import { rateLimit } from '../../middlewares/rate-limit';
import { verifySignedRequest } from '../../services/meta/signed-request';

const logger = createLogger('info', { svc: '@hm/api' });

/** Persistência dos pedidos. Porta para o teste de rota não precisar de banco. */
export interface DataRequestStore {
  findLatest(kind: MetaDataRequestKind, metaUserId: string): Promise<MetaDataRequest | null>;
  create(input: {
    kind: MetaDataRequestKind;
    metaUserId: string;
    confirmationCode: string;
  }): Promise<MetaDataRequest>;
  finish(id: string, status: MetaDataRequestStatus, itemsRemoved: number, at: Date): Promise<void>;
  findByCode(code: string): Promise<MetaDataRequest | null>;
}

export interface MetaDataRequestsDeps {
  /** App Secret da Meta. Ausente = toda chamada é recusada. */
  readonly appSecret: () => string | undefined;
  /** Base pública do app, para montar a URL de acompanhamento. */
  readonly publicAppUrl: () => string;
  readonly store?: DataRequestStore;
  /** Remove o que estiver ligado a este usuário. Devolve quantos itens saíram. */
  readonly deleteForMetaUser?: (metaUserId: string) => Promise<number>;
  /** Revoga tokens ligados a este usuário. Devolve quantos foram revogados. */
  readonly revokeForMetaUser?: (metaUserId: string) => Promise<number>;
  /** Limitador. Injetável para o teste não depender de Redis. */
  readonly limiter?: RequestHandler;
  readonly now?: () => Date;
}

/** Código de confirmação: 18 bytes aleatórios, base64url — 24 caracteres, não adivinhável. */
function novoCodigo(): string {
  return randomBytes(18).toString('base64url');
}

const CODIGO_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

export function createDbDataRequestStore(): DataRequestStore {
  const t = schema.metaDataRequests;
  return {
    async findLatest(kind, metaUserId) {
      const [linha] = await getDb()
        .select()
        .from(t)
        .where(and(eq(t.kind, kind), eq(t.metaUserId, metaUserId)))
        .orderBy(desc(t.requestedAt))
        .limit(1);
      return linha ?? null;
    },
    async create(input) {
      const [linha] = await getDb().insert(t).values(input).returning();
      if (linha === undefined) throw new Error('meta_data_requests: insert não devolveu linha.');
      return linha;
    },
    async finish(id, status, itemsRemoved, at) {
      await getDb()
        .update(t)
        .set({ status, itemsRemoved, completedAt: at })
        .where(eq(t.id, id));
    },
    async findByCode(code) {
      const [linha] = await getDb().select().from(t).where(eq(t.confirmationCode, code)).limit(1);
      return linha ?? null;
    },
  };
}

/** Lê o `signed_request` do corpo form-urlencoded e confere a assinatura. */
function lerPedido(
  req: Request,
  res: Response,
  segredo: string | undefined,
): { userId: string } | null {
  const bruto: unknown = (req.body as Record<string, unknown> | undefined)?.['signed_request'];
  if (typeof bruto !== 'string' || bruto === '') {
    res.status(400).json({ error: 'signed_request_ausente' });
    return null;
  }
  if (segredo === undefined || segredo === '') {
    // Sem App Secret não há como provar que o pedido é da Meta. Aceitar por
    // omissão abriria exclusão de dados para qualquer um.
    logger.error('meta.data_request.sem_app_secret');
    res.status(503).json({ error: 'indisponivel' });
    return null;
  }
  const r = verifySignedRequest(bruto, segredo);
  if (!r.ok) {
    logger.warn('meta.data_request.recusado', { motivo: r.reason });
    res.status(r.reason === 'bad_signature' ? 403 : 400).json({ error: r.reason });
    return null;
  }
  return { userId: r.payload.userId };
}

export function createMetaDataRequestsRouter(deps: MetaDataRequestsDeps): Router {
  const router = Router();
  const store = deps.store ?? createDbDataRequestStore();
  const now = deps.now ?? (() => new Date());
  // Enquanto a F69-S02 não registra o ID de usuário da Meta, não há o que remover.
  const deleteForMetaUser = deps.deleteForMetaUser ?? (() => Promise.resolve(0));
  const revokeForMetaUser = deps.revokeForMetaUser ?? (() => Promise.resolve(0));
  const limiter =
    deps.limiter ?? rateLimit({ bucket: 'meta-data-requests', max: 120, windowSec: 60, byEmail: false });
  // A Meta envia `application/x-www-form-urlencoded`, não JSON.
  const formulario = express.urlencoded({ extended: false, limit: '16kb' });

  router.post('/meta/data-deletion', limiter, formulario, async (req: Request, res: Response) => {
    const pedido = lerPedido(req, res, deps.appSecret());
    if (pedido === null) return;

    // A Meta pode repetir o pedido. Devolver o mesmo código evita dois registros
    // para uma única vontade da pessoa e mantém a página de acompanhamento estável.
    const existente = await store.findLatest('deletion', pedido.userId);
    const registro =
      existente ??
      (await store.create({
        kind: 'deletion',
        metaUserId: pedido.userId,
        confirmationCode: novoCodigo(),
      }));

    if (existente === null) {
      try {
        const removidos = await deleteForMetaUser(pedido.userId);
        await store.finish(registro.id, removidos > 0 ? 'completed' : 'no_data', removidos, now());
      } catch (err) {
        // Falha fica registrada e visível: pedido de exclusão não pode sumir.
        await store.finish(registro.id, 'failed', 0, now());
        logger.error('meta.data_deletion.falhou', {
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const base = deps.publicAppUrl().replace(/\/+$/, '');
    res.json({
      url: `${base}/exclusao-de-dados/${registro.confirmationCode}`,
      confirmation_code: registro.confirmationCode,
    });
  });

  router.post('/meta/deauthorize', limiter, formulario, async (req: Request, res: Response) => {
    const pedido = lerPedido(req, res, deps.appSecret());
    if (pedido === null) return;

    const registro = await store.create({
      kind: 'deauthorize',
      metaUserId: pedido.userId,
      confirmationCode: novoCodigo(),
    });
    try {
      const revogados = await revokeForMetaUser(pedido.userId);
      await store.finish(registro.id, revogados > 0 ? 'completed' : 'no_data', revogados, now());
    } catch (err) {
      await store.finish(registro.id, 'failed', 0, now());
      logger.error('meta.deauthorize.falhou', {
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    res.sendStatus(200);
  });

  router.get('/api/meta/data-deletion/:code', limiter, async (req: Request, res: Response) => {
    const code = req.params['code'];
    if (typeof code !== 'string' || !CODIGO_VALIDO.test(code)) {
      res.status(404).json({ error: 'nao_encontrado' });
      return;
    }
    const registro = await store.findByCode(code);
    if (registro === null || registro.kind !== 'deletion') {
      res.status(404).json({ error: 'nao_encontrado' });
      return;
    }
    // Só o estado. O ID do usuário nunca sai por aqui: o código é público (a Meta
    // mostra ao usuário) e não pode virar forma de descobrir quem pediu.
    res.json({
      status: registro.status,
      requestedAt: registro.requestedAt.toISOString(),
      completedAt: registro.completedAt?.toISOString() ?? null,
    });
  });

  return router;
}
