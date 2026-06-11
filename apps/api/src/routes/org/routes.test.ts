import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createOrgSettingsRouter } from './index';

const app = express();
app.use(express.json());
app.use(createOrgSettingsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de org (autorização)', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  it('GET /api/departments sem sessão -> 401', async () => {
    expect((await request(app).get('/api/departments')).status).toBe(401);
  });
  it('POST /api/departments sem sessão -> 401', async () => {
    expect((await request(app).post('/api/departments').send({ name: 'X' })).status).toBe(401);
  });
  it('GET /api/teams sem sessão -> 401', async () => {
    expect((await request(app).get('/api/teams')).status).toBe(401);
  });
  it('POST /api/teams sem sessão -> 401', async () => {
    expect((await request(app).post('/api/teams').send({ name: 'X' })).status).toBe(401);
  });
  it('PUT /api/teams/:id/members/:memberId sem sessão -> 401', async () => {
    expect((await request(app).put(`/api/teams/${ID}/members/${ID}`).send({})).status).toBe(401);
  });
  it('GET /api/sla sem sessão -> 401', async () => {
    expect((await request(app).get('/api/sla')).status).toBe(401);
  });
  it('PUT /api/sla sem sessão -> 401', async () => {
    expect((await request(app).put('/api/sla').send({ scopeType: 'workspace' })).status).toBe(401);
  });
});
