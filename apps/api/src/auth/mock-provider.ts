import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { membersRepo } from '@hm/db';
import {
  AuthError,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type IAuthProvider,
  type SignUpResult,
} from '@hm/shared';

interface MockTokenPayload {
  authUserId: string;
  email: string;
  iat: number;
}

/**
 * Provider de auth para dev (sem Supabase). Aceita qualquer senha para um member
 * existente (resolvido por email). Token = payload base64url (não assinado — só dev).
 * TODO(auth): substituir pelo SupabaseAuthProvider preenchendo SUPABASE_* no .env.
 *
 * Para o cadastro self-serve em dev: `signUp` é idempotente em memória; `verifyEmailToken`
 * aceita um token de verificação bem-formado (base64url do email). A senha nunca é logada.
 */
export class MockAuthProvider implements IAuthProvider {
  /** Usuários "criados" em dev (email→authUserId). Não persiste; só coerência por processo. */
  private readonly users = new Map<string, string>();

  readonly kind = 'mock' as const;

  async signIn({ email }: AuthCredentials): Promise<AuthSession> {
    const member = await membersRepo.findByEmail(email);
    if (!member) throw new AuthError('Credenciais inválidas.', 'invalid_credentials');
    const identity: AuthIdentity = { authUserId: member.authUserId, email: member.email };
    const payload: MockTokenPayload = { ...identity, iat: Date.now() };
    const accessToken = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { accessToken, identity, expiresAt: null };
  }

  async verifyToken(token: string): Promise<AuthIdentity | null> {
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as MockTokenPayload;
      if (!payload.authUserId || !payload.email) return null;
      return { authUserId: payload.authUserId, email: payload.email };
    } catch {
      return null; // token malformado
    }
  }

  async signOut(): Promise<void> {
    // stateless: o logout limpa o cookie no servidor.
  }

  /** Idempotente por email (em memória). Não confirma email — paridade com o real. */
  async signUp({ email }: AuthCredentials): Promise<SignUpResult> {
    const normalized = email.trim().toLowerCase();
    const existing = this.users.get(normalized);
    if (existing) return { authUserId: existing, created: false };
    const id = randomUUID();
    this.users.set(normalized, id);
    return { authUserId: id, created: true };
  }

  async requestPasswordReset(): Promise<void> {
    // dev: sem provedor de email; sempre resolve (anti-enumeração).
  }

  async resendVerification(): Promise<void> {
    // dev: sem provedor de email; sempre resolve.
  }

  /**
   * Em dev, o token de verificação é o email codificado em base64url
   * (`mockVerifyToken(email)`). Aceita-o e devolve a identidade correspondente.
   */
  async verifyEmailToken(token: string): Promise<AuthIdentity | null> {
    try {
      const email = Buffer.from(token, 'base64url').toString('utf8').trim().toLowerCase();
      if (!email.includes('@')) return null;
      const authUserId = this.users.get(email) ?? randomUUID();
      return { authUserId, email };
    } catch {
      return null;
    }
  }

  /**
   * dev: aceita um token de recuperação bem-formado (base64url de um email) e
   * "troca" a senha (no-op em memória). Token malformado → false.
   */
  async confirmPasswordReset(token: string): Promise<boolean> {
    try {
      const email = Buffer.from(token, 'base64url').toString('utf8').trim().toLowerCase();
      return email.includes('@');
    } catch {
      return false;
    }
  }
}

/** Helper de teste/dev: gera o token de verificação aceito pelo MockAuthProvider. */
export function mockVerifyToken(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), 'utf8').toString('base64url');
}
