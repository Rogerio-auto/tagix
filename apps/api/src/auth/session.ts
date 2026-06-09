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

/** Verifica o token e resolve member + workspace (member precisa estar ativo). */
export async function resolveSession(token: string): Promise<SessionContext | null> {
  const identity = await getAuthProvider().verifyToken(token);
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
