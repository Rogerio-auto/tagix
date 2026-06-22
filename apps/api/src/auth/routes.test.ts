import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAuthProvider, SignUpResult } from '@hm/shared';
import { AuthError } from '@hm/shared';
import { closeDb } from '@hm/db';
import { closeRateLimit } from '../middlewares/rate-limit';
import type * as RateLimitModule from '../middlewares/rate-limit';
import type * as DbModule from '@hm/db';

// ─── Controla o provider de auth (sem tocar Supabase real) ───────────────────
const providerState: {
  signUpResult: SignUpResult;
  signUpThrows: boolean;
  verifyIdentity: { authUserId: string; email: string } | null;
  signInThrows: boolean;
} = {
  signUpResult: { authUserId: 'auth-user-1', created: true },
  signUpThrows: false,
  verifyIdentity: null,
  signInThrows: true,
};

const fakeProvider: IAuthProvider = {
  kind: 'mock',
  async signIn() {
    if (providerState.signInThrows) throw new AuthError('bad', 'invalid_credentials');
    return { accessToken: 't', identity: { authUserId: 'u', email: 'x@y.z' }, expiresAt: null };
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
};

vi.mock('./provider', () => ({ getAuthProvider: () => fakeProvider }));

// Turnstile sempre válido nos testes de rota (verificação coberta no rate-limit.test).
vi.mock('../middlewares/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return {
    ...actual,
    verifyTurnstile: vi.fn(async () => true),
    auditAuthEvent: vi.fn(async () => {}),
    // rate-limit pass-through (cada teste usa emails únicos; não exercitamos o 429 aqui).
    rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

afterAll(async () => {
  await closeRateLimit();
  await closeDb();
});

beforeEach(() => {
  providerState.signUpResult = { authUserId: 'auth-user-1', created: true };
  providerState.signUpThrows = false;
  providerState.verifyIdentity = null;
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

  it('email já existente → 202 uniforme, sem reprovisionar (T13)', async () => {
    providerState.signUpResult = { authUserId: 'existing', created: false };
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
  it('credenciais inválidas → 401', async () => {
    providerState.signInThrows = true;
    const res = await request(app).post('/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(401);
  });
});
