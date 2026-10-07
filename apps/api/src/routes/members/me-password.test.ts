/**
 * POST /api/members/me/password — troca de senha do member autenticado.
 *
 * Router isolado com auth e provider mockados (mesmo padrão dos testes de rota do
 * repo). Garante: re-auth com a senha atual, persistência via
 * `provider.updatePassword(authUserId)` (NUNCA o email) e 502 quando o provider
 * devolve `false` (sem fingir sucesso).
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@hm/shared';

const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000d1';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000c1';
const AUTH_USER_ID = '00000000-0000-0000-0000-0000000000a1';
const EMAIL = 'ana@empresa.com';

const signIn = vi.fn<(input: { email: string; password: string }) => Promise<unknown>>();
const updatePassword = vi.fn<(authUserId: string, password: string) => Promise<boolean>>();

vi.mock('@hm/db', () => ({ schema: { members: {} } }));

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { auth?: unknown }).auth = {
      workspace: { id: WORKSPACE_ID },
      member: { id: MEMBER_ID, authUserId: AUTH_USER_ID, email: EMAIL },
    };
    next();
  },
  withRLS: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

// Rate-limit em memória (algoritmo real com Redis é coberto no rate-limit.test): honra
// bucket/max e é zerado a cada teste via `rateLimitCounts`.
const rateLimitCounts = new Map<string, number>();
vi.mock('../../middlewares/rate-limit', () => ({
  auditAuthEvent: vi.fn(async () => undefined),
  verifyTurnstile: vi.fn(async () => true),
  clientIp: () => 'ip',
  rateLimit: (opts: { bucket: string; max: number }) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const count = (rateLimitCounts.get(opts.bucket) ?? 0) + 1;
      rateLimitCounts.set(opts.bucket, count);
      if (count > opts.max) {
        res.status(429).json({ reason: 'rate_limited' });
        return;
      }
      next();
    },
}));

vi.mock('../../auth/provider', () => ({
  getAuthProvider: () => ({ signIn, updatePassword }),
}));

const { createMembersMeRouter } = await import('./me');

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createMembersMeRouter());
  return app;
}

const VALID = { currentPassword: 'senha-atual', newPassword: 'novaSenha12345' };

describe('POST /api/members/me/password', () => {
  beforeEach(() => {
    rateLimitCounts.clear();
    signIn.mockReset().mockResolvedValue({});
    updatePassword.mockReset().mockResolvedValue(true);
  });

  it('re-autentica com a senha atual e persiste pelo authUserId (não pelo email) → 204', async () => {
    const res = await request(makeApp()).post('/api/members/me/password').send(VALID);

    expect(res.status).toBe(204);
    expect(signIn).toHaveBeenCalledWith({ email: EMAIL, password: VALID.currentPassword });
    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith(AUTH_USER_ID, VALID.newPassword);
    expect(updatePassword.mock.calls[0]?.[0]).not.toBe(EMAIL);
  });

  it('provider devolve false → 502 password_update_failed (nunca 204)', async () => {
    updatePassword.mockResolvedValue(false);

    const res = await request(makeApp()).post('/api/members/me/password').send(VALID);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'password_update_failed' });
    expect(JSON.stringify(res.body)).not.toContain(VALID.newPassword);
  });

  it('senha atual incorreta → 401 e não tenta trocar', async () => {
    signIn.mockRejectedValue(new AuthError('Senha incorreta.', 'invalid_credentials'));

    const res = await request(makeApp()).post('/api/members/me/password').send(VALID);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'invalid_current_password' });
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('nova senha curta → 400 e não chama o provider', async () => {
    const res = await request(makeApp())
      .post('/api/members/me/password')
      .send({ currentPassword: 'x', newPassword: 'curta' });

    expect(res.status).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('nova senha fraca (sem número / <10 chars) → 400 e não chama o provider (F-09)', async () => {
    for (const newPassword of ['apenasletrasaqui', '12345678901', 'abc12345']) {
      const res = await request(makeApp())
        .post('/api/members/me/password')
        .send({ currentPassword: 'x', newPassword });
      expect(res.status).toBe(400);
    }
    expect(signIn).not.toHaveBeenCalled();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('11ª tentativa na janela → 429 e não toca o provider (F-09)', async () => {
    signIn.mockRejectedValue(new AuthError('Senha incorreta.', 'invalid_credentials'));
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).post('/api/members/me/password').send(VALID);
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/members/me/password').send(VALID);
    expect(blocked.status).toBe(429);
    expect(signIn).toHaveBeenCalledTimes(10);
  });
});
