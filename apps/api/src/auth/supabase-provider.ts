import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
  type UserResponse,
} from '@supabase/supabase-js';
import { z } from 'zod';
import {
  AuthError,
  resolveEmailRedirect,
  type AuthCredentials,
  type AuthIdentity,
  type AuthSession,
  type AuthUserLookup,
  type EmailProofType,
  type IAccountAuthProvider,
  type InviteResult,
  type SignUpResult,
} from '@hm/shared';

/**
 * Falha de INFRA na verificação de token (rede/timeout/5xx do Supabase) — distinta
 * de token inválido. O contrato do `verifyToken` (SEC-08):
 *  - retorna `null`  → token genuinamente inválido/expirado/revogado (NUNCA honrar);
 *  - LANÇA este erro → provider indisponível (o cache resiliente pode servir stale).
 */
export class AuthProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthProviderUnavailableError';
  }
}

/**
 * Marca em `app_metadata` (só a service key escreve; o usuário não altera) gravada
 * sempre que ESTE adapter define uma senha. O GoTrue não expõe o hash da senha, então
 * é por ela que `findUserByEmail` sabe se uma conta criada por convite já foi completada.
 */
export const PASSWORD_SET_FLAG = 'hm_password_set';

/** Página da listagem admin. Com o `filter` do GoTrue a 1ª página quase sempre basta. */
const LIST_PER_PAGE = 100;
/** Teto de páginas: passou disso, "não sei" (lança) em vez de "não existe". */
const LIST_MAX_PAGES = 50;
/** Teto de cada chamada à API admin: o Supabase lento não prende o request do usuário. */
const ADMIN_TIMEOUT_MS = 10_000;

/** Usuário como a API admin do GoTrue devolve (só os campos que usamos). */
const goTrueUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().nullish(),
  email_confirmed_at: z.string().nullish(),
  invited_at: z.string().nullish(),
  app_metadata: z.record(z.unknown()).nullish(),
});
type GoTrueUser = z.infer<typeof goTrueUserSchema>;

/** `GET /admin/users` → `{ users: [...], aud }`. Cada item é validado à parte. */
const goTrueUserListSchema = z.object({ users: z.array(z.unknown()) });

/** Resposta do `POST /verify` (sessão). Só o usuário interessa; o token é revogado. */
const verifySessionSchema = z.object({
  access_token: z.string().min(1).optional(),
  user: goTrueUserSchema.nullish(),
});

/**
 * Corpo de erro do GoTrue. Varia por versão: `error_code` (atual), `code` (numérico em
 * respostas antigas, string em algumas), `msg`/`message`/`error_description`.
 */
const goTrueErrorSchema = z.object({
  error_code: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
  error_description: z.string().optional(),
});

interface GoTrueErrorInfo {
  status: number;
  code: string | undefined;
  message: string;
}

const uuidSchema = z.string().uuid();

/**
 * Adapter Supabase Auth: login por senha, verificação de token, os verbos do cadastro
 * self-serve (signup com email NÃO confirmado, reset, verify) e os de conta da F71
 * (lookup exato, convite, link de acesso, completar conta, trocar senha).
 *
 * Duas chaves:
 *  - `anonKey`: cliente público (login, verify, OTP, reset).
 *  - `serviceKey` (opcional, server-side): API admin (criar/atualizar/listar usuário,
 *    convite). NUNCA exposta ao cliente. Sem ela, os verbos admin falham explicitamente
 *    — não há fallback inseguro.
 *
 * Todo link de email aponta para o app (`AUTH_EMAIL_REDIRECT_URL`), nunca para um
 * destino controlado pelo atacante (ver `resolveEmailRedirect`).
 */
export class SupabaseAuthProvider implements IAccountAuthProvider {
  readonly kind = 'supabase' as const;
  private readonly client: SupabaseClient;
  private readonly url: string;
  private readonly anonKey: string;
  private readonly serviceKey: string | undefined;

  constructor(url: string, anonKey: string, serviceKey?: string) {
    this.url = url.replace(/\/$/, '');
    this.anonKey = anonKey;
    this.serviceKey = serviceKey;
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Destino do link de email para um caminho específico do app. `AUTH_EMAIL_REDIRECT_URL`
   * é a BASE (ex.: https://app.leadium.com.br); cada fluxo aponta para a SUA página
   * (`/verify`, `/reset-password`) — onde a allowlist do Supabase espera e onde o token
   * é lido. Sem base → undefined (Supabase cai no Site URL configurado).
   */
  private redirectFor(path: string): string | undefined {
    const base = process.env['AUTH_EMAIL_REDIRECT_URL'];
    return base ? base.replace(/\/+$/, '') + path : undefined;
  }

  /**
   * Destino de convite/link de acesso. Diferente de `redirectFor`, aqui a base é
   * obrigatória: sem ela o Supabase cairia no Site URL e o token do caminho
   * (`/convite/<token>`) se perderia — melhor falhar antes de mandar um email inútil.
   */
  private requireRedirect(redirectTo: string): string {
    const target = resolveEmailRedirect(redirectTo, process.env['AUTH_EMAIL_REDIRECT_URL']);
    if (!target) {
      throw new AuthError(
        'Destino do link de email recusado (fora do app ou AUTH_EMAIL_REDIRECT_URL ausente).',
        'provider_error',
      );
    }
    return target;
  }

  private requireServiceKey(): string {
    if (!this.serviceKey) {
      throw new AuthError('Operação admin indisponível: service key ausente.', 'provider_error');
    }
    return this.serviceKey;
  }

  private adminHeaders(serviceKey: string): Record<string, string> {
    return {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };
  }

  async signIn({ email, password }: AuthCredentials): Promise<AuthSession> {
    let result: Awaited<ReturnType<SupabaseClient['auth']['signInWithPassword']>>;
    try {
      result = await this.client.auth.signInWithPassword({ email, password });
    } catch {
      throw new AuthError('Provider de auth indisponível.', 'provider_error');
    }
    const { data, error } = result;
    if (error) {
      // O GoTrue só chega em "email não confirmado" DEPOIS de aceitar a senha (senha
      // errada responde invalid_credentials antes), então isto não enumera contas.
      if (isEmailNotConfirmed(error)) {
        throw new AuthError('Email não confirmado.', 'email_unverified');
      }
      if (isAuthRetryableFetchError(error)) {
        throw new AuthError('Provider de auth indisponível.', 'provider_error');
      }
      throw new AuthError('Credenciais inválidas.', 'invalid_credentials');
    }
    if (!data.session || !data.user) {
      throw new AuthError('Credenciais inválidas.', 'invalid_credentials');
    }
    return {
      accessToken: data.session.access_token,
      identity: { authUserId: data.user.id, email: data.user.email ?? email },
      expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : null,
    };
  }

  /**
   * SEC-08: `null` SÓ quando o token é genuinamente inválido (expirado/revogado/
   * malformado). Erro de rede/5xx (retryable) LANÇA `AuthProviderUnavailableError`
   * — assim a camada de cache resiliente distingue "invalide já" de "blip de infra".
   */
  async verifyToken(token: string): Promise<AuthIdentity | null> {
    let result: UserResponse;
    try {
      result = await this.client.auth.getUser(token);
    } catch (err) {
      // auth-js normalmente devolve erros em `error` (não lança); se lançou, é infra.
      throw new AuthProviderUnavailableError(
        err instanceof Error ? err.message : 'auth provider fetch failed',
        { cause: err },
      );
    }
    const { data, error } = result;
    if (error) {
      if (isAuthRetryableFetchError(error)) {
        // Fetch rejeitou ou 502/503/504 — indisponibilidade, não invalidação.
        throw new AuthProviderUnavailableError(error.message, { cause: error });
      }
      return null; // token inválido/expirado/revogado — decisão do provider
    }
    if (!data.user) return null;
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
      headers: this.adminHeaders(this.serviceKey),
      body: JSON.stringify({
        email,
        password,
        email_confirm: false,
        app_metadata: { [PASSWORD_SET_FLAG]: true },
      }),
      signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
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
        redirectTo: this.redirectFor('/reset-password'),
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
    return this.adminUpdateUser(userId, {
      password: newPassword,
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  }

  async findUserByEmail(email: string): Promise<AuthUserLookup | null> {
    const user = await this.findAdminUserByEmail(email);
    if (!user) return null;
    return {
      authUserId: user.id,
      emailConfirmed: Boolean(user.email_confirmed_at),
      hasPassword: user.app_metadata?.[PASSWORD_SET_FLAG] === true || !user.invited_at,
    };
  }

  /**
   * `POST /auth/v1/invite` (o mesmo de `auth.admin.inviteUserByEmail`), com a service key.
   * O GoTrue recusa com 422 `email_exists` quando a conta já existe e está confirmada
   * (conta não confirmada é reconvidada) — nesse caso cai para o link de acesso.
   */
  async sendInvite(email: string, redirectTo: string): Promise<InviteResult> {
    const serviceKey = this.requireServiceKey();
    const target = this.requireRedirect(redirectTo);
    const normalized = normalizeEmail(email);

    let res: Response;
    try {
      res = await fetch(`${this.url}/auth/v1/invite?redirect_to=${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: this.adminHeaders(serviceKey),
        body: JSON.stringify({ email: normalized }),
        signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      });
    } catch {
      throw new AuthError('Provider de auth indisponível ao enviar convite.', 'provider_error');
    }

    if (res.ok) {
      const parsed = goTrueUserSchema.safeParse(await readJson(res));
      if (!parsed.success) {
        throw new AuthError('Resposta inesperada do provider no convite.', 'provider_error');
      }
      return { authUserId: parsed.data.id, channel: 'invite' };
    }

    const info = await readGoTrueError(res);
    if (isEmailExists(info)) {
      const existing = await this.findAdminUserByEmail(normalized);
      if (!existing) {
        throw new AuthError('Conta existente não localizada após o convite.', 'provider_error');
      }
      await this.sendSignInLink(normalized, redirectTo);
      return { authUserId: existing.id, channel: 'sign_in_link' };
    }
    // Sem o email na mensagem (PII); status + código bastam para diagnóstico.
    throw new AuthError(
      `Convite recusado pelo provider (${info.status}${info.code ? ` ${info.code}` : ''}).`,
      'provider_error',
    );
  }

  /**
   * `signInWithOtp({ shouldCreateUser:false })` — template "Magic link". Sem conta, o
   * GoTrue responde 422 "Signups not allowed for otp"; isso resolve em silêncio
   * (anti-enumeração). Qualquer outra recusa (rate limit, SMTP, 5xx) lança.
   */
  async sendSignInLink(email: string, redirectTo: string): Promise<void> {
    const target = this.requireRedirect(redirectTo);
    let result: Awaited<ReturnType<SupabaseClient['auth']['signInWithOtp']>>;
    try {
      result = await this.client.auth.signInWithOtp({
        email: normalizeEmail(email),
        options: { shouldCreateUser: false, emailRedirectTo: target },
      });
    } catch {
      throw new AuthError('Provider de auth indisponível ao enviar o link.', 'provider_error');
    }
    const { error } = result;
    if (!error) return;
    if (isNoAccountForOtp(error)) return;
    throw new AuthError(
      `Link de acesso recusado pelo provider (${error.status ?? 0}${error.code ? ` ${error.code}` : ''}).`,
      'provider_error',
    );
  }

  async completeAccount(authUserId: string, password: string): Promise<boolean> {
    return this.adminUpdateUser(authUserId, {
      password,
      email_confirm: true,
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  }

  /**
   * `POST /auth/v1/verify { type, token_hash }` por `fetch` direto (não pelo cliente
   * auth-js compartilhado, que guardaria a sessão em memória do processo). O GoTrue
   * consome o `token_hash` (uso único) e devolve uma sessão: só o usuário é lido, e a
   * sessão é revogada em seguida (`/logout?scope=local`, best-effort) — a prova não vira
   * login de ninguém.
   *
   * Tipo no GoTrue: `invite` → `invite` (procura pelo `confirmation_token`); `magiclink`
   * → `email`, o tipo atual recomendado (o `magiclink` está deprecado) e que procura pelo
   * `confirmation_token` OU `recovery_token` — cobre o link de acesso de conta
   * confirmada (recovery) e o de conta ainda não confirmada.
   *
   * 4xx (expirado, já usado, inexistente) → `null`. Rede, 429 e 5xx → `provider_error`.
   */
  async verifyEmailOwnership(tokenHash: string, type: EmailProofType): Promise<AuthIdentity | null> {
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash)) return null;
    let res: Response;
    try {
      res = await fetch(`${this.url}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type === 'invite' ? 'invite' : 'email',
          token_hash: tokenHash,
        }),
        signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      });
    } catch {
      throw new AuthError('Provider de auth indisponível na prova de email.', 'provider_error');
    }
    if (res.status === 429 || res.status >= 500) {
      throw new AuthError(`Prova de email recusada (${res.status}).`, 'provider_error');
    }
    if (!res.ok) return null;
    const parsed = verifySessionSchema.safeParse(await readJson(res));
    if (!parsed.success) {
      throw new AuthError('Resposta inesperada do provider na prova de email.', 'provider_error');
    }
    const { access_token: accessToken } = parsed.data;
    const user = parsed.data.user;
    if (accessToken) void this.revokeSession(accessToken);
    if (!user?.email) return null;
    return { authUserId: user.id, email: normalizeEmail(user.email) };
  }

  /** Revoga a sessão criada pelo verify da prova. Best-effort: nunca lança nem espera. */
  private async revokeSession(accessToken: string): Promise<void> {
    try {
      await fetch(`${this.url}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: this.anonKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
      });
    } catch {
      // A sessão expira sozinha; o cliente nunca a recebeu.
    }
  }

  async updatePassword(authUserId: string, password: string): Promise<boolean> {
    return this.adminUpdateUser(authUserId, {
      password,
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  }

  /**
   * `PUT /admin/users/:id`. `app_metadata` é mesclado pelo GoTrue (não substitui o
   * `provider`/`providers`). Id fora do formato UUID nem chega ao provider. Nunca lança.
   */
  private async adminUpdateUser(
    authUserId: string,
    attributes: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.serviceKey) return false;
    if (!uuidSchema.safeParse(authUserId).success) return false;
    try {
      const res = await fetch(`${this.url}/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        headers: this.adminHeaders(this.serviceKey),
        body: JSON.stringify(attributes),
        signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
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
        options: { emailRedirectTo: this.redirectFor('/verify') },
      });
    } catch {
      // best-effort; não revela existência do email.
    }
  }

  /**
   * Busca na API admin pelo email EXATO.
   *
   * O `filter` de `GET /admin/users` NÃO é uma linguagem de consulta: o GoTrue o usa
   * como trecho (`email LIKE %filter%` OU `full_name ILIKE %filter%`). Por isso:
   *  - passamos o próprio email (minúsculo, como o GoTrue grava) só para estreitar;
   *  - comparamos o endereço inteiro em cada item (`ana@x.com` ≠ `joana@x.com`);
   *  - paginamos até uma página incompleta. Se o servidor ignorar o `filter`, a
   *    resposta continua correta (só mais lenta), até o teto de páginas.
   * Falha de rede/HTTP, resposta fora do formato ou teto estourado → LANÇA
   * `provider_error`: "não sei" nunca vira "não existe".
   */
  private async findAdminUserByEmail(email: string): Promise<GoTrueUser | null> {
    const serviceKey = this.requireServiceKey();
    const wanted = normalizeEmail(email);
    if (!wanted) return null;

    for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({
        page: String(page),
        per_page: String(LIST_PER_PAGE),
        filter: wanted,
      });
      let res: Response;
      try {
        res = await fetch(`${this.url}/auth/v1/admin/users?${qs.toString()}`, {
          headers: this.adminHeaders(serviceKey),
          signal: AbortSignal.timeout(ADMIN_TIMEOUT_MS),
        });
      } catch {
        throw new AuthError('Provider de auth indisponível na busca de conta.', 'provider_error');
      }
      if (!res.ok) {
        throw new AuthError(`Busca de conta recusada (${res.status}).`, 'provider_error');
      }
      const list = goTrueUserListSchema.safeParse(await readJson(res));
      if (!list.success) {
        throw new AuthError('Resposta inesperada do provider na busca de conta.', 'provider_error');
      }
      for (const raw of list.data.users) {
        const user = goTrueUserSchema.safeParse(raw);
        if (user.success && normalizeEmail(user.data.email ?? '') === wanted) return user.data;
      }
      if (list.data.users.length < LIST_PER_PAGE) return null;
    }
    throw new AuthError('Busca de conta excedeu o teto de páginas.', 'provider_error');
  }

  /** Best-effort: id da conta por email exato (idempotência de signup). Nunca lança. */
  private async lookupUserId(email: string): Promise<string | null> {
    try {
      const user = await this.findAdminUserByEmail(email);
      return user?.id ?? null;
    } catch {
      return null;
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Corpo JSON ou `null` se não for JSON (sem lançar). */
async function readJson(res: Response): Promise<unknown> {
  try {
    const parsed: unknown = await res.json();
    return parsed;
  } catch {
    return null;
  }
}

async function readGoTrueError(res: Response): Promise<GoTrueErrorInfo> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    // corpo ilegível: segue só com o status
  }
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const parsed = goTrueErrorSchema.safeParse(raw);
  if (!parsed.success) return { status: res.status, code: undefined, message: text };
  const body = parsed.data;
  return {
    status: res.status,
    code: body.error_code ?? (typeof body.code === 'string' ? body.code : undefined),
    message: body.msg ?? body.message ?? body.error_description ?? text,
  };
}

/** Conta já existe (convite recusado). Código atual + mensagem legada. */
function isEmailExists(info: GoTrueErrorInfo): boolean {
  if (info.code === 'email_exists' || info.code === 'user_already_exists') return true;
  return info.status === 422 && /already (been )?registered|already exists/i.test(info.message);
}

/**
 * Login recusado por email não confirmado. GoTrue atual: HTTP 400 com
 * `error_code: "email_not_confirmed"` em `/token?grant_type=password`; versões antigas
 * só trazem a mensagem "Email not confirmed".
 */
function isEmailNotConfirmed(error: { code?: string | undefined; message: string }): boolean {
  return error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message);
}

/** OTP com `shouldCreateUser:false` para email sem conta. */
function isNoAccountForOtp(error: { code?: string | undefined; message: string }): boolean {
  return error.code === 'user_not_found' || /signups not allowed for otp/i.test(error.message);
}

/** Narrowing seguro do id do usuário na resposta do Supabase (sem `any`). */
function extractUserId(body: unknown): string | null {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
