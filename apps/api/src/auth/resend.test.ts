/**
 * Reenvio de confirmação (F71-S04): resposta e TEMPO uniformes (anti-enumeração T3),
 * envio só para conta existente e não confirmada, auditoria sem segredo, e o piso de
 * tempo compartilhado com o signup.
 *
 * Unitário: provider e captcha/auditoria são dublês; nada de rede, DB ou Redis. A
 * composição com os rate-limits do router está em `routes.test.ts`.
 */
import { performance } from 'node:perf_hooks';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUserLookup } from '@hm/shared';
import { AuthError } from '@hm/shared';
import type * as RateLimitModule from '../middlewares/rate-limit';

/** Atrasos simulados do provider (ms) — o caminho "caro" é o que mais demora. */
const state: {
  lookup: AuthUserLookup | null | 'throw';
  lookupDelayMs: number;
  resendDelayMs: number;
} = { lookup: null, lookupDelayMs: 0, resendDelayMs: 0 };

const { findUserByEmailMock, resendVerificationMock, auditMock, turnstileMock } = vi.hoisted(
  () => ({
    findUserByEmailMock: vi.fn(),
    resendVerificationMock: vi.fn(),
    auditMock: vi.fn(async () => {}),
    turnstileMock: vi.fn(async (token: string) => token.length > 0),
  }),
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock('./provider', () => ({
  getAuthProvider: () => ({
    findUserByEmail: findUserByEmailMock,
    resendVerification: resendVerificationMock,
  }),
}));

vi.mock('../middlewares/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>();
  return { ...actual, verifyTurnstile: turnstileMock, auditAuthEvent: auditMock };
});

const {
  DEFAULT_UNIFORM_RESPONSE_MS,
  resendVerificationHandler,
  resendVerificationIfPending,
  runWithUniformTiming,
  uniformResponseMs,
} = await import('./resend');

const app = express();
app.use(express.json());
app.post('/auth/resend-verification', resendVerificationHandler);

const FLOOR_MS = 150;

beforeEach(() => {
  vi.stubEnv('AUTH_UNIFORM_RESPONSE_MS', String(FLOOR_MS));
  state.lookup = null;
  state.lookupDelayMs = 0;
  state.resendDelayMs = 0;
  findUserByEmailMock.mockReset();
  findUserByEmailMock.mockImplementation(async () => {
    await delay(state.lookupDelayMs);
    if (state.lookup === 'throw') throw new AuthError('down', 'provider_error');
    return state.lookup;
  });
  resendVerificationMock.mockReset();
  resendVerificationMock.mockImplementation(async () => {
    await delay(state.resendDelayMs);
  });
  auditMock.mockClear();
  turnstileMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const UNCONFIRMED: AuthUserLookup = { authUserId: 'u1', emailConfirmed: false, hasPassword: true };
const CONFIRMED: AuthUserLookup = { authUserId: 'u2', emailConfirmed: true, hasPassword: true };
const INVITE_PENDING: AuthUserLookup = {
  authUserId: 'u3',
  emailConfirmed: false,
  hasPassword: false,
};

function send(email: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/auth/resend-verification')
    .send({ email, turnstileToken: 'tok', ...extra });
}

/** Mediana de N medições do tempo de resposta (ms), conferindo o corpo uniforme. */
async function medianElapsed(email: string, runs = 3): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    const res = await send(email);
    samples.push(performance.now() - t0);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? Number.NaN;
}

describe('POST /auth/resend-verification — resposta uniforme', () => {
  it.each([
    ['inexistente', null, false],
    ['confirmado', CONFIRMED, false],
    ['convite sem senha', INVITE_PENDING, false],
    ['não confirmado', UNCONFIRMED, true],
  ] as const)('%s → 200 { ok: true }; envia só no não confirmado', async (_l, lookup, sends) => {
    state.lookup = lookup;
    const res = await send('Pessoa@Empresa.com ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Email normalizado antes de chegar ao provider.
    expect(findUserByEmailMock).toHaveBeenCalledExactlyOnceWith('pessoa@empresa.com');
    if (sends) {
      expect(resendVerificationMock).toHaveBeenCalledExactlyOnceWith('pessoa@empresa.com');
    } else {
      expect(resendVerificationMock).not.toHaveBeenCalled();
    }
  });

  it('provider fora do ar → MESMO 200, auditado como provider_error', async () => {
    state.lookup = 'throw';
    const res = await send('x@empresa.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(resendVerificationMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      'auth.verification_resent',
      expect.anything(),
      expect.objectContaining({ outcome: 'provider_error', code: 'provider_error' }),
    );
  });

  it('auditoria: ação auth.verification_resent com email e resultado, sem token nem senha', async () => {
    state.lookup = UNCONFIRMED;
    await send('audit@empresa.com');
    expect(auditMock).toHaveBeenCalledOnce();
    const call = auditMock.mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe('auth.verification_resent');
    const metadata = call?.[2];
    expect(metadata).toEqual({ email: 'audit@empresa.com', outcome: 'sent', via: 'resend' });
    expect(JSON.stringify(metadata)).not.toContain('tok');
  });
});

describe('POST /auth/resend-verification — entrada', () => {
  it('captcha recusado → 400 captcha_failed, sem consultar o provider', async () => {
    turnstileMock.mockResolvedValueOnce(false);
    const res = await send('a@empresa.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('captcha_failed');
    expect(findUserByEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    ['email inválido', { email: 'nope', turnstileToken: 'tok' }],
    ['sem captcha', { email: 'a@empresa.com' }],
    ['campo extra', { email: 'a@empresa.com', turnstileToken: 'tok', redirectTo: '/x' }],
    ['email longo', { email: `${'a'.repeat(250)}@x.com`, turnstileToken: 'tok' }],
  ])('%s → 400 invalid_payload, sem consultar o provider', async (_l, body) => {
    const res = await request(app).post('/auth/resend-verification').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(findUserByEmailMock).not.toHaveBeenCalled();
    expect(turnstileMock).not.toHaveBeenCalled();
  });
});

describe('POST /auth/resend-verification — tempo uniforme (T3)', () => {
  it('inexistente, confirmado e não confirmado respondem no MESMO piso', async () => {
    // Caminho barato (não existe), médio (lookup) e caro (lookup + envio).
    state.lookupDelayMs = 0;
    state.lookup = null;
    const missing = await medianElapsed('t-missing@empresa.com');

    state.lookupDelayMs = 30;
    state.lookup = CONFIRMED;
    const confirmed = await medianElapsed('t-confirmed@empresa.com');

    state.resendDelayMs = 80;
    state.lookup = UNCONFIRMED;
    const pending = await medianElapsed('t-pending@empresa.com');

    for (const elapsed of [missing, confirmed, pending]) {
      expect(elapsed).toBeGreaterThanOrEqual(FLOOR_MS - 2);
      expect(elapsed).toBeLessThan(FLOOR_MS + 80);
    }
    // Sem o piso, a diferença seria ~110 ms; com ele, só ruído.
    expect(
      Math.max(missing, confirmed, pending) - Math.min(missing, confirmed, pending),
    ).toBeLessThan(40);
  });

  it('provider mais lento que o piso: a resposta sai no piso e o envio termina depois', async () => {
    state.lookup = UNCONFIRMED;
    state.lookupDelayMs = 400;
    const t0 = performance.now();
    const res = await send('slow@empresa.com');
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(FLOOR_MS + 80);
    expect(resendVerificationMock).not.toHaveBeenCalled(); // ainda no lookup
    await vi.waitFor(() => expect(resendVerificationMock).toHaveBeenCalledOnce(), {
      timeout: 2000,
    });
  });
});

describe('resendVerificationIfPending', () => {
  it('devolve o resultado por caso (para auditoria)', async () => {
    state.lookup = null;
    await expect(resendVerificationIfPending('a@x.com')).resolves.toBe('no_account');
    state.lookup = CONFIRMED;
    await expect(resendVerificationIfPending('a@x.com')).resolves.toBe('already_confirmed');
    state.lookup = INVITE_PENDING;
    await expect(resendVerificationIfPending('a@x.com')).resolves.toBe('invite_pending');
    state.lookup = UNCONFIRMED;
    await expect(resendVerificationIfPending('a@x.com')).resolves.toBe('sent');
    expect(resendVerificationMock).toHaveBeenCalledOnce();
  });

  it('"não sei" do provider propaga (nunca vira "não existe")', async () => {
    state.lookup = 'throw';
    await expect(resendVerificationIfPending('a@x.com')).rejects.toMatchObject({
      code: 'provider_error',
    });
  });
});

describe('runWithUniformTiming / uniformResponseMs', () => {
  it('trabalho que lança não rejeita nem atrasa a resposta', async () => {
    const t0 = performance.now();
    await expect(
      runWithUniformTiming(
        'test',
        async () => {
          throw new Error('boom');
        },
        60,
      ),
    ).resolves.toBeUndefined();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(58);
  });

  it('lê AUTH_UNIFORM_RESPONSE_MS; ausente ou fora de [50, 10000] cai no padrão', () => {
    vi.stubEnv('AUTH_UNIFORM_RESPONSE_MS', '300');
    expect(uniformResponseMs()).toBe(300);
    for (const bad of ['', '0', '10', '-5', '1.5', 'abc', '20000']) {
      vi.stubEnv('AUTH_UNIFORM_RESPONSE_MS', bad);
      expect(uniformResponseMs()).toBe(DEFAULT_UNIFORM_RESPONSE_MS);
    }
  });
});
