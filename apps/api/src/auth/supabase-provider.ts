import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AuthError,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type IAuthProvider,
} from '@hm/shared';

/** Adapter Supabase Auth (login por senha + verificação de token). */
export class SupabaseAuthProvider implements IAuthProvider {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async signIn({ email, password }: AuthCredentials): Promise<AuthSession> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      throw new AuthError(error?.message ?? 'Credenciais inválidas.', 'invalid_credentials');
    }
    return {
      accessToken: data.session.access_token,
      identity: { authUserId: data.user.id, email: data.user.email ?? email },
      expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : null,
    };
  }

  async verifyToken(token: string): Promise<AuthIdentity | null> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) return null;
    return { authUserId: data.user.id, email: data.user.email ?? '' };
  }

  async signOut(token: string): Promise<void> {
    try {
      await this.client.auth.admin.signOut(token);
    } catch {
      // best-effort (precisa de service role; o cookie já é limpo no servidor)
    }
  }
}
