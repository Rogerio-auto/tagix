import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AuthError,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type IAuthProvider,
  type SignUpResult,
} from '@hm/shared';

/**
 * Adapter Supabase Auth: login por senha, verificação de token, e os verbos do
 * cadastro self-serve (signup com email NÃO confirmado, reset, verify).
 *
 * Duas chaves:
 *  - `anonKey`: cliente público (login/verify de token de sessão).
 *  - `serviceKey` (opcional, server-side): admin REST API para criar usuário com
 *    `email_confirm:false`. NUNCA exposta ao cliente. Sem ela, `signUp` falha
 *    explicitamente (provider_error) — não há fallback inseguro.
 *
 * O `redirectTo` dos emails (reset/verify) aponta para a app web (env
 * `AUTH_EMAIL_REDIRECT_URL`), nunca para um destino controlado pelo atacante.
 */
export class SupabaseAuthProvider implements IAuthProvider {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;
  private readonly url: string;
  private readonly serviceKey: string | undefined;

  constructor(url: string, anonKey: string, serviceKey?: string) {
    this.url = url.replace(/\/$/, '');
    this.serviceKey = serviceKey;
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private get emailRedirectTo(): string | undefined {
    return process.env['AUTH_EMAIL_REDIRECT_URL'] || undefined;
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

  /**
   * Cria o usuário via admin REST API com `email_confirm:false` (bloqueio duro).
   * Idempotente: email já registrado → `{ created:false }`. A senha vai só no body
   * HTTPS para o Supabase; nunca é logada.
   */
  async signUp({ email, password }: AuthCredentials): Promise<SignUpResult> {
    if (!this.serviceKey) {
      throw new AuthError('Signup indisponível: service key ausente.', 'provider_error');
    }
    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: false }),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      const id = extractUserId(body);
      if (!id) throw new AuthError('Resposta inesperada do provider.', 'provider_error');
      // Dispara o email de confirmação (admin create não envia por padrão).
      await this.dispatchVerificationEmail(email);
      return { authUserId: id, created: true };
    }
    const text = await res.text();
    if (res.status === 422 || /already.*registered|exists/i.test(text)) {
      // Idempotente / anti-enumeração: não lança, devolve o id quando recuperável.
      const existingId = await this.lookupUserId(email);
      return { authUserId: existingId ?? '', created: false };
    }
    throw new AuthError('Falha ao criar usuário no provider.', 'provider_error');
  }

  async requestPasswordReset(email: string): Promise<void> {
    try {
      await this.client.auth.resetPasswordForEmail(email, {
        redirectTo: this.emailRedirectTo,
      });
    } catch {
      // Anti-enumeração: sempre resolve, mesmo em erro/email inexistente.
    }
  }

  async resendVerification(email: string): Promise<void> {
    await this.dispatchVerificationEmail(email);
  }

  /**
   * Valida o token do link de verificação. Suporta o fluxo de `verifyOtp` (token_hash
   * `type:signup|email`). Token inválido/expirado → `null`, sem lançar.
   */
  async verifyEmailToken(token: string): Promise<AuthIdentity | null> {
    try {
      const { data, error } = await this.client.auth.verifyOtp({
        token_hash: token,
        type: 'email',
      });
      if (error || !data.user) return null;
      return { authUserId: data.user.id, email: data.user.email ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * Confirma a redefinição: valida o token de recuperação (`verifyOtp type:recovery`)
   * e troca a senha do usuário via admin API (server-side). Token inválido/expirado
   * ou sem service key → `false`, sem lançar. A senha vai só no body HTTPS, nunca logada.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<boolean> {
    if (!this.serviceKey) return false;
    let userId: string;
    try {
      const { data, error } = await this.client.auth.verifyOtp({
        token_hash: token,
        type: 'recovery',
      });
      if (error || !data.user) return false;
      userId = data.user.id;
    } catch {
      return false;
    }
    try {
      const res = await fetch(`${this.url}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: this.serviceKey,
          Authorization: `Bearer ${this.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Reenvia/dispara o email de confirmação (anti-enumeração: sempre resolve). */
  private async dispatchVerificationEmail(email: string): Promise<void> {
    try {
      await this.client.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: this.emailRedirectTo },
      });
    } catch {
      // best-effort; não revela existência do email.
    }
  }

  /** Best-effort lookup do id por email via admin API (idempotência de signup). */
  private async lookupUserId(email: string): Promise<string | null> {
    if (!this.serviceKey) return null;
    try {
      const res = await fetch(
        `${this.url}/auth/v1/admin/users?filter=${encodeURIComponent(`email eq "${email}"`)}`,
        {
          headers: {
            apikey: this.serviceKey,
            Authorization: `Bearer ${this.serviceKey}`,
          },
        },
      );
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'users' in body) {
        const users = (body as { users: unknown }).users;
        if (Array.isArray(users) && users.length > 0) return extractUserId(users[0]);
      }
      return null;
    } catch {
      return null;
    }
  }
}

/** Narrowing seguro do id do usuário na resposta do Supabase (sem `any`). */
function extractUserId(body: unknown): string | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
