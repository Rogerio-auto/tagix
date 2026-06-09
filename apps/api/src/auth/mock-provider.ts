import { Buffer } from 'node:buffer';
import { membersRepo } from '@hm/db';
import {
  AuthError,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type IAuthProvider,
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
 */
export class MockAuthProvider implements IAuthProvider {
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
}
