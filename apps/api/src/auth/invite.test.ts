/**
 * F71-S05 — rotas públicas de convite: forma da resposta, 404 uniforme, validação do
 * aceite e rate-limit por IP. O fluxo completo (com banco e provider) está em
 * `routes/workspace/invites.integration.test.ts`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { closeRateLimit } from '../middlewares/rate-limit';
import { closeInviteQuota } from '../routes/workspace/invite-quota';
import { createInviteAuthRouter, maskEmail } from './invite';

const run = randomUUID().slice(0, 8);

function appWith(limits?: Parameters<typeof createInviteAuthRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use(createInviteAuthRouter(limits));
  return app;
}

const app = appWith({
  limits: {
    preview: { bucket: `invite_preview_t_${run}`, max: 1000, windowSec: 600 },
    accept: { bucket: `invite_accept_t_${run}`, max: 1000, windowSec: 600 },
    sendEmail: { bucket: `invite_send_t_${run}`, max: 1000, windowSec: 600 },
  },
});

const preview = (target: express.Express, body: unknown) =>
  request(target).post('/auth/invite/preview').send(body as object);

afterAll(async () => {
  await closeRateLimit();
  await closeInviteQuota();
  await closeDb();
});

describe('maskEmail', () => {
  it('mostra o começo do usuário e o domínio', () => {
    expect(maskEmail('joana@empresa.com')).toBe('jo***@empresa.com');
    expect(maskEmail('ab@x.com')).toBe('a***@x.com');
    expect(maskEmail('a@x.com')).toBe('a***@x.com');
    expect(maskEmail('sem-arroba')).toBe('***');
  });
});

const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('rotas públicas de convite (preview, send-email, accept)', () => {
  const live = () => randomBytes(32).toString('base64url');

  it('preview: token malformado, inexistente e corpo inválido → o MESMO 404; no-store e no-referrer', async () => {
    const results = [
      await preview(app, { token: '<script>' }),
      await preview(app, { token: 'abc' }),
      await preview(app, { token: live() }),
      await preview(app, {}),
      await preview(app, { token: live(), extra: 1 }),
    ];
    for (const res of results) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'invite_not_found', message: 'Convite inválido ou expirado.' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('o preview por GET com o token no caminho não existe mais (B3)', async () => {
    const res = await request(app).get(`/auth/invite/${live()}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('workspaceName');
  });

  it('send-email: token inexistente → o mesmo 404 do preview', async () => {
    const res = await request(app).post('/auth/invite/send-email').send({ token: live() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('invite_not_found');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('aceite com token inexistente → o mesmo 404 do preview', async () => {
    const res = await request(app)
      .post('/auth/invite/accept')
      .send({ token: live(), password: 'Senha-forte-123' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('invite_not_found');
  });

  it('payload inválido → 400 sem ecoar o token; papel/empresa no body são recusados', async () => {
    const token = live();
    for (const body of [
      {},
      { token: 123 },
      { token, role: 'OWNER' },
      { token, workspaceId: randomUUID() },
      { token, password: 'x'.repeat(201) },
      { token, emailProof: { tokenHash: '../../x', type: 'invite' } },
      { token, emailProof: { tokenHash: 'a'.repeat(56), type: 'recovery' } },
      { token, emailProof: 'a'.repeat(56) },
    ]) {
      const res = await request(app).post('/auth/invite/accept').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_payload' });
      expect(JSON.stringify(res.body)).not.toContain(token);
    }
  });

  it('rate-limit por IP → 429', async () => {
    const limited = appWith({
      limits: {
        preview: { bucket: `invite_preview_rl_${run}`, max: 2, windowSec: 60 },
        accept: { bucket: `invite_accept_rl_${run}`, max: 1, windowSec: 60 },
        sendEmail: { bucket: `invite_send_rl_${run}`, max: 1, windowSec: 60 },
      },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await preview(limited, { token: live() })).status);
    expect(statuses).toEqual([404, 404, 429]);

    const sendStatuses: number[] = [];
    for (let i = 0; i < 2; i++) {
      sendStatuses.push((await request(limited).post('/auth/invite/send-email').send({ token: live() })).status);
    }
    expect(sendStatuses).toEqual([404, 429]);

    const first = await request(limited).post('/auth/invite/accept').send({ token: live() });
    const second = await request(limited).post('/auth/invite/accept').send({ token: live() });
    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
  });
});
