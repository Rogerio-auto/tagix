/**
 * Conexão Meta por workspace — a conversa com a Graph (F69-S02).
 *
 * Funções sobre o `GraphClient` compartilhado, sem persistência (a rota cifra e
 * grava). Injetável: os testes passam um `get` falso e não tocam a rede.
 *
 * ## O token nunca passa pelo navegador
 *
 * O navegador só entrega o `code` do login. A troca por token acontece aqui, com o
 * App Secret, e o token de longa duração vai direto para o banco, cifrado. Nenhuma
 * resposta desta camada para fora contém token — `ConnectionSnapshot.token` existe
 * só para a rota cifrar, e o tipo público da rota não o carrega.
 */
import { MetaError, type GraphClient } from '@hm/channels';
import { parsePermissions, type PermissionSnapshot } from './permissions';

export type GraphGet = Pick<GraphClient, 'get'>;

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export class MetaConnectError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MetaConnectError';
    this.code = code;
    Object.setPrototypeOf(this, MetaConnectError.prototype);
  }
}

/** Página do Facebook que a pessoa administra, com a conta do Instagram vinculada, se houver. */
export interface MetaPageAsset {
  readonly id: string;
  readonly name: string | null;
  readonly instagram: { readonly id: string; readonly username: string | null } | null;
}

export interface MetaAdAccountAsset {
  readonly id: string;
  readonly name: string | null;
  readonly currency: string | null;
}

export interface MetaAssets {
  readonly pages: MetaPageAsset[];
  readonly adAccounts: MetaAdAccountAsset[];
}

export interface ConnectionSnapshot extends PermissionSnapshot {
  /** Como a troca do código foi aceita — só para o log da rota (F69-S12). */
  readonly exchange: ExchangeDiagnostics;
  readonly metaUserId: string;
  readonly metaUserName: string | null;
  /** Só para a rota cifrar. Nunca serializar. */
  readonly token: string;
  readonly expiresAt: Date | null;
  readonly assets: MetaAssets;
}

/** Teto defensivo de ativos por tipo — ninguém administra 200 páginas de um cliente só. */
const LIMITE_ATIVOS = 200;

/** Uma tentativa de troca — é o que o log precisa para dizer o que a Meta aceitou ou recusou. */
export interface ExchangeAttempt {
  /** `null` = sem o parâmetro `redirect_uri`, que é o que a documentação da Meta manda. */
  readonly redirectUri: string | null;
  readonly ok: boolean;
  readonly graphCode?: number;
  readonly graphSubcode?: number;
}

/** O que a troca devolve além do token: qual `redirect_uri` a Meta aceitou, e o caminho até ela. */
export interface ExchangeDiagnostics {
  readonly redirectUriAceita: string | null;
  readonly tentativas: readonly ExchangeAttempt[];
}

/** "Error validating verification code. Please make sure your redirect_uri is identical…" */
const SUBCODE_REDIRECT_URI = 36008;

export interface ExchangeOptions {
  /** URL da página que abriu o login — candidata a `redirect_uri` (só o navegador a conhece). */
  readonly pageUrl?: string | null;
  /** Recebe cada tentativa, para o log. */
  readonly onAttempt?: (tentativa: ExchangeAttempt) => void;
}

/**
 * Troca o `code` do login por um token de usuário de curta duração.
 *
 * ## Por que há mais de uma tentativa (F69-S12)
 *
 * A Meta documenta a troca como `client_id` + `client_secret` + `code`, sem `redirect_uri` — e é
 * assim que o Embedded Signup do WhatsApp funciona. Mas o login da conexão vinha recusado com
 * `100/36008` ("redirect_uri is identical…"), mesmo com `config_id` e sem `auth_type`. O SDK não
 * expõe qual `redirect_uri` usou no diálogo, então a ordem aqui testa as candidatas plausíveis:
 * nenhuma (o documentado), a URL da página que abriu o login, e vazia.
 *
 * Insiste **apenas** enquanto a recusa é exatamente sobre `redirect_uri`. Token inválido, app errado
 * ou instabilidade param na hora: cada chamada extra é mais uma chance de a Meta invalidar o código.
 *
 * Quando o log apontar a candidata aceita, esta lista colapsa para ela — a sonda existe para
 * responder qual é, não para ficar.
 */
export async function exchangeCode(
  graph: GraphGet,
  code: string,
  app: { appId: string; appSecret: string },
  opts: ExchangeOptions = {},
): Promise<{ token: string } & ExchangeDiagnostics> {
  const candidatas: Array<string | null> = [null];
  if (opts.pageUrl !== undefined && opts.pageUrl !== null && opts.pageUrl !== '') {
    candidatas.push(opts.pageUrl);
  }
  candidatas.push('');

  const tentativas: ExchangeAttempt[] = [];
  let ultimoErro: unknown;

  for (const redirectUri of candidatas) {
    const qs = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code });
    if (redirectUri !== null) qs.set('redirect_uri', redirectUri);
    try {
      const res = await graph.get(`oauth/access_token?${qs.toString()}`, '');
      const token = isRecord(res) ? asString(res['access_token']) : undefined;
      if (token === undefined) {
        throw new MetaConnectError('META_EXCHANGE_FAILED', 'A Meta não devolveu um token na troca do código.');
      }
      const ok: ExchangeAttempt = { redirectUri, ok: true };
      tentativas.push(ok);
      opts.onAttempt?.(ok);
      return { token, redirectUriAceita: redirectUri, tentativas };
    } catch (err: unknown) {
      ultimoErro = err;
      const meta = err instanceof MetaError ? err : null;
      const falha: ExchangeAttempt = {
        redirectUri,
        ok: false,
        ...(meta?.code !== undefined ? { graphCode: meta.code } : {}),
        ...(meta?.subcode !== undefined ? { graphSubcode: meta.subcode } : {}),
      };
      tentativas.push(falha);
      opts.onAttempt?.(falha);
      if (meta === null || meta.subcode !== SUBCODE_REDIRECT_URI) break;
    }
  }

  throw (
    ultimoErro ??
    new MetaConnectError('META_EXCHANGE_FAILED', 'A Meta não devolveu um token na troca do código.')
  );
}

/**
 * Troca por token de longa duração (~60 dias).
 *
 * Sem esta troca o token de curta duração expira em horas, e os leads param de
 * chegar no dia seguinte sem aviso nenhum.
 */
export async function toLongLived(
  graph: GraphGet,
  shortToken: string,
  app: { appId: string; appSecret: string },
  now: Date,
): Promise<{ token: string; expiresAt: Date | null }> {
  const qs = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await graph.get(`oauth/access_token?${qs.toString()}`, '');
  const token = isRecord(res) ? asString(res['access_token']) : undefined;
  if (token === undefined) {
    throw new MetaConnectError('META_LONG_LIVED_FAILED', 'A Meta não devolveu um token de longa duração.');
  }
  const expiresIn = isRecord(res) ? res['expires_in'] : undefined;
  const expiresAt =
    typeof expiresIn === 'number' && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null;
  return { token, expiresAt };
}

export async function fetchIdentity(
  graph: GraphGet,
  token: string,
): Promise<{ id: string; name: string | null }> {
  const res = await graph.get('me?fields=id,name', token);
  const id = isRecord(res) ? asString(res['id']) : undefined;
  if (id === undefined) {
    throw new MetaConnectError('META_IDENTITY_FAILED', 'A Meta não informou quem fez o login.');
  }
  return { id, name: isRecord(res) ? (asString(res['name']) ?? null) : null };
}

export async function fetchPermissions(graph: GraphGet, token: string): Promise<PermissionSnapshot> {
  return parsePermissions(await graph.get('me/permissions', token));
}

function lista(res: unknown): unknown[] {
  const data = isRecord(res) ? res['data'] : null;
  return Array.isArray(data) ? data.slice(0, LIMITE_ATIVOS) : [];
}

/**
 * Páginas e contas de anúncio que a pessoa administra.
 *
 * Cada leitura falha sozinha: sem `ads_read`, a lista de contas de anúncio vem
 * vazia, mas as páginas continuam aparecendo. Uma permissão negada não pode
 * esconder o que as outras permitem ver.
 */
export async function fetchAssets(graph: GraphGet, token: string): Promise<MetaAssets> {
  const [paginas, contas] = await Promise.all([
    graph
      .get(`me/accounts?fields=id,name,instagram_business_account{id,username}&limit=${LIMITE_ATIVOS}`, token)
      .catch(() => null),
    graph
      .get(`me/adaccounts?fields=id,name,currency&limit=${LIMITE_ATIVOS}`, token)
      .catch(() => null),
  ]);

  const pages: MetaPageAsset[] = [];
  for (const item of lista(paginas)) {
    if (!isRecord(item)) continue;
    const id = asString(item['id']);
    if (id === undefined) continue;
    const ig = item['instagram_business_account'];
    const igId = isRecord(ig) ? asString(ig['id']) : undefined;
    pages.push({
      id,
      name: asString(item['name']) ?? null,
      instagram:
        igId !== undefined && isRecord(ig)
          ? { id: igId, username: asString(ig['username']) ?? null }
          : null,
    });
  }

  const adAccounts: MetaAdAccountAsset[] = [];
  for (const item of lista(contas)) {
    if (!isRecord(item)) continue;
    const id = asString(item['id']);
    if (id === undefined) continue;
    adAccounts.push({
      id,
      name: asString(item['name']) ?? null,
      currency: asString(item['currency']) ?? null,
    });
  }

  return { pages, adAccounts };
}

/** O fluxo completo a partir do `code`: token de longa duração, identidade, permissões e ativos. */
export async function connectFromCode(
  graph: GraphGet,
  code: string,
  app: { appId: string; appSecret: string },
  now: Date,
  opts: ExchangeOptions = {},
): Promise<ConnectionSnapshot> {
  const troca = await exchangeCode(graph, code, app, opts);
  const { token, expiresAt } = await toLongLived(graph, troca.token, app, now);
  const [identidade, permissoes, assets] = await Promise.all([
    fetchIdentity(graph, token),
    fetchPermissions(graph, token),
    fetchAssets(graph, token),
  ]);
  return {
    metaUserId: identidade.id,
    metaUserName: identidade.name,
    token,
    expiresAt,
    granted: permissoes.granted,
    declined: permissoes.declined,
    assets,
    exchange: { redirectUriAceita: troca.redirectUriAceita, tentativas: troca.tentativas },
  };
}
