import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { IAuthProvider, SignUpResult } from '@hm/shared';
import { AuthError } from '@hm/shared';
import { closeDb, getDb, schema } from '@hm/db';
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
  confirmReset: boolean;
} = {
  signUpResult: { authUserId: 'auth-user-1', created: true },
  signUpThrows: false,
  verifyIdentity: null,
  signInThrows: true,
  signInEmail: null,
  confirmReset: true,
};

const fakeProvider: IAuthProvider = {
  kind: 'mock',
  async signIn() {
    if (providerState.signInThrows) throw new AuthError('bad', 'invalid_credentials');
    const email = providerState.signInEmail ?? 'x@y.z';
    return { accessToken: 't', identity: { authUserId: 'u', email }, expiresAt: null };
  },
  async verifyToken() {
    return null;
  },
  async signOut() {},
  async signUp() {
    if (providerState.signUpThrows) throw new AuthError('boom', 'provider_error');
    return providerState.signUpResult;
  },
  async requestPasswordReset() {},
  async resendVerification() {},
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

const app = express();
app.use(express.json());
app.use(createAuthRouter());

// Workspaces criados direto no DB pelos testes de login (cascade limpa member+sub).
const createdWorkspaces: string[] = [];

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
  providerState.confirmReset = true;
  captchaState.required = false;
  recordFailureMock.mockClear();
  provisionMock.mockReset();
  provisionMock.mockResolvedValue({ workspaceId: 'ws-1', memberId: 'm-1', slug: 'acme', created: true });
});

function validSignup(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Fulano',
    email: `user-${Math.random().toString(36).slice(2, 8)}@empresa.com`,
    password: 'senhaForte123',
    workspaceName: 'Acme',
    turnstileToken: 'tok',
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
    const res = await request(app).post('/auth/signup').send(validSignup({ password: 'curta' }));
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
    provisionMock.mockResolvedValue({ workspaceId: 'ws-1', memberId: 'm-1', slug: 'acme', created: false });
    const res = await request(app).post('/auth/signup').send(validSignup());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'verification_sent' });
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

    const [freePlan] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, 'free'));
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: `LP ${sfx}`, slug: `lp-${sfx}`, planId: freePlan!.id, subscriptionStatus: 'trial' })
      .returning({ id: schema.workspaces.id });
    createdWorkspaces.push(ws!.id);
    await db.insert(schema.members).values({
      workspaceId: ws!.id,
      authUserId: randomUUID(),
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

    const res1 = await request(app).post('/auth/login').send({ email, password: 'x' });
    expect(res1.status).toBe(200);
    expect(res1.body.pendingPlanKey).toBe('pro');

    // One-shot: a intenção foi consumida no 1º login.
    const res2 = await request(app).post('/auth/login').send({ email, password: 'x' });
    expect(res2.status).toBe(200);
    expect(res2.body.pendingPlanKey).toBeNull();
  });
});
