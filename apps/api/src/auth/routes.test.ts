import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  AuthIdentity,
  AuthUserLookup,
  IAccountAuthProvider,
  IAuthProvider,
  SignUpResult,
} from '@hm/shared';
import { AuthError } from '@hm/shared';
import { closeDb, getDb, impersonationSessionsRepo, schema } from '@hm/db';
import { closeRateLimit } from '../middlewares/rate-limit';
import type * as RateLimitModule from '../middlewares/rate-limit';
import type * as DbModule from '@hm/db';

// ─── Controla o provider de auth (sem tocar Supabase real) ───────────────────
const providerState: {
  signUpResult: SignUpResult;
  signUpThrows: boolean;
  verifyIdentity: { authUserId: string; email: string } | null;
  signInThrows: boolean;
  signInEmail: string | null;
  /** `auth_user_id` que o signIn devolve (a sessão resolve a membership por ele). */
  signInAuthUserId: string;
  /** Token emitido pelo signIn (vira o `hm_session`). */
  signInToken: string;
  confirmReset: boolean;
  verifyThrows: boolean;
  /** Código do AuthError que o signIn lança quando `signInThrows`. */
  signInErrorCode: 'invalid_credentials' | 'email_unverified';
  /** O que `findUserByEmail` devolve (signup repetido / reenvio). */
  lookup: AuthUserLookup | null;
} = {
  signUpResult: { authUserId: 'auth-user-1', created: true },
  signUpThrows: false,
  verifyIdentity: null,
  signInThrows: true,
  signInEmail: null,
  signInAuthUserId: randomUUID(),
  signInToken: 't',
  confirmReset: true,
  verifyThrows: false,
  signInErrorCode: 'invalid_credentials',
  lookup: null,
};

// Piso de tempo curto (o real é 1,2 s): os dublês resolvem em microssegundos.
vi.stubEnv('AUTH_UNIFORM_RESPONSE_MS', '60');

const resendVerificationMock = vi.fn(async (_email: string) => {});

/** Sessões válidas conhecidas pelo dublê: token → identidade (o resto é inválido). */
const liveTokens = new Map<string, AuthIdentity>();

const fakeProvider: IAuthProvider & Pick<IAccountAuthProvider, 'findUserByEmail'> = {
  kind: 'mock',
  async signIn() {
    if (providerState.signInThrows) throw new AuthError('bad', providerState.signInErrorCode);
    const email = providerState.signInEmail ?? 'x@y.z';
    const identity = { authUserId: providerState.signInAuthUserId, email };
    liveTokens.set(providerState.signInToken, identity);
    return { accessToken: providerState.signInToken, identity, expiresAt: null };
  },
  async verifyToken(token: string) {
    if (providerState.verifyThrows) throw new Error('fetch failed');
    return liveTokens.get(token) ?? null;
  },
  async signOut() {},
  async signUp() {
    if (providerState.signUpThrows) throw new AuthError('boom', 'provider_error');
    return providerState.signUpResult;
  },
  async requestPasswordReset() {},
  resendVerification: resendVerificationMock,
  async findUserByEmail() {
    return providerState.lookup;
  },
  async verifyEmailToken() {
    return providerState.verifyIdentity;
  },
  async confirmPasswordReset() {
    return providerState.confirmReset;
  },
};

vi.mock('./provider', () => ({ getAuthProvider: () => fakeProvider }));

// Gate de captcha progressivo (SEC-05): estado controlável por teste, sem Redis.
const { captchaState, recordFailureMock } = vi.hoisted(() => ({
  captchaState: { required: false },
  recordFailureMock: vi.fn(async () => {}),
}));
vi.mock('./login-captcha', () => ({
  LOGIN_CAPTCHA_THRESHOLD: 10,
  LOGIN_CAPTCHA_WINDOW_SEC: 900,
  loginCaptchaRequired: async () => captchaState.required,
  recordLoginFailure: recordFailureMock,
  closeLoginCaptcha: async () => {},
}));

// Turnstile: válido sse o body traz um token não-vazio (permite exercitar o gate
// do login sem rede; a verificação real é coberta no rate-limit.test).
vi.mock('../middlewares/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return {
    ...actual,
    verifyTurnstile: vi.fn(async (token: string) => token.length > 0),
    auditAuthEvent: vi.fn(async () => {}),
    // Simulação fiel do fixed-window em memória (honra bucket/max/byEmail) para
    // exercitar a COMPOSIÇÃO dos limiters da rota (o algoritmo real, com Redis, é
    // coberto no rate-limit.test). `x-test-ip` permite isolar o IP por teste.
    rateLimit: (opts: RateLimitModule.RateLimitOptions) => {
      const counts = new Map<string, number>();
      return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
        const testIp = req.headers['x-test-ip'];
        const ip = typeof testIp === 'string' ? testIp : (req.ip ?? 'ip');
        const parts = [opts.bucket, ip];
        if (opts.byEmail ?? true) {
          const body: unknown = req.body;
          if (body && typeof body === 'object' && 'email' in body) {
            const email = (body as { email: unknown }).email;
            if (typeof email === 'string' && email.length > 0) parts.push(email);
          }
        }
        const key = parts.join(':');
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count > opts.max) {
          res.status(429).json({ message: 'Muitas tentativas.', reason: 'rate_limited' });
          return;
        }
        next();
      };
    },
  };
});

// Mock do provisioner: controlável por teste (sucesso/erro). vi.hoisted p/ a fn
// existir antes do factory de vi.mock (que é içado ao topo).
const { provisionMock } = vi.hoisted(() => ({ provisionMock: vi.fn() }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  return { ...actual, provisionWorkspaceWithOwner: provisionMock };
});

// Importa o router DEPOIS dos mocks.
const { createAuthRouter } = await import('./routes');
const rateLimitModule = await import('../middlewares/rate-limit');
const verifyTurnstileMock = vi.mocked(rateLimitModule.verifyTurnstile);
const auditMock = vi.mocked(rateLimitModule.auditAuthEvent);

const app = express();
app.use(express.json());
// Cada POST /auth/signup ganha um IP de teste próprio (salvo se o teste fixar `x-test-ip`):
// o balde `signup_ip` (10/h por IP, F-10) esgotaria com tantos signups no mesmo IP simulado.
app.use('/auth/signup', (req, _res, next) => {
  if (typeof req.headers['x-test-ip'] !== 'string') req.headers['x-test-ip'] = randomUUID();
  next();
});
app.use(createAuthRouter());

// Workspaces criados direto no DB pelos testes de login (cascade limpa member+sub).
const createdWorkspaces: string[] = [];

beforeAll(async () => {
  const db = getDb();
  await db
    .insert(schema.plans)
    .values({ key: 'free', name: 'Free', position: 0, priceMonthlyCents: 0 })
    .onConflictDoNothing({ target: schema.plans.key });
});

afterAll(async () => {
  const db = getDb();
  for (const id of createdWorkspaces) {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }
  await closeRateLimit();
  await closeDb();
});

beforeEach(() => {
  providerState.signUpResult = { authUserId: 'auth-user-1', created: true };
  providerState.signUpThrows = false;
  providerState.verifyIdentity = null;
  providerState.signInThrows = true;
  providerState.signInEmail = null;
  providerState.signInAuthUserId = randomUUID();
  providerState.signInToken = 't';
  providerState.confirmReset = true;
  providerState.verifyThrows = false;
  providerState.signInErrorCode = 'invalid_credentials';
  providerState.lookup = null;
  resendVerificationMock.mockClear();
  auditMock.mockClear();
  captchaState.required = false;
  recordFailureMock.mockClear();
  provisionMock.mockReset();
  provisionMock.mockResolvedValue({
    workspaceId: 'ws-1',
    memberId: 'm-1',
    slug: 'acme',
    created: true,
  });
});

function validSignup(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Fulano',
    email: `user-${Math.random().toString(36).slice(2, 8)}@empresa.com`,
    password: 'senhaForte123',
    workspaceName: 'Acme',
    turnstileToken: 'tok',
    acceptTerms: true,
    termsVersion: '2026-09-14',
    ...overrides,
  };
}

describe('POST /auth/signup', () => {
  it('payload válido → 202 uniforme + provisiona', async () => {
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).toHaveBeenCalledOnce();
  });

  it('rejeita campos extras (strict — sem workspaceId/role/isPlatformAdmin do body)', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(validSignup({ isPlatformAdmin: true, role: 'OWNER', workspaceId: 'x' }));
    expect(res.status).toBe(400);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('senha fraca → 400', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(validSignup({ password: 'curta' }));
    expect(res.status).toBe(400);
  });

  it('email descartável → 202 uniforme MAS não provisiona', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(validSignup({ email: 'lixo@mailinator.com' }));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('email já existente → 202 uniforme; provisiona idempotente (fecha órfão #3 / T13)', async () => {
    // created:false (usuário já existe no provider). O provisioner é chamado e é
    // idempotente — no-op se já tem workspace, ou completa o tenant de um órfão.
    providerState.signUpResult = { authUserId: 'existing', created: false };
    provisionMock.mockResolvedValue({
      workspaceId: 'ws-1',
      memberId: 'm-1',
      slug: 'acme',
      created: false,
    });
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).toHaveBeenCalledOnce();
  });

  it('conta existente CONFIRMADA (ex.: convidada) → 202 uniforme e provisiona a própria empresa (spec §1.3)', async () => {
    providerState.signUpResult = { authUserId: 'existing', created: false };
    providerState.lookup = { authUserId: 'existing', emailConfirmed: true, hasPassword: true };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).toHaveBeenCalledOnce();
  });

  it('conta existente NÃO confirmada → provisiona (retry do órfão segue funcionando)', async () => {
    providerState.signUpResult = { authUserId: 'existing', created: false };
    providerState.lookup = { authUserId: 'existing', emailConfirmed: false, hasPassword: true };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(provisionMock).toHaveBeenCalledOnce();
  });

  it('authUserId vazio (lookup do provider falhou) → 202 uniforme, sem provisionar', async () => {
    providerState.signUpResult = { authUserId: '', created: false };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('provisionamento falha (user criado) → 202 uniforme, compensação registrada (T14)', async () => {
    provisionMock.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(provisionMock).toHaveBeenCalledOnce();
  });
});

describe('POST /auth/signup — teto por IP independente do email (F-10)', () => {
  it('11º signup do MESMO IP com emails sempre novos → 429', async () => {
    const ip = `signup-ip-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 10; i += 1) {
      const ok = await request(app).post('/auth/signup').set('x-test-ip', ip).send(validSignup());
      expect(ok.status).toBe(202);
    }
    const blocked = await request(app)
      .post('/auth/signup')
      .set('x-test-ip', ip)
      .send(validSignup());
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate_limited');
    // Outro IP não herda o bloqueio.
    const other = await request(app)
      .post('/auth/signup')
      .set('x-test-ip', `${ip}-b`)
      .send(validSignup());
    expect(other.status).toBe(202);
  });
});

describe('POST /auth/signup — aceite de termos (F71-S04, A7)', () => {
  it('sem acceptTerms → 400, nada provisionado', async () => {
    const body: Record<string, unknown> = validSignup();
    delete body['acceptTerms'];
    const res = await request(app).post('/auth/signup').send(body);
    expect(res.status).toBe(400);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('acceptTerms:false → 400', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(validSignup({ acceptTerms: false }));
    expect(res.status).toBe(400);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it('acceptTerms como string "true" → 400 (só o literal booleano)', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(validSignup({ acceptTerms: 'true' }));
    expect(res.status).toBe(400);
  });

  it.each([undefined, '', 'v1', '2026-9-14', '2026-02-30', '2026-09-14T00:00:00Z', 'x'.repeat(65)])(
    'termsVersion inválida (%s) → 400',
    async (termsVersion) => {
      const res = await request(app).post('/auth/signup').send(validSignup({ termsVersion }));
      expect(res.status).toBe(400);
      expect(provisionMock).not.toHaveBeenCalled();
    },
  );

  it('aceite válido → provisionador recebe a data do SERVIDOR e a versão', async () => {
    const before = Date.now();
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(provisionMock).toHaveBeenCalledOnce();
    const arg: unknown = provisionMock.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ termsVersion: '2026-09-14' });
    const acceptedAt = (arg as { termsAcceptedAt?: unknown }).termsAcceptedAt;
    expect(acceptedAt).toBeInstanceOf(Date);
    expect((acceptedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((acceptedAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('POST /auth/signup — repetido reenvia a confirmação (F71-S04, A2)', () => {
  it('conta existente NÃO confirmada → reenvia, mesma resposta', async () => {
    providerState.signUpResult = { authUserId: 'existing', created: false };
    providerState.lookup = { authUserId: 'existing', emailConfirmed: false, hasPassword: true };
    const body = validSignup();
    const res = await request(app).post('/auth/signup').send(body);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(resendVerificationMock).toHaveBeenCalledExactlyOnceWith(body.email);
    expect(auditMock).toHaveBeenCalledWith(
      'auth.verification_resent',
      expect.anything(),
      expect.objectContaining({ email: body.email, outcome: 'sent', via: 'signup' }),
    );
  });

  it('conta existente confirmada → não reenvia, mesma resposta', async () => {
    providerState.signUpResult = { authUserId: 'existing', created: false };
    providerState.lookup = { authUserId: 'existing', emailConfirmed: true, hasPassword: true };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
    expect(resendVerificationMock).not.toHaveBeenCalled();
  });

  it('conta de convite ainda sem senha → não reenvia o email de cadastro', async () => {
    providerState.signUpResult = { authUserId: 'invited', created: false };
    providerState.lookup = { authUserId: 'invited', emailConfirmed: false, hasPassword: false };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(resendVerificationMock).not.toHaveBeenCalled();
  });

  it('cadastro novo → não chama o reenvio (o provider já mandou o 1º email)', async () => {
    providerState.lookup = { authUserId: 'auth-user-1', emailConfirmed: false, hasPassword: true };
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(resendVerificationMock).not.toHaveBeenCalled();
  });
});

describe('POST /auth/resend-verification (F71-S04, A2)', () => {
  function resendBody(email: string) {
    return { email, turnstileToken: 'tok' };
  }

  it('não confirmado → 200 { ok: true } e reenvia', async () => {
    providerState.lookup = { authUserId: 'u', emailConfirmed: false, hasPassword: true };
    const res = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', `rs-${randomUUID().slice(0, 8)}`)
      .send(resendBody('pendente@empresa.com'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(resendVerificationMock).toHaveBeenCalledExactlyOnceWith('pendente@empresa.com');
  });

  it('inexistente e confirmado → MESMO 200, sem envio', async () => {
    const lookups: (AuthUserLookup | null)[] = [
      null,
      { authUserId: 'u', emailConfirmed: true, hasPassword: true },
    ];
    for (const lookup of lookups) {
      providerState.lookup = lookup;
      const res = await request(app)
        .post('/auth/resend-verification')
        .set('x-test-ip', `rs-${randomUUID().slice(0, 8)}`)
        .send(resendBody(`rs-${randomUUID().slice(0, 8)}@empresa.com`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
    expect(resendVerificationMock).not.toHaveBeenCalled();
  });

  it('4º pedido do mesmo IP+email na hora → 429 (3/h)', async () => {
    const ip = `rs-${randomUUID().slice(0, 8)}`;
    const email = `rl-${randomUUID().slice(0, 8)}@empresa.com`;
    for (let i = 0; i < 3; i += 1) {
      const ok = await request(app)
        .post('/auth/resend-verification')
        .set('x-test-ip', ip)
        .send(resendBody(email));
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', ip)
      .send(resendBody(email));
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate_limited');
  });

  it('teto só por IP: o 21º pedido com emails sempre novos → 429', async () => {
    const ip = `rs-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 20; i += 1) {
      const ok = await request(app)
        .post('/auth/resend-verification')
        .set('x-test-ip', ip)
        .send(resendBody(`spray-${i}-${randomUUID().slice(0, 6)}@empresa.com`));
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', ip)
      .send(resendBody('spray-final@empresa.com'));
    expect(blocked.status).toBe(429);
  });

  it('captcha recusado → 400 captcha_failed, provider intocado', async () => {
    providerState.lookup = { authUserId: 'u', emailConfirmed: false, hasPassword: true };
    verifyTurnstileMock.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', `rs-${randomUUID().slice(0, 8)}`)
      .send(resendBody('captcha@empresa.com'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('captcha_failed');
    expect(resendVerificationMock).not.toHaveBeenCalled();
  });

  it('payload com campo extra ou sem captcha → 400 invalid_payload', async () => {
    const extra = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', `rs-${randomUUID().slice(0, 8)}`)
      .send({ ...resendBody('a@empresa.com'), redirectTo: 'https://evil.example' });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toBe('invalid_payload');
    const noToken = await request(app)
      .post('/auth/resend-verification')
      .set('x-test-ip', `rs-${randomUUID().slice(0, 8)}`)
      .send({ email: 'a@empresa.com' });
    expect(noToken.status).toBe(400);
  });
});

describe('POST /auth/reset', () => {
  it('email válido → 200 uniforme', async () => {
    const res = await request(app).post('/auth/reset').send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it('email inexistente → MESMA resposta (anti-enumeração)', async () => {
    const res = await request(app).post('/auth/reset').send({ email: 'naoexiste@b.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it('email inválido → 400', async () => {
    const res = await request(app).post('/auth/reset').send({ email: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/reset/confirm', () => {
  it('token válido + senha forte → 200 ok', async () => {
    providerState.confirmReset = true;
    const res = await request(app)
      .post('/auth/reset/confirm')
      .send({ token: 'good', password: 'senhaForte123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it('token inválido/expirado → 400 uniforme', async () => {
    providerState.confirmReset = false;
    const res = await request(app)
      .post('/auth/reset/confirm')
      .send({ token: 'bad', password: 'senhaForte123' });
    expect(res.status).toBe(400);
  });
  it('senha fraca → 400 (força validada server-side)', async () => {
    const res = await request(app)
      .post('/auth/reset/confirm')
      .send({ token: 'good', password: 'curta' });
    expect(res.status).toBe(400);
  });
  it('campos extras → 400 (strict)', async () => {
    const res = await request(app)
      .post('/auth/reset/confirm')
      .send({ token: 'good', password: 'senhaForte123', email: 'x@y.z' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/verify', () => {
  it('token inválido → 400 uniforme', async () => {
    providerState.verifyIdentity = null;
    const res = await request(app).post('/auth/verify').send({ token: 'bad' });
    expect(res.status).toBe(400);
  });
  it('token válido → 200 ok (ativa member)', async () => {
    providerState.verifyIdentity = { authUserId: 'u', email: 'verify-noone@nowhere.invalid' };
    const res = await request(app).post('/auth/verify').send({ token: 'good' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it('sem token → 400', async () => {
    const res = await request(app).post('/auth/verify').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login (audit de falha)', () => {
  it('credenciais inválidas → 401 e alimenta o contador de falhas do IP', async () => {
    providerState.signInThrows = true;
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(recordFailureMock).toHaveBeenCalledOnce(); // SEC-05: arma o captcha progressivo
  });
});

describe('POST /auth/login (F71-S04, A3 — email não confirmado)', () => {
  it('senha certa + email não confirmado → 403 email_unverified, sem cookie e sem captcha', async () => {
    providerState.signInThrows = true;
    providerState.signInErrorCode = 'email_unverified';
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nao-confirmado@empresa.com', password: 'senhaForte123' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'email_unverified',
      message: 'Confirme seu email para entrar.',
    });
    expect(recordFailureMock).not.toHaveBeenCalled();
    expect(setCookies(res)).toHaveLength(0);
    expect(auditMock).toHaveBeenCalledWith(
      'auth.login_failed',
      expect.anything(),
      expect.objectContaining({ reason: 'email_unverified' }),
    );
  });

  it('senha errada continua 401 genérico (o provider não diz "não confirmado")', async () => {
    providerState.signInThrows = true;
    providerState.signInErrorCode = 'invalid_credentials';
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nao-confirmado@empresa.com', password: 'errada' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeUndefined();
    expect(recordFailureMock).toHaveBeenCalledOnce();
  });
});

describe('POST /auth/login (SEC-05 — teto por IP independente do email)', () => {
  it('spraying com emails únicos: o 61º login do MESMO IP → 429', async () => {
    providerState.signInThrows = true;
    const ip = `spray-ip-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 60; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('x-test-ip', ip)
        .send({ email: `spray-${i}@x.com`, password: 'x' });
      // Passa nos limiters (email sempre novo zera o IP+email) mas falha a credencial.
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/auth/login')
      .set('x-test-ip', ip)
      .send({ email: 'spray-final@x.com', password: 'x' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate_limited');
  });

  it('IPs distintos não compartilham o teto', async () => {
    providerState.signInThrows = true;
    const res = await request(app)
      .post('/auth/login')
      .set('x-test-ip', `outro-ip-${randomUUID().slice(0, 8)}`)
      .send({ email: 'outro@x.com', password: 'x' });
    expect(res.status).toBe(401); // não herdou o 429 do IP saturado
  });
});

describe('POST /auth/login (SEC-05 — captcha progressivo)', () => {
  it('captcha armado + sem token → 403 captcha_required, signIn não roda', async () => {
    captchaState.required = true;
    providerState.signInThrows = false; // se o signIn rodasse, seria 200/403-workspace
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'captcha@x.com', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('captcha_required');
  });

  it('captcha armado + token válido → prossegue para a autenticação (401 credencial ruim)', async () => {
    captchaState.required = true;
    providerState.signInThrows = true;
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'captcha2@x.com', password: 'x', turnstileToken: 'tok' });
    expect(res.status).toBe(401); // passou do gate; falhou na credencial
  });

  it('captcha desarmado → login não exige token (fluxo normal intocado)', async () => {
    captchaState.required = false;
    providerState.signInThrows = true;
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'normal@x.com', password: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/login (intenção de plano da venda)', () => {
  it('consome pending_plan_key uma vez: 1º login devolve a key, 2º devolve null', async () => {
    const db = getDb();
    const sfx = randomUUID().slice(0, 8);
    const email = `login-plan-${sfx}@empresa.com`;
    const authUserId = randomUUID();

    const [freePlan] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, 'free'));
    const [ws] = await db
      .insert(schema.workspaces)
      .values({
        name: `LP ${sfx}`,
        slug: `lp-${sfx}`,
        planId: freePlan!.id,
        subscriptionStatus: 'trial',
      })
      .returning({ id: schema.workspaces.id });
    createdWorkspaces.push(ws!.id);
    await db.insert(schema.members).values({
      workspaceId: ws!.id,
      authUserId,
      email,
      name: 'LP',
      role: 'OWNER',
      status: 'active',
      isPlatformAdmin: false,
    });
    await db.insert(schema.subscriptions).values({
      workspaceId: ws!.id,
      planId: freePlan!.id,
      status: 'trial',
      billingCycle: 'monthly',
      pendingPlanKey: 'pro',
    });

    providerState.signInThrows = false;
    providerState.signInEmail = email;
    providerState.signInAuthUserId = authUserId;

    const res1 = await request(app).post('/auth/login').send({ email, password: 'x' });
    expect(res1.status).toBe(200);
    expect(res1.body.pendingPlanKey).toBe('pro');

    // One-shot: a intenção foi consumida no 1º login.
    const res2 = await request(app).post('/auth/login').send({ email, password: 'x' });
    expect(res2.status).toBe(200);
    expect(res2.body.pendingPlanKey).toBeNull();
  });
});

/** Cria workspace + member ativo direto no DB (cascade limpa no afterAll). */
async function seedActiveMember(email: string): Promise<string> {
  const authUserId = randomUUID();
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [freePlan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, 'free'));
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      name: `S28 ${sfx}`,
      slug: `s28-${sfx}`,
      planId: freePlan!.id,
      subscriptionStatus: 'trial',
    })
    .returning({ id: schema.workspaces.id });
  createdWorkspaces.push(ws!.id);
  await db.insert(schema.members).values({
    workspaceId: ws!.id,
    authUserId,
    email,
    name: 'S28',
    role: 'OWNER',
    status: 'active',
    isPlatformAdmin: false,
  });
  return authUserId;
}

/** Header `Set-Cookie` normalizado para array (supertest devolve string | string[]). */
function setCookies(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === 'string');
  return typeof raw === 'string' ? [raw] : [];
}

describe('F70-S28 — sessão morta não impede o login', () => {
  it('login com hm_session inválido presente funciona na 1ª tentativa e emite o cookie novo', async () => {
    const email = `s28-login-${randomUUID().slice(0, 8)}@empresa.com`;
    providerState.signInAuthUserId = await seedActiveMember(email);
    providerState.signInThrows = false;
    providerState.signInEmail = email;

    const res = await request(app)
      .post('/auth/login')
      .set('Cookie', 'hm_session=token-morto-de-ontem')
      .send({ email, password: 'x' });

    expect(res.status).toBe(200);
    const cookie = setCookies(res).find((c) => c.startsWith('hm_session='));
    // Mesmo nome e path do cookie morto: o navegador SUBSTITUI, não acumula.
    expect(cookie).toMatch(/^hm_session=t;/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it('login de quem não tem workspace → 403 SEM emitir cookie (não planta sessão inútil)', async () => {
    providerState.signInThrows = false;
    providerState.signInEmail = `s28-orfao-${randomUUID().slice(0, 8)}@empresa.com`;

    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });

    expect(res.status).toBe(403);
    expect(setCookies(res).some((c) => c.startsWith('hm_session='))).toBe(false);
  });
});

describe('F70-S28 — GET /api/me distingue sessão morta de provider fora do ar', () => {
  it('cookie inválido → 401 session_invalid (o web volta ao login)', async () => {
    const res = await request(app).get('/api/me').set('Cookie', `hm_session=morto-${randomUUID()}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_invalid');
  });

  it('sem cookie → 401 session_invalid', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_invalid');
  });

  it('provider lança (Supabase fora) → 503 auth_unavailable, NÃO 401', async () => {
    providerState.verifyThrows = true;
    const res = await request(app).get('/api/me').set('Cookie', `hm_session=novo-${randomUUID()}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('auth_unavailable');
  });
});

// ─── F71-S03 — sessão por pessoa e empresa ativa ─────────────────────────────

type MemberStatus = 'invited' | 'active' | 'inactive' | 'blocked';

/** Workspace vazio (cascade limpa members/audit/impersonation no afterAll). */
async function seedWorkspace(label: string): Promise<string> {
  const db = getDb();
  const sfx = randomUUID().slice(0, 8);
  const [freePlan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, 'free'));
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      name: `${label} ${sfx}`,
      slug: `s03-${label.toLowerCase()}-${sfx}`,
      planId: freePlan!.id,
      subscriptionStatus: 'trial',
    })
    .returning({ id: schema.workspaces.id });
  createdWorkspaces.push(ws!.id);
  return ws!.id;
}

async function seedMembership(input: {
  workspaceId: string;
  authUserId: string;
  email: string;
  status: MemberStatus;
  role?: string;
  lastActiveAt?: Date | null;
  invitedBy?: string | null;
}): Promise<string> {
  const [row] = await getDb()
    .insert(schema.members)
    .values({
      workspaceId: input.workspaceId,
      authUserId: input.authUserId,
      email: input.email,
      name: 'S03',
      role: input.role ?? 'AGENT',
      status: input.status,
      isPlatformAdmin: false,
      lastActiveAt: input.lastActiveAt ?? null,
      invitedBy: input.invitedBy ?? null,
    })
    .returning({ id: schema.members.id });
  return row!.id;
}

async function memberRow(id: string) {
  const [row] = await getDb().select().from(schema.members).where(eq(schema.members.id, id));
  return row!;
}

/** Valor de um cookie no `Set-Cookie` da resposta (null = não emitido). */
function setCookieValue(res: request.Response, name: string): string | null {
  const c = setCookies(res).find((x) => x.startsWith(`${name}=`));
  if (!c) return null;
  return decodeURIComponent(c.slice(name.length + 1).split(';')[0] ?? '');
}

/**
 * Pessoa em 2 empresas: A usada há 2 dias, B ontem (B é a padrão). Devolve o token de
 * sessão já válido no dublê do provider.
 */
async function seedPersonInTwoCompanies() {
  const authUserId = randomUUID();
  const email = `s03-${randomUUID().slice(0, 8)}@empresa.com`;
  const wsA = await seedWorkspace('A');
  const wsB = await seedWorkspace('B');
  const day = 24 * 60 * 60 * 1000;
  const memberA = await seedMembership({
    workspaceId: wsA,
    authUserId,
    email,
    status: 'active',
    lastActiveAt: new Date(Date.now() - 2 * day),
  });
  const memberB = await seedMembership({
    workspaceId: wsB,
    authUserId,
    email,
    status: 'active',
    lastActiveAt: new Date(Date.now() - day),
  });
  const token = `s03-${randomUUID()}`;
  liveTokens.set(token, { authUserId, email });
  return { authUserId, email, wsA, wsB, memberA, memberB, token };
}

function loginAs(p: { authUserId: string; email: string }, token = `tok-${randomUUID()}`) {
  providerState.signInThrows = false;
  providerState.signInEmail = p.email;
  providerState.signInAuthUserId = p.authUserId;
  providerState.signInToken = token;
  return request(app).post('/auth/login').send({ email: p.email, password: 'x' });
}

describe('F71-S03 — login escolhe a empresa usada por último', () => {
  it('pessoa em 2 empresas → entra na última usada, seta hm_workspace e marca last_active_at', async () => {
    const p = await seedPersonInTwoCompanies();
    const before = (await memberRow(p.memberB)).lastActiveAt;

    const res = await loginAs(p);

    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsB);
    expect(res.body.member.id).toBe(p.memberB);
    expect(setCookieValue(res, 'hm_workspace')).toBe(p.wsB);
    const cookie = setCookies(res).find((c) => c.startsWith('hm_workspace='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/); // 30 dias
    const ids = (res.body.memberships as { workspaceId: string }[]).map((m) => m.workspaceId);
    expect(ids).toEqual([p.wsB, p.wsA]);
    const after = (await memberRow(p.memberB)).lastActiveAt;
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it('o hm_workspace que já estava no navegador não decide o login', async () => {
    const p = await seedPersonInTwoCompanies();
    const res = await loginAs(p).set('Cookie', `hm_workspace=${p.wsA}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsB);
  });

  it('membership inactive numa empresa e active noutra → nunca resolve a inativa', async () => {
    const authUserId = randomUUID();
    const email = `s03-inat-${randomUUID().slice(0, 8)}@empresa.com`;
    const wsOld = await seedWorkspace('Old');
    const wsNew = await seedWorkspace('New');
    // A inativa é a "mais recente": ainda assim nunca é escolhida.
    await seedMembership({
      workspaceId: wsOld,
      authUserId,
      email,
      status: 'inactive',
      lastActiveAt: new Date(),
    });
    await seedMembership({ workspaceId: wsNew, authUserId, email, status: 'active' });

    const res = await loginAs({ authUserId, email });
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(wsNew);
    expect(res.body.memberships).toHaveLength(1);

    // Nem pedindo explicitamente pelo cookie.
    const token = setCookieValue(res, 'hm_session');
    const me = await request(app)
      .get('/api/me')
      .set('Cookie', `hm_session=${token ?? ''}; hm_workspace=${wsOld}`);
    expect(me.status).toBe(200);
    expect(me.body.workspace.id).toBe(wsNew);
  });

  it('só memberships inactive/blocked/invited → 403 sem cookie nenhum', async () => {
    const authUserId = randomUUID();
    const email = `s03-sem-${randomUUID().slice(0, 8)}@empresa.com`;
    for (const status of ['inactive', 'blocked', 'invited'] as const) {
      await seedMembership({ workspaceId: await seedWorkspace('X'), authUserId, email, status });
    }

    const res = await loginAs({ authUserId, email });
    expect(res.status).toBe(403);
    expect(setCookieValue(res, 'hm_session')).toBeNull();
    expect(setCookieValue(res, 'hm_workspace')).toBeNull();
  });

  it('mesmo email em outra pessoa não vaza: a membership é por auth_user_id', async () => {
    const email = `s03-same-${randomUUID().slice(0, 8)}@empresa.com`;
    await seedMembership({
      workspaceId: await seedWorkspace('Other'),
      authUserId: randomUUID(),
      email,
      status: 'active',
    });

    const res = await loginAs({ authUserId: randomUUID(), email });
    expect(res.status).toBe(403);
  });
});

describe('F71-S03 — GET /api/me e hm_workspace', () => {
  it('devolve memberships[] na ordem de uso, sem ids internos', async () => {
    const p = await seedPersonInTwoCompanies();
    const res = await request(app).get('/api/me').set('Cookie', `hm_session=${p.token}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsB);
    expect(res.body.memberships).toEqual([
      expect.objectContaining({ workspaceId: p.wsB, role: 'AGENT', subscriptionStatus: 'trial' }),
      expect.objectContaining({ workspaceId: p.wsA, role: 'AGENT' }),
    ]);
    expect(res.body.memberships[0]).not.toHaveProperty('memberId');
    expect(res.body.memberships[0]).not.toHaveProperty('lastActiveAt');
  });

  it('hm_workspace de empresa com membership ativa → resolve nela', async () => {
    const p = await seedPersonInTwoCompanies();
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${p.wsA}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsA);
    expect(res.body.member.id).toBe(p.memberA);
  });

  it('hm_workspace de empresa SEM membership → ignorado, cai na padrão (sem erro)', async () => {
    const p = await seedPersonInTwoCompanies();
    const foreign = await seedWorkspace('Foreign');
    await seedMembership({
      workspaceId: foreign,
      authUserId: randomUUID(),
      email: `dono-${randomUUID().slice(0, 8)}@x.com`,
      status: 'active',
    });
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${foreign}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsB);
  });

  it('hm_workspace malformado (não-uuid) → ignorado, cai na padrão', async () => {
    const p = await seedPersonInTwoCompanies();
    const evil = encodeURIComponent('x-or-1=1--');
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${evil}`);
    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe(p.wsB);
  });
});

describe('F71-S03 — POST /api/me/workspace', () => {
  it('troca → cookie, auditoria, last_active_at; requests seguintes e o próximo login na outra', async () => {
    const p = await seedPersonInTwoCompanies();

    const sw = await request(app)
      .post('/api/me/workspace')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${p.wsB}`)
      .send({ workspaceId: p.wsA });
    expect(sw.status).toBe(200);
    expect(sw.body.workspace.id).toBe(p.wsA);
    expect(sw.body.member.id).toBe(p.memberA);
    expect(setCookieValue(sw, 'hm_workspace')).toBe(p.wsA);

    const [audit] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.workspaceId, p.wsA),
          eq(schema.auditLogs.action, 'workspace.switched'),
        ),
      );
    expect(audit).toBeTruthy();
    expect(audit?.actorMemberId).toBe(p.memberA);
    expect(audit?.actorType).toBe('member');
    expect(audit?.metadata).toMatchObject({ fromWorkspaceId: p.wsB, toWorkspaceId: p.wsA });

    // Request seguinte (com o cookie novo) já está na outra empresa.
    const me = await request(app)
      .get('/api/me')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${p.wsA}`);
    expect(me.body.workspace.id).toBe(p.wsA);

    // Outro navegador (sem hm_workspace): o login cai na última usada, agora A.
    const login = await loginAs(p);
    expect(login.status).toBe(200);
    expect(login.body.workspace.id).toBe(p.wsA);
  });

  it('empresa sem membership → 404 uniforme, sem cookie', async () => {
    const p = await seedPersonInTwoCompanies();
    const foreign = await seedWorkspace('Alheia');
    const res = await request(app)
      .post('/api/me/workspace')
      .set('Cookie', `hm_session=${p.token}`)
      .send({ workspaceId: foreign });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('workspace_not_found');
    expect(setCookieValue(res, 'hm_workspace')).toBeNull();

    // Empresa inexistente: mesma resposta (não revela existência).
    const ghost = await request(app)
      .post('/api/me/workspace')
      .set('Cookie', `hm_session=${p.token}`)
      .send({ workspaceId: randomUUID() });
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual(res.body);
  });

  it('membership inactive → 404 (removido não volta trocando de empresa)', async () => {
    const p = await seedPersonInTwoCompanies();
    const wsGone = await seedWorkspace('Gone');
    await seedMembership({
      workspaceId: wsGone,
      authUserId: p.authUserId,
      email: p.email,
      status: 'inactive',
    });
    const res = await request(app)
      .post('/api/me/workspace')
      .set('Cookie', `hm_session=${p.token}`)
      .send({ workspaceId: wsGone });
    expect(res.status).toBe(404);
  });

  it('payload inválido → 400 (uuid obrigatório, strict)', async () => {
    const p = await seedPersonInTwoCompanies();
    for (const body of [{}, { workspaceId: 'nope' }, { workspaceId: p.wsA, role: 'OWNER' }]) {
      const res = await request(app)
        .post('/api/me/workspace')
        .set('Cookie', `hm_session=${p.token}`)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('sem sessão → 401 session_invalid', async () => {
    const res = await request(app).post('/api/me/workspace').send({ workspaceId: randomUUID() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_invalid');
  });

  it('sob view-as (impersonation ativa) → 403, sem trocar', async () => {
    const p = await seedPersonInTwoCompanies();
    const imp = await impersonationSessionsRepo.create({
      adminMemberId: p.memberB,
      targetWorkspaceId: await seedWorkspace('Alvo'),
      reason: 'suporte: teste da troca sob view-as',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const before = (await memberRow(p.memberA)).lastActiveAt;
    const res = await request(app)
      .post('/api/me/workspace')
      .set('Cookie', `hm_session=${p.token}; hm_workspace=${p.wsB}; hm_impersonation=${imp.id}`)
      .send({ workspaceId: p.wsA });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('impersonation_read_only');
    expect(setCookieValue(res, 'hm_workspace')).toBeNull();
    expect((await memberRow(p.memberA)).lastActiveAt?.getTime()).toBe(before?.getTime());
  });
});

describe('F71-S03 — logout', () => {
  it('limpa hm_session e hm_workspace', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(204);
    const cleared = setCookies(res);
    const expired = (name: string) =>
      cleared.some((c) => c.startsWith(`${name}=;`) && c.includes('Expires=Thu, 01 Jan 1970'));
    expect(expired('hm_session')).toBe(true);
    expect(expired('hm_workspace')).toBe(true);
  });
});

describe('F71-S03 — verify (A5) promove só o dono pendente desta pessoa', () => {
  it('não reativa removido/bloqueado nem toca linha de outra pessoa com o mesmo email', async () => {
    const authUserId = randomUUID();
    const email = `s03-a5-${randomUUID().slice(0, 8)}@empresa.com`;
    const ownerPending = await seedMembership({
      workspaceId: await seedWorkspace('Nova'),
      authUserId,
      email,
      status: 'invited',
      role: 'OWNER',
    });
    const removed = await seedMembership({
      workspaceId: await seedWorkspace('Rem'),
      authUserId,
      email,
      status: 'inactive',
    });
    const blocked = await seedMembership({
      workspaceId: await seedWorkspace('Blk'),
      authUserId,
      email,
      status: 'blocked',
    });
    const otherPerson = await seedMembership({
      workspaceId: await seedWorkspace('Outra'),
      authUserId: randomUUID(),
      email,
      status: 'invited',
      role: 'OWNER',
    });

    providerState.verifyIdentity = { authUserId, email };
    const res = await request(app).post('/auth/verify').send({ token: 'good' });
    expect(res.status).toBe(200);

    const owner = await memberRow(ownerPending);
    expect(owner.status).toBe('active');
    expect(owner.joinedAt).not.toBeNull();
    expect((await memberRow(removed)).status).toBe('inactive');
    expect((await memberRow(blocked)).status).toBe('blocked');
    expect((await memberRow(otherPerson)).status).toBe('invited');
  });

  it('linha invited com invited_by (convite legado) não vira active pelo verify', async () => {
    const authUserId = randomUUID();
    const email = `s03-a5b-${randomUUID().slice(0, 8)}@empresa.com`;
    const ws = await seedWorkspace('Conv');
    const inviter = await seedMembership({
      workspaceId: ws,
      authUserId: randomUUID(),
      email: `admin-${randomUUID().slice(0, 8)}@x.com`,
      status: 'active',
      role: 'ADMIN',
    });
    const invited = await seedMembership({
      workspaceId: ws,
      authUserId,
      email,
      status: 'invited',
      invitedBy: inviter,
    });
    providerState.verifyIdentity = { authUserId, email };
    const res = await request(app).post('/auth/verify').send({ token: 'good' });
    expect(res.status).toBe(200);
    expect((await memberRow(invited)).status).toBe('invited');
  });
});
