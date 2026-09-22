/**
 * Conexão Meta por workspace (F69-S02).
 *
 *  - `POST   /api/meta/connections`             — recebe o `code` do login e os casos de uso.
 *  - `GET    /api/meta/connections`             — conexões do workspace, com saúde.
 *  - `POST   /api/meta/connections/:id/refresh` — relê permissões e ativos.
 *  - `DELETE /api/meta/connections/:id`         — remove a conexão.
 *
 * **Nenhuma resposta carrega token.** O navegador entrega só o `code`; a troca por
 * token de longa duração acontece aqui, com o App Secret, e o token vai direto para
 * o banco, cifrado. O que volta é o que a tela precisa para explicar a situação:
 * quem conectou, o que está funcionando, o que falta e o que reconectar.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GraphClient, MetaError } from '@hm/channels';
import { decryptSecret, encryptSecret, metaConnectionsRepo, type MetaConnectionPublic } from '@hm/db';
import { createLogger } from '@hm/logger';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { platformSecrets } from '../../secrets';
import {
  connectFromCode,
  fetchAssets,
  fetchPermissions,
  MetaConnectError,
  type GraphGet,
} from '../../services/meta/connection';
import {
  connectionHealth,
  isMetaUseCase,
  META_USE_CASES,
  missingByUseCase,
  permissionsFor,
  USE_CASE_LABEL,
  type ConnectionHealth,
  type MetaUseCase,
} from '../../services/meta/permissions';

const logger = createLogger('info', { svc: '@hm/api' });

const criarSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  useCases: z.array(z.enum(META_USE_CASES)).min(1).max(META_USE_CASES.length),
  /**
   * URL da página que abriu o login (F69-S12). Candidata a `redirect_uri` na troca do código: o SDK
   * não diz qual usou no diálogo, e a Meta vinha recusando com `100/36008`. Opcional — sem ela, a
   * troca segue o caminho documentado.
   */
  redirectUri: z.string().url().max(512).optional(),
});

const UUID = z.string().uuid();

/** O que a tela recebe. Sem token, sem ID de usuário da Meta. */
export interface MetaConnectionView {
  readonly id: string;
  readonly metaUserName: string | null;
  readonly status: 'active' | 'revoked';
  readonly health: ConnectionHealth;
  readonly useCases: ReadonlyArray<{
    readonly id: MetaUseCase;
    readonly label: string;
    /** Permissões que faltam para este caso de uso. Vazio = funcionando. */
    readonly missing: readonly string[];
  }>;
  readonly assets: MetaConnectionPublic['assets'];
  readonly tokenExpiresAt: string | null;
  readonly lastCheckedAt: string | null;
}

export function toView(c: MetaConnectionPublic, now: Date): MetaConnectionView {
  const useCases = c.useCases.filter(isMetaUseCase);
  const faltas = missingByUseCase(useCases, c.grantedPermissions);
  return {
    id: c.id,
    metaUserName: c.metaUserName,
    status: c.status,
    health: connectionHealth({
      now,
      status: c.status,
      expiresAt: c.tokenExpiresAt,
      useCases,
      granted: c.grantedPermissions,
    }),
    useCases: useCases.map((id) => ({ id, label: USE_CASE_LABEL[id], missing: faltas[id] ?? [] })),
    assets: c.assets,
    tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
    lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
  };
}

export interface MetaConnectionsDeps {
  readonly graph?: GraphGet;
  readonly now?: () => Date;
  readonly appCredentials?: () => { appId: string | undefined; appSecret: string | undefined };
}

/** Traduz a falha da Meta em resposta acionável, sem vazar token no log. */
function responderFalha(res: Response, err: unknown, etapa: string): void {
  if (err instanceof MetaConnectError) {
    logger.warn('meta.connection.dominio', { etapa, code: err.code });
    res.status(422).json({ code: err.code, message: err.message });
    return;
  }
  if (err instanceof MetaError) {
    logger.error('meta.connection.graph', {
      etapa,
      httpStatus: err.httpStatus,
      graphCode: err.code,
      graphSubcode: err.subcode,
      // A mensagem da Meta é o que diz O QUE ela recusou — sem ela, uma falha de conexão vira um
      // par de números e o diagnóstico depende de adivinhação (F69-S12). Não carrega token: o
      // `code` e o segredo do app vão na query da chamada, nunca na resposta de erro.
      graphMessage: err.message.slice(0, 300),
    });
    res.status(502).json({ code: 'META_GRAPH_ERROR', message: `A Meta recusou: ${err.message}` });
    return;
  }
  logger.error('meta.connection.inesperado', {
    etapa,
    erro: err instanceof Error ? err.message : String(err),
  });
  res.status(502).json({ code: 'META_GRAPH_ERROR', message: 'Falha ao falar com a Meta. Tente de novo.' });
}

export function createMetaConnectionsRouter(deps: MetaConnectionsDeps = {}): Router {
  const router = Router();
  const graph: GraphGet = deps.graph ?? new GraphClient();
  const now = deps.now ?? (() => new Date());
  const credenciais =
    deps.appCredentials ??
    (() => ({
      appId: platformSecrets.get('meta_app_id'),
      appSecret: platformSecrets.get('meta_app_secret'),
    }));
  const guard = [requireAuth, withRLS, requireRole('channel.connect')] as const;

  /**
   * Casos de uso e as permissões de cada um — a tela monta o login a partir daqui.
   *
   * Existe para a lista de permissões ter UMA fonte (`services/meta/permissions.ts`):
   * se o navegador tivesse a própria cópia, a primeira renomeação da Meta faria o
   * login pedir um conjunto e a checagem de saúde exigir outro.
   */
  router.get('/api/meta/use-cases', ...guard, (_req: Request, res: Response) => {
    res.json({
      useCases: META_USE_CASES.map((id) => ({
        id,
        label: USE_CASE_LABEL[id],
        permissions: permissionsFor([id]),
      })),
    });
  });

  router.post('/api/meta/connections', ...guard, async (req: Request, res: Response) => {
    const parsed = criarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Informe o código do login e ao menos um caso de uso.' });
      return;
    }
    const { appId, appSecret } = credenciais();
    if (appId === undefined || appSecret === undefined) {
      res.status(503).json({
        code: 'META_APP_NOT_CONFIGURED',
        message: 'As credenciais do app Meta não estão configuradas na plataforma.',
      });
      return;
    }

    let snapshot;
    try {
      snapshot = await connectFromCode(graph, parsed.data.code, { appId, appSecret }, now(), {
        pageUrl: parsed.data.redirectUri ?? null,
        onAttempt: (t) => {
          logger.info('meta.connection.exchange.tentativa', {
            redirectUri: t.redirectUri === null ? '(sem redirect_uri)' : t.redirectUri,
            ok: t.ok,
            graphCode: t.graphCode,
            graphSubcode: t.graphSubcode,
          });
        },
      });
    } catch (err) {
      responderFalha(res, err, 'connect');
      return;
    }
    logger.info('meta.connection.exchange.aceita', {
      redirectUri:
        snapshot.exchange.redirectUriAceita === null
          ? '(sem redirect_uri)'
          : snapshot.exchange.redirectUriAceita,
      tentativas: snapshot.exchange.tentativas.length,
    });

    const agora = now();
    const workspaceId = req.auth!.workspace.id;
    const linha = await req.scoped!((tx) =>
      metaConnectionsRepo.upsert(tx, {
        workspaceId,
        metaUserId: snapshot.metaUserId,
        metaUserName: snapshot.metaUserName,
        accessTokenEnc: encryptSecret(snapshot.token),
        keyVersion: 1,
        tokenExpiresAt: snapshot.expiresAt,
        useCases: parsed.data.useCases,
        grantedPermissions: snapshot.granted,
        declinedPermissions: snapshot.declined,
        assets: snapshot.assets,
        connectedBy: req.auth!.member.id,
        now: agora,
      }),
    );
    res.status(201).json({ connection: toView(linha, agora) });
  });

  router.get('/api/meta/connections', ...guard, async (req: Request, res: Response) => {
    const agora = now();
    const linhas = await req.scoped!((tx) =>
      metaConnectionsRepo.listForWorkspace(tx, req.auth!.workspace.id),
    );
    res.json({ connections: linhas.map((l) => toView(l, agora)) });
  });

  router.post('/api/meta/connections/:id/refresh', ...guard, async (req: Request, res: Response) => {
    const id = UUID.safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ message: 'Conexão não encontrada.' });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const conexao = await req.scoped!((tx) => metaConnectionsRepo.getWithToken(tx, workspaceId, id.data));
    if (conexao === null) {
      res.status(404).json({ message: 'Conexão não encontrada.' });
      return;
    }
    if (conexao.status === 'revoked' || conexao.accessTokenEnc === null) {
      // Sem token não há o que reler: a única saída é conectar de novo.
      res.status(409).json({ code: 'META_RECONNECT_REQUIRED', message: 'O acesso foi removido. Conecte a Meta de novo.' });
      return;
    }

    let permissoes;
    let assets;
    try {
      const token = decryptSecret(conexao.accessTokenEnc, conexao.keyVersion);
      [permissoes, assets] = await Promise.all([fetchPermissions(graph, token), fetchAssets(graph, token)]);
    } catch (err) {
      responderFalha(res, err, 'refresh');
      return;
    }

    const agora = now();
    await req.scoped!((tx) =>
      metaConnectionsRepo.updatePermissionsAndAssets(tx, {
        workspaceId,
        id: conexao.id,
        grantedPermissions: permissoes.granted,
        declinedPermissions: permissoes.declined,
        assets,
        now: agora,
      }),
    );
    // Montado campo a campo, e não com spread da linha: a linha tem o token cifrado,
    // e um spread é exatamente como um token acaba numa resposta sem ninguém notar.
    const publica: MetaConnectionPublic = {
      id: conexao.id,
      workspaceId: conexao.workspaceId,
      metaUserId: conexao.metaUserId,
      metaUserName: conexao.metaUserName,
      tokenExpiresAt: conexao.tokenExpiresAt,
      useCases: conexao.useCases,
      grantedPermissions: permissoes.granted,
      declinedPermissions: permissoes.declined,
      assets,
      status: conexao.status,
      connectedBy: conexao.connectedBy,
      lastCheckedAt: agora,
      createdAt: conexao.createdAt,
      updatedAt: agora,
    };
    res.json({ connection: toView(publica, agora) });
  });

  router.delete('/api/meta/connections/:id', ...guard, async (req: Request, res: Response) => {
    const id = UUID.safeParse(req.params['id']);
    if (!id.success) {
      res.status(404).json({ message: 'Conexão não encontrada.' });
      return;
    }
    const apagou = await req.scoped!((tx) =>
      metaConnectionsRepo.remove(tx, req.auth!.workspace.id, id.data),
    );
    if (!apagou) {
      res.status(404).json({ message: 'Conexão não encontrada.' });
      return;
    }
    res.sendStatus(204);
  });

  return router;
}
