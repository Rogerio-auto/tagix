import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { membershipsRepo, workspacesRepo } from '@hm/db';
import type { AuthIdentity } from '@hm/shared';
import { getAuthProvider } from './provider';

export const SESSION_COOKIE = 'hm_session';
/**
 * Empresa ativa da sessão (F71-S03, CONTAS_E_CONVITES §3.2). Só carrega um UUID e é
 * PREFERÊNCIA, não autorização: a cada request o id é revalidado contra uma membership
 * `active` do `auth_user_id` da sessão (T5). Cookie de empresa alheia, removida ou
 * malformado é ignorado em silêncio e a sessão cai na empresa padrão (a última usada).
 */
export const WORKSPACE_COOKIE = 'hm_workspace';
const isProd = process.env['NODE_ENV'] === 'production';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WORKSPACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** UUID canônico (qualquer versão). O cookie não aceita outra forma (nem chega ao SQL). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Grava a empresa ativa (`hm_workspace`): httpOnly, SameSite=Lax, Secure em produção,
 * 30 dias. Chamar SÓ depois de confirmar membership `active` do `auth_user_id` nesta
 * empresa (login, troca de empresa, aceite de convite) — o cookie não autoriza nada
 * sozinho, mas gravar um id não validado esconderia bug. Id fora do formato UUID é erro
 * de programação e lança.
 */
export function setActiveWorkspaceCookie(res: Response, workspaceId: string): void {
  if (!isUuid(workspaceId)) {
    throw new Error('setActiveWorkspaceCookie: workspaceId precisa ser um UUID.');
  }
  res.cookie(WORKSPACE_COOKIE, workspaceId.toLowerCase(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: WORKSPACE_MAX_AGE_MS,
  });
}

/** Apaga a empresa ativa (logout). Mesmo path do set para o navegador casar o cookie. */
export function clearActiveWorkspaceCookie(res: Response): void {
  res.clearCookie(WORKSPACE_COOKIE, { path: '/' });
}

/** Lê um cookie de um header `Cookie` cru, sem cookie-parser (Express e handshake do socket). */
export function readCookieFromHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null; // escape percentual malformado: cookie ilegível = ausente
      }
    }
  }
  return null;
}

/** Lê o token do cookie sem depender de cookie-parser. */
export function readToken(req: Request): string | null {
  return readCookieFromHeader(req.headers.cookie, SESSION_COOKIE);
}

/**
 * Empresa preferida do header `Cookie` (`hm_workspace`), já filtrada por formato: só um
 * UUID passa. Não valida membership — isso é do `resolveSessionStatus`.
 */
export function preferredWorkspaceFromHeader(header: string | undefined): string | null {
  const raw = readCookieFromHeader(header, WORKSPACE_COOKIE);
  return raw && isUuid(raw) ? raw.toLowerCase() : null;
}

/** `preferredWorkspaceFromHeader` sobre o request do Express. */
export function readPreferredWorkspace(req: Request): string | null {
  return preferredWorkspaceFromHeader(req.headers.cookie);
}

export type Member = NonNullable<Awaited<ReturnType<typeof membershipsRepo.findActive>>>;
export type Workspace = NonNullable<Awaited<ReturnType<typeof workspacesRepo.findById>>>;

export interface SessionContext {
  identity: AuthIdentity;
  /** A membership `active` da pessoa NA empresa ativa (nunca resolvida por email). */
  member: Member;
  /** Empresa ativa. Sob view-as, o middleware de impersonation sobrepõe pelo alvo. */
  workspace: Workspace;
}

// ─── Verificação de token RESILIENTE ─────────────────────────────────────────
/**
 * `verifyToken` do provider chama o Supabase (`getUser`) pela REDE. O handshake do
 * Socket.io roda essa verificação a CADA (re)conexão e o socket reconecta com
 * frequência — então blip/latência/rate-limit do Supabase derrubavam o handshake de
 * forma INTERMITENTE ("handshake unauthorized" com cookie válido), matando o tempo
 * real (cliente não entra nos rooms → relay emite pra sala vazia). Esta camada:
 *   - serve do cache por FRESH_MS sem tocar a rede (absorve a rajada de reconexões);
 *   - em falha de INFRA do provider (LANÇOU — rede/5xx), serve o último valor bom
 *     por até STALE_MS (stale-on-error) em vez de rejeitar uma sessão recém-válida.
 * Identidade é função pura do token (é um JWT), então cachear por token é consistente.
 *
 * SEC-08: stale é EXCLUSIVO para throw (indisponibilidade). Se o provider retorna
 * `null`, o token é genuinamente inválido (expirado/revogado) — a entrada do cache
 * é descartada e a sessão rejeitada na hora; token revogado NUNCA é honrado por
 * stale. Não valida tokens nunca-vistos (sem entrada no cache → rejeita). Janela
 * residual: um token revogado ainda passa por até FRESH_MS após a última
 * verificação boa (tradeoff aceito do cache fresh). Single-replica → cache em
 * memória; se escalar, mover para Redis.
 */
interface CachedIdentity {
  readonly identity: AuthIdentity;
  readonly freshUntil: number;
  readonly staleUntil: number;
}
const FRESH_MS = 5 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 5000;
const identityCache = new Map<string, CachedIdentity>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Bound de memória: ao atingir o teto, descarta as entradas já além do stale. */
function pruneIfNeeded(now: number): void {
  if (identityCache.size < MAX_ENTRIES) return;
  for (const [k, v] of identityCache) {
    if (v.staleUntil <= now) identityCache.delete(k);
  }
}

/** Limpa o cache de identidade (uso em testes). */
export function __resetIdentityCache(): void {
  identityCache.clear();
}

/**
 * Resultado da verificação com o MOTIVO da recusa (F70-S28). `invalid` é decisão
 * definitiva do provider (token expirado/revogado/malformado, ou member inativo):
 * o cliente deve voltar ao login. `unavailable` é infra (provider lançou, sem cache
 * recente): NÃO é "sessão terminou" — responder 401 aqui mandaria todo mundo para o
 * login a cada instabilidade do Supabase.
 */
type TokenVerification =
  | { readonly kind: 'ok'; readonly identity: AuthIdentity }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

async function verifyTokenDetailed(token: string): Promise<TokenVerification> {
  const key = tokenKey(token);
  const now = Date.now();
  const cached = identityCache.get(key);
  if (cached && cached.freshUntil > now) return { kind: 'ok', identity: cached.identity };

  let identity: AuthIdentity | null;
  try {
    identity = await getAuthProvider().verifyToken(token);
  } catch {
    // Provider LANÇOU = indisponibilidade de infra (rede/5xx): serve o último bom
    // recente (stale-on-error, bounded por STALE_MS) em vez de rejeitar.
    if (cached && cached.staleUntil > now) return { kind: 'ok', identity: cached.identity };
    return { kind: 'unavailable' };
  }

  if (identity) {
    pruneIfNeeded(now);
    identityCache.set(key, { identity, freshUntil: now + FRESH_MS, staleUntil: now + STALE_MS });
    return { kind: 'ok', identity };
  }

  // `null` = token genuinamente inválido (expirado/revogado/malformado). Decisão
  // definitiva do provider — NUNCA cai no stale (SEC-08). Purga o cache.
  identityCache.delete(key);
  return { kind: 'invalid' };
}

/**
 * `verifyToken` com cache fresh + stale-on-error. Exportada p/ teste; o resto da app
 * usa `resolveSession`/`resolveSessionStatus`. `null` cobre inválido E indisponível.
 */
export async function verifyTokenResilient(token: string): Promise<AuthIdentity | null> {
  const v = await verifyTokenDetailed(token);
  return v.kind === 'ok' ? v.identity : null;
}

/** Sessão resolvida, ou o motivo de não haver uma (ver `TokenVerification`). */
export type SessionResolution =
  | { readonly kind: 'ok'; readonly session: SessionContext }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

/**
 * Verifica o token e resolve a membership + empresa ativa, distinguindo "sessão morta"
 * (`invalid` → 401) de "provider fora do ar" (`unavailable` → 503).
 *
 * Resolução por PESSOA (`auth_user_id`), nunca por email (C1, F71-S03):
 *   1. `preferredWorkspaceId` (cookie `hm_workspace`), se for UUID E membership `active`
 *      desta pessoa naquela empresa (T5). Qualquer outra coisa é ignorada em silêncio;
 *   2. senão, a empresa de `last_active_at` mais recente (`listActiveByAuthUser`);
 *   3. nenhuma membership `active` → `invalid` (`invited`, `inactive` e `blocked` não
 *      dão acesso).
 *
 * Custo: com cookie válido, 2 consultas indexadas (membership + empresa), o mesmo de
 * antes; sem cookie ou com cookie inválido, +1 (lista de memberships).
 */
export async function resolveSessionStatus(
  token: string,
  preferredWorkspaceId?: string | null,
): Promise<SessionResolution> {
  const v = await verifyTokenDetailed(token);
  if (v.kind !== 'ok') return v;
  const { authUserId } = v.identity;
  // Ids de conta do provider são UUID (GoTrue e mock); outra forma nem chega ao SQL.
  if (!isUuid(authUserId)) return { kind: 'invalid' };

  let member: Member | null = null;
  if (preferredWorkspaceId && isUuid(preferredWorkspaceId)) {
    member = await membershipsRepo.findActive(authUserId, preferredWorkspaceId.toLowerCase());
  }
  if (!member) {
    const [fallback] = await membershipsRepo.listActiveByAuthUser(authUserId);
    if (!fallback) return { kind: 'invalid' };
    // Relê a linha inteira (o contexto carrega preferências etc.) e revalida o `active`:
    // entre as duas consultas a membership pode ter sido removida.
    member = await membershipsRepo.findActive(authUserId, fallback.workspaceId);
  }
  if (!member) return { kind: 'invalid' };
  const workspace = await workspacesRepo.findById(member.workspaceId);
  if (!workspace) return { kind: 'invalid' };
  return { kind: 'ok', session: { identity: v.identity, member, workspace } };
}

/** Verifica o token e resolve member + workspace (member precisa estar ativo). */
export async function resolveSession(
  token: string,
  preferredWorkspaceId?: string | null,
): Promise<SessionContext | null> {
  const r = await resolveSessionStatus(token, preferredWorkspaceId);
  return r.kind === 'ok' ? r.session : null;
}

/** Versão segura do member para enviar ao cliente (sem campos internos). */
export function publicMember(m: Member) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    email: m.email,
    name: m.name,
    role: m.role,
    isPlatformAdmin: m.isPlatformAdmin,
    themePreference: m.themePreference,
    densityPreference: m.densityPreference,
  };
}
