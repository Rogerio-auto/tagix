/**
 * Testes de autorizacao das rotas de comments IG (F15-S05): sem sessao -> 401.
 * Scope: list=conversation.view, reply=conversation.assign, hide/delete=
 * conversation.delete_message. Nao exercita Graph/DB reais.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createInstagramRouter } from './index';

const app = express();
app.use(express.json());
app.use(createInstagramRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de comments Instagram (autorizacao)', () => {
  it('GET /api/instagram/comments sem sessao -> 401', async () => {
    expect((await request(app).get('/api/instagram/comments?mediaId=M1')).status).toBe(401);
  });
  it('POST /api/instagram/comments/:id/reply sem sessao -> 401', async () => {
    const res = await request(app)
      .post('/api/instagram/comments/C1/reply')
      .send({ mode: 'public', text: 'oi' });
    expect(res.status).toBe(401);
  });
  it('POST /api/instagram/comments/:id/hide sem sessao -> 401', async () => {
    expect((await request(app).post('/api/instagram/comments/C1/hide').send({})).status).toBe(401);
  });
  it('DELETE /api/instagram/comments/:id sem sessao -> 401', async () => {
    expect((await request(app).delete('/api/instagram/comments/C1')).status).toBe(401);
  });
});
