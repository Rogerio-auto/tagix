import type { Request, Response } from 'express';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp, closeRateLimit, rateLimit, verifyTurnstile } from './rate-limit';

afterAll(async () => {
  await closeRateLimit();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockReqRes(ip: string, email?: string) {
  const req = {
    headers: {},
    ip,
    socket: { remoteAddress: ip },
    body: email ? { email } : {},
  } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const setHeader = vi.fn();
  const res = { status, json, setHeader } as unknown as Response;
  return { req, res, status, json, setHeader };
}

function run(mw: ReturnType<typeof rateLimit>, req: Request, res: Response): Promise<boolean> {
  // resolve(true) se next() foi chamado (passou); false se foi bloqueado (429).
  return new Promise((resolve) => {
    const next = () => resolve(true);
    const json = res.json as unknown as ReturnType<typeof vi.fn>;
    json.mockImplementation(() => {
      resolve(false);
      return res;
    });
    mw(req, res, next);
  });
}

describe('clientIp', () => {
  it('prefere o primeiro IP de x-forwarded-for', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      ip: '10.0.0.1',
      socket: {},
    } as unknown as Request;
    expect(clientIp(req)).toBe('203.0.113.7');
  });
});

describe('rateLimit', () => {
  it('bloqueia após exceder o máximo na janela (mesmo IP+email)', async () => {
    const sfx = Math.random().toString(36).slice(2, 8);
    const mw = rateLimit({ bucket: `test-block-${sfx}`, max: 3, windowSec: 60 });
    const email = `brute-${sfx}@test.local`;

    for (let i = 0; i < 3; i += 1) {
      const { req, res } = mockReqRes('198.51.100.5', email);
      expect(await run(mw, req, res)).toBe(true);
    }
    // 4ª tentativa estoura.
    const { req, res, status, setHeader } = mockReqRes('198.51.100.5', email);
    expect(await run(mw, req, res)).toBe(false);
    expect(status).toHaveBeenCalledWith(429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('chaveia por IP+email: emails distintos no mesmo IP não compartilham contador', async () => {
    const sfx = Math.random().toString(36).slice(2, 8);
    const mw = rateLimit({ bucket: `test-iso-${sfx}`, max: 1, windowSec: 60 });

    const a = mockReqRes('198.51.100.9', `a-${sfx}@test.local`);
    expect(await run(mw, a.req, a.res)).toBe(true);
    // email diferente, mesmo IP → ainda passa (contador separado).
    const b = mockReqRes('198.51.100.9', `b-${sfx}@test.local`);
    expect(await run(mw, b.req, b.res)).toBe(true);
    // repetir o primeiro email estoura (max=1).
    const a2 = mockReqRes('198.51.100.9', `a-${sfx}@test.local`);
    expect(await run(mw, a2.req, a2.res)).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  it('dev sem secret: bypass permissivo explícito', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(await verifyTurnstile('any')).toBe(true);
  });

  it('produção sem secret: fail-closed (nega)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(await verifyTurnstile('any')).toBe(false);
  });

  it('token vazio com secret presente: nega', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    expect(await verifyTurnstile('')).toBe(false);
  });

  it('chama o siteverify e respeita success=false', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), {
          status: 200,
        }),
      );
    expect(await verifyTurnstile('bad-token', '203.0.113.1')).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(String(body)).toContain('response=bad-token');
    // O secret vai no body, nunca é o token do cliente.
    expect(String(body)).toContain('secret=sk_test');
  });

  it('success=true → válido', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    expect(await verifyTurnstile('good-token')).toBe(true);
  });
});
