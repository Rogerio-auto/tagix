/**
 * Contrato do SupabaseAuthProvider, com o cliente auth-js e o `fetch` global dublados.
 *
 * SEC-08 — `verifyToken`:
 *  - `null` SÓ para token genuinamente inválido (erro de API não-retryable);
 *  - LANÇA `AuthProviderUnavailableError` para indisponibilidade (fetch rejeitou
 *    ou 502/503/504 retryable) — permitindo à camada resiliente servir stale.
 *
 * F71-S02 — lookup por email exato (paginado), convite, link de acesso, completar
 * conta, trocar senha e `email_unverified` no login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SupabaseModule from '@supabase/supabase-js';
import { AuthError } from '@hm/shared';

const getUserMock = vi.fn<() => Promise<unknown>>();
const signInWithPasswordMock = vi.fn<() => Promise<unknown>>();
const signInWithOtpMock = vi.fn<(args: unknown) => Promise<unknown>>();
const resendMock = vi.fn<() => Promise<unknown>>();
const verifyOtpMock = vi.fn<() => Promise<unknown>>();

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof SupabaseModule>();
  return {
    ...actual,
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
        signInWithPassword: signInWithPasswordMock,
        signInWithOtp: signInWithOtpMock,
        resend: resendMock,
        verifyOtp: verifyOtpMock,
      },
    })),
  };
});

const { AuthApiError, AuthRetryableFetchError } = await import('@supabase/supabase-js');
const { SupabaseAuthProvider, AuthProviderUnavailableError, PASSWORD_SET_FLAG } =
  await import('./supabase-provider');

const SUPABASE_URL = 'https://abc123.supabase.co';
const APP = 'https://app.leadium.com.br';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function makeProvider() {
  return new SupabaseAuthProvider(SUPABASE_URL, 'anon-key', 'service-key');
}

/** Só a anon key: os verbos admin não têm como rodar. */
function makeProviderWithoutServiceKey() {
  return new SupabaseAuthProvider(SUPABASE_URL, 'anon-key');
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function goTrueUser(id: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email,
    email_confirmed_at: '2026-10-01T00:00:00Z',
    invited_at: null,
    app_metadata: { provider: 'email', providers: ['email'] },
    ...extra,
  };
}

/** URL e corpo de uma chamada do `fetch` dublado. */
function call(index: number): { url: URL; init: RequestInit | undefined } {
  const args = fetchMock.mock.calls[index];
  if (!args) throw new Error(`fetch não foi chamado ${index + 1}x`);
  const [input, init] = args;
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return { url: new URL(raw), init };
}

function bodyOf(index: number): unknown {
  const body = call(index).init?.body;
  return typeof body === 'string' ? JSON.parse(body) : null;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', APP);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const m of [
    getUserMock,
    signInWithPasswordMock,
    signInWithOtpMock,
    resendMock,
    verifyOtpMock,
    fetchMock,
  ]) {
    m.mockReset();
  }
});

describe('SupabaseAuthProvider.verifyToken (SEC-08)', () => {
  it('usuário válido → identidade', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com' } },
      error: null,
    });
    await expect(makeProvider().verifyToken('tok')).resolves.toEqual({
      authUserId: 'u1',
      email: 'a@b.com',
    });
  });

  it('erro de API (token expirado/revogado, 401) → null (invalidação definitiva)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('invalid JWT: token is expired', 401, 'bad_jwt'),
    });
    await expect(makeProvider().verifyToken('tok')).resolves.toBeNull();
  });

  it('erro retryable (rede/5xx) → LANÇA AuthProviderUnavailableError', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });
    await expect(makeProvider().verifyToken('tok')).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('getUser rejeita (throw inesperado) → LANÇA AuthProviderUnavailableError', async () => {
    getUserMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(makeProvider().verifyToken('tok')).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it('sem user e sem erro (resposta anômala) → null', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(makeProvider().verifyToken('tok')).resolves.toBeNull();
  });
});

describe('SupabaseAuthProvider.signIn', () => {
  async function codeOf(promise: Promise<unknown>): Promise<string> {
    const err: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AuthError);
    return err instanceof AuthError ? err.code : '';
  }

  it('sucesso → sessão com expiração em ms', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: { access_token: 'at', expires_at: 1_800_000_000 },
        user: { id: ID_A, email: 'ana@x.com' },
      },
      error: null,
    });
    await expect(makeProvider().signIn({ email: 'ana@x.com', password: 'p' })).resolves.toEqual({
      accessToken: 'at',
      identity: { authUserId: ID_A, email: 'ana@x.com' },
      expiresAt: 1_800_000_000_000,
    });
  });

  it('GoTrue 400 error_code=email_not_confirmed → email_unverified', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
    });
    expect(await codeOf(makeProvider().signIn({ email: 'a@x.com', password: 'p' }))).toBe(
      'email_unverified',
    );
  });

  it('GoTrue legado (só a mensagem "Email not confirmed") → email_unverified', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError('Email not confirmed', 400, undefined),
    });
    expect(await codeOf(makeProvider().signIn({ email: 'a@x.com', password: 'p' }))).toBe(
      'email_unverified',
    );
  });

  it('senha errada (invalid_credentials) → invalid_credentials', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    expect(await codeOf(makeProvider().signIn({ email: 'a@x.com', password: 'p' }))).toBe(
      'invalid_credentials',
    );
  });

  it('indisponibilidade (retryable ou throw) → provider_error', async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthRetryableFetchError('fetch failed', 503),
    });
    expect(await codeOf(makeProvider().signIn({ email: 'a@x.com', password: 'p' }))).toBe(
      'provider_error',
    );
    signInWithPasswordMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await codeOf(makeProvider().signIn({ email: 'a@x.com', password: 'p' }))).toBe(
      'provider_error',
    );
  });
});

describe('SupabaseAuthProvider.findUserByEmail (email exato, A4)', () => {
  it('dois emails que compartilham trecho → só o idêntico casa', async () => {
    // O GoTrue trata `filter` como trecho: "ana@x.com" também traz "joana@x.com".
    fetchMock.mockResolvedValue(
      json({
        users: [goTrueUser(ID_B, 'joana@x.com'), goTrueUser(ID_A, 'ana@x.com')],
        aud: 'authenticated',
      }),
    );
    await expect(makeProvider().findUserByEmail('  Ana@X.com ')).resolves.toEqual({
      authUserId: ID_A,
      emailConfirmed: true,
      hasPassword: true,
    });
    const { url, init } = call(0);
    expect(url.pathname).toBe('/auth/v1/admin/users');
    expect(url.searchParams.get('filter')).toBe('ana@x.com');
    expect(url.searchParams.get('page')).toBe('1');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer service-key');
  });

  it('só um email que CONTÉM o procurado → null (nunca o primeiro da lista)', async () => {
    fetchMock.mockResolvedValue(json({ users: [goTrueUser(ID_B, 'joana@x.com')] }));
    await expect(makeProvider().findUserByEmail('ana@x.com')).resolves.toBeNull();
  });

  it('pagina até achar (página cheia → busca a próxima)', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      goTrueUser(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `xana${i}@x.com`),
    );
    fetchMock
      .mockResolvedValueOnce(json({ users: fullPage }))
      .mockResolvedValueOnce(json({ users: [goTrueUser(ID_A, 'ana@x.com')] }));
    const found = await makeProvider().findUserByEmail('ana@x.com');
    expect(found?.authUserId).toBe(ID_A);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).url.searchParams.get('page')).toBe('2');
  });

  it('conta de convite não completada → hasPassword:false; com a marca → true', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        users: [
          goTrueUser(ID_A, 'ana@x.com', {
            invited_at: '2026-10-01T00:00:00Z',
            email_confirmed_at: null,
          }),
        ],
      }),
    );
    await expect(makeProvider().findUserByEmail('ana@x.com')).resolves.toEqual({
      authUserId: ID_A,
      emailConfirmed: false,
      hasPassword: false,
    });
    fetchMock.mockResolvedValueOnce(
      json({
        users: [
          goTrueUser(ID_A, 'ana@x.com', {
            invited_at: '2026-10-01T00:00:00Z',
            app_metadata: { provider: 'email', [PASSWORD_SET_FLAG]: true },
          }),
        ],
      }),
    );
    const done = await makeProvider().findUserByEmail('ana@x.com');
    expect(done?.hasPassword).toBe(true);
  });

  it('"não sei" nunca vira "não existe": 5xx, rede, formato e sem service key LANÇAM', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(makeProvider().findUserByEmail('ana@x.com')).rejects.toMatchObject({
      code: 'provider_error',
    });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(makeProvider().findUserByEmail('ana@x.com')).rejects.toMatchObject({
      code: 'provider_error',
    });
    fetchMock.mockResolvedValueOnce(json({ unexpected: true }));
    await expect(makeProvider().findUserByEmail('ana@x.com')).rejects.toMatchObject({
      code: 'provider_error',
    });
    await expect(
      makeProviderWithoutServiceKey().findUserByEmail('ana@x.com'),
    ).rejects.toMatchObject({
      code: 'provider_error',
    });
  });
});

describe('SupabaseAuthProvider.signUp — idempotência usa o lookup exato', () => {
  it('422 (já registrado) → created:false com o id do email idêntico', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ code: 422, error_code: 'email_exists', msg: 'already registered' }, 422),
      )
      .mockResolvedValueOnce(
        json({ users: [goTrueUser(ID_B, 'joana@x.com'), goTrueUser(ID_A, 'ana@x.com')] }),
      );
    await expect(makeProvider().signUp({ email: 'ana@x.com', password: 's' })).resolves.toEqual({
      authUserId: ID_A,
      created: false,
    });
  });

  it('criação grava a marca de senha definida', async () => {
    fetchMock.mockResolvedValueOnce(json(goTrueUser(ID_A, 'ana@x.com')));
    resendMock.mockResolvedValue({ data: {}, error: null });
    await makeProvider().signUp({ email: 'ana@x.com', password: 's' });
    expect(bodyOf(0)).toMatchObject({
      email_confirm: false,
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  });
});

describe('SupabaseAuthProvider.sendInvite', () => {
  it('sem conta → POST /invite com redirect_to no app', async () => {
    fetchMock.mockResolvedValueOnce(json(goTrueUser(ID_A, 'ana@x.com', { invited_at: 'x' })));
    await expect(makeProvider().sendInvite('Ana@x.com', '/convite/tok123')).resolves.toEqual({
      authUserId: ID_A,
      channel: 'invite',
    });
    const { url, init } = call(0);
    expect(url.pathname).toBe('/auth/v1/invite');
    expect(url.searchParams.get('redirect_to')).toBe(`${APP}/convite/tok123`);
    expect(init?.method).toBe('POST');
    expect(bodyOf(0)).toEqual({ email: 'ana@x.com' });
  });

  it('email já existente (422 email_exists) → cai para o link de acesso com o id existente', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            code: 422,
            error_code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          },
          422,
        ),
      )
      .mockResolvedValueOnce(
        json({ users: [goTrueUser(ID_B, 'joana@x.com'), goTrueUser(ID_A, 'ana@x.com')] }),
      );
    signInWithOtpMock.mockResolvedValue({ data: {}, error: null });

    await expect(makeProvider().sendInvite('ana@x.com', '/convite/tok123')).resolves.toEqual({
      authUserId: ID_A,
      channel: 'sign_in_link',
    });
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: 'ana@x.com',
      options: { shouldCreateUser: false, emailRedirectTo: `${APP}/convite/tok123` },
    });
  });

  it('email já existente no formato legado (só a mensagem) → também cai para o link', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ code: 422, msg: 'A user with this email address has already been registered' }, 422),
      )
      .mockResolvedValueOnce(json({ users: [goTrueUser(ID_A, 'ana@x.com')] }));
    signInWithOtpMock.mockResolvedValue({ data: {}, error: null });
    const result = await makeProvider().sendInvite('ana@x.com', '/convite/tok123');
    expect(result.channel).toBe('sign_in_link');
  });

  it('rate limit de email (429) → provider_error (rota oferece o link copiável)', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'rate limit' }, 429),
    );
    await expect(makeProvider().sendInvite('ana@x.com', '/convite/t')).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('destino fora do app ou sem base configurada → recusa antes de chamar o provider', async () => {
    for (const bad of ['https://evil.com/convite/t', '//evil.com/x', '/x\\y', 'convite/t']) {
      await expect(makeProvider().sendInvite('ana@x.com', bad)).rejects.toMatchObject({
        code: 'provider_error',
      });
    }
    vi.stubEnv('AUTH_EMAIL_REDIRECT_URL', '');
    await expect(makeProvider().sendInvite('ana@x.com', '/convite/t')).rejects.toMatchObject({
      code: 'provider_error',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL absoluta na mesma origem do app é aceita', async () => {
    fetchMock.mockResolvedValueOnce(json(goTrueUser(ID_A, 'ana@x.com')));
    await makeProvider().sendInvite('ana@x.com', `${APP}/convite/t`);
    expect(call(0).url.searchParams.get('redirect_to')).toBe(`${APP}/convite/t`);
  });

  it('sem service key → provider_error', async () => {
    await expect(
      makeProviderWithoutServiceKey().sendInvite('ana@x.com', '/convite/t'),
    ).rejects.toMatchObject({ code: 'provider_error' });
  });
});

describe('SupabaseAuthProvider.sendSignInLink', () => {
  it('conta existente → signInWithOtp sem criar usuário, redirect no app', async () => {
    signInWithOtpMock.mockResolvedValue({ data: {}, error: null });
    await makeProvider().sendSignInLink(' Ana@X.com', '/convite/t');
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: 'ana@x.com',
      options: { shouldCreateUser: false, emailRedirectTo: `${APP}/convite/t` },
    });
  });

  it('sem conta ("Signups not allowed for otp") → resolve em silêncio (anti-enumeração)', async () => {
    signInWithOtpMock.mockResolvedValue({
      data: {},
      error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
    });
    await expect(makeProvider().sendSignInLink('x@x.com', '/convite/t')).resolves.toBeUndefined();
  });

  it('rate limit / indisponibilidade → provider_error', async () => {
    signInWithOtpMock.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('rate limit', 429, 'over_email_send_rate_limit'),
    });
    await expect(makeProvider().sendSignInLink('a@x.com', '/convite/t')).rejects.toMatchObject({
      code: 'provider_error',
    });
    signInWithOtpMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(makeProvider().sendSignInLink('a@x.com', '/convite/t')).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('destino fora do app → recusa sem chamar o provider', async () => {
    await expect(
      makeProvider().sendSignInLink('a@x.com', 'https://evil.com/'),
    ).rejects.toMatchObject({ code: 'provider_error' });
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });
});

describe('SupabaseAuthProvider.completeAccount / updatePassword', () => {
  it('completeAccount → PUT admin com senha, email_confirm e a marca', async () => {
    fetchMock.mockResolvedValueOnce(json(goTrueUser(ID_A, 'ana@x.com')));
    await expect(makeProvider().completeAccount(ID_A, 'S3nha-forte!')).resolves.toBe(true);
    const { url, init } = call(0);
    expect(url.pathname).toBe(`/auth/v1/admin/users/${ID_A}`);
    expect(init?.method).toBe('PUT');
    expect(bodyOf(0)).toEqual({
      password: 'S3nha-forte!',
      email_confirm: true,
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  });

  it('updatePassword → PUT admin sem mexer na confirmação', async () => {
    fetchMock.mockResolvedValueOnce(json(goTrueUser(ID_A, 'ana@x.com')));
    await expect(makeProvider().updatePassword(ID_A, 'Outra-S3nha')).resolves.toBe(true);
    expect(bodyOf(0)).toEqual({
      password: 'Outra-S3nha',
      app_metadata: { [PASSWORD_SET_FLAG]: true },
    });
  });

  it('recusa do provider (senha fraca 422), rede ou id inválido → false, sem lançar', async () => {
    fetchMock.mockResolvedValueOnce(json({ error_code: 'weak_password' }, 422));
    await expect(makeProvider().completeAccount(ID_A, '123')).resolves.toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(makeProvider().updatePassword(ID_A, 'x')).resolves.toBe(false);
    // Id fora do formato nem chega ao provider (sem path traversal na URL admin).
    await expect(makeProvider().updatePassword('../users', 'x')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sem service key → false', async () => {
    await expect(makeProviderWithoutServiceKey().completeAccount(ID_A, 'x')).resolves.toBe(false);
    await expect(makeProviderWithoutServiceKey().updatePassword(ID_A, 'x')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
