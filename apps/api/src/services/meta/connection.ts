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
import type { GraphClient } from '@hm/channels';
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
  readonly metaUserId: string;
  readonly metaUserName: string | null;
  /** Só para a rota cifrar. Nunca serializar. */
  readonly token: string;
  readonly expiresAt: Date | null;
  readonly assets: MetaAssets;
}

/** Teto defensivo de ativos por tipo — ninguém administra 200 páginas de um cliente só. */
const LIMITE_ATIVOS = 200;

/** Troca o `code` do login por um token de usuário de curta duração. */
export async function exchangeCode(
  graph: GraphGet,
  code: string,
  app: { appId: string; appSecret: string },
): Promise<string> {
  const qs = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code });
  const res = await graph.get(`oauth/access_token?${qs.toString()}`, '');
  const token = isRecord(res) ? asString(res['access_token']) : undefined;
  if (token === undefined) {
    throw new MetaConnectError('META_EXCHANGE_FAILED', 'A Meta não devolveu um token na troca do código.');
  }
  return token;
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
): Promise<ConnectionSnapshot> {
  const curto = await exchangeCode(graph, code, app);
  const { token, expiresAt } = await toLongLived(graph, curto, app, now);
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
  };
}
