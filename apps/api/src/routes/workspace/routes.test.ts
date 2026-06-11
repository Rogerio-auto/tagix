import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createWorkspaceSettingsRouter } from './index';

const app = express();
app.use(express.json());
app.use(createWorkspaceSettingsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de workspace settings (autorização)', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  it('GET /api/workspace sem sessão -> 401', async () => {
    expect((await request(app).get('/api/workspace')).status).toBe(401);
  });
  it('PATCH /api/workspace sem sessão -> 401', async () => {
    expect((await request(app).patch('/api/workspace').send({ name: 'X' })).status).toBe(401);
  });
  it('GET /api/members sem sessão -> 401', async () => {
    expect((await request(app).get('/api/members')).status).toBe(401);
  });
  it('POST /api/members sem sessão -> 401', async () => {
    expect((await request(app).post('/api/members').send({ email: 'a@b.com' })).status).toBe(401);
  });
  it('PATCH /api/members/:id sem sessão -> 401', async () => {
    expect((await request(app).patch(`/api/members/${ID}`).send({ role: 'AGENT' })).status).toBe(401);
  });
  it('DELETE /api/members/:id sem sessão -> 401', async () => {
    expect((await request(app).delete(`/api/members/${ID}`)).status).toBe(401);
  });
});
