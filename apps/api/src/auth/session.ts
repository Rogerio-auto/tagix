import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { membersRepo, workspacesRepo } from '@hm/db';
import type { AuthIdentity } from '@hm/shared';
import { getAuthProvider } from './provider';

export const SESSION_COOKIE = 'hm_session';
const isProd = process.env['NODE_ENV'] === 'production';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Lê o token do cookie sem depender de cookie-parser. */
export function readToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export type Member = NonNullable<Awaited<ReturnType<typeof membersRepo.findByEmail>>>;
export type Workspace = NonNullable<Awaited<ReturnType<typeof workspacesRepo.findById>>>;

export interface SessionContext {
  identity: AuthIdentity;
  member: Member;
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
 *   - em falha TRANSITÓRIA do provider, serve o último valor bom por até STALE_MS
 *     (stale-on-error) em vez de rejeitar uma sessão recém-válida.
 * Identidade é função pura do token (é um JWT), então cachear por token é consistente.
 *
 * Tradeoff de segurança (bounded e aceito): um token que EXPIROU (getUser passa a
 * falhar) segue honrado por no máx. STALE_MS além da última verificação boa. Não
 * valida tokens nunca-vistos (sem entrada no cache → rejeita). Logout é client-side
 * (cookie limpo) e tokens Supabase já são stateless até o `exp` (~1h), então a folga
 * é menor que a janela natural do token. Single-replica → cache em memória; se
 * escalar, mover para Redis.
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
 * `verifyToken` com cache fresh + stale-on-error. Exportada p/ teste; o resto da app
 * usa `resolveSession`.
 */
export async function verifyTokenResilient(token: string): Promise<AuthIdentity | null> {
  const key = tokenKey(token);
  const now = Date.now();
  const cached = identityCache.get(key);
  if (cached && cached.freshUntil > now) return cached.identity;

  let identity: AuthIdentity | null = null;
  try {
    identity = await getAuthProvider().verifyToken(token);
  } catch {
    identity = null;
  }

  if (identity) {
    pruneIfNeeded(now);
    identityCache.set(key, { identity, freshUntil: now + FRESH_MS, staleUntil: now + STALE_MS });
    return identity;
  }

  // Provider falhou (rede/transitório): serve o último bom recente em vez de rejeitar.
  if (cached && cached.staleUntil > now) return cached.identity;
  identityCache.delete(key);
  return null;
}

/** Verifica o token e resolve member + workspace (member precisa estar ativo). */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const identity = await verifyTokenResilient(token);
  if (!identity) return null;
  const member = await membersRepo.findByEmail(identity.email);
  if (!member || member.status !== 'active') return null;
  const workspace = await workspacesRepo.findById(member.workspaceId);
  if (!workspace) return null;
  return { identity, member, workspace };
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
