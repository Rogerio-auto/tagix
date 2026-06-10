import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createAgentsRouter } from './index';

// Mini-app montando só o router de agentes (o orchestrator o monta em app.ts
// fora do boundary deste slot). Sem sessão, os guards barram antes de tocar o DB.
const app = express();
app.use(express.json());
app.use(createAgentsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de agentes (autorização)', () => {
  it('GET /api/agents sem sessão → 401', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });

  it('GET /api/agents/:id sem sessão → 401', async () => {
    const res = await request(app).get('/api/agents/abc');
    expect(res.status).toBe(401);
  });

  it('POST /api/agents sem sessão → 401', async () => {
    const res = await request(app).post('/api/agents').send({ name: 'x', systemPrompt: 'y' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/agents/:id sem sessão → 401', async () => {
    const res = await request(app).patch('/api/agents/abc').send({ name: 'z' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/agents/:id/status sem sessão → 401', async () => {
    const res = await request(app).patch('/api/agents/abc/status').send({ status: 'inactive' });
    expect(res.status).toBe(401);
  });

  it('GET /api/agents/tools sem sessão → 401', async () => {
    const res = await request(app).get('/api/agents/tools');
    expect(res.status).toBe(401);
  });

  it('GET /api/agents/:id/tools sem sessão → 401', async () => {
    const res = await request(app).get('/api/agents/abc/tools');
    expect(res.status).toBe(401);
  });

  it('PUT /api/agents/:id/tools/:toolId sem sessão → 401', async () => {
    const res = await request(app)
      .put('/api/agents/abc/tools/def')
      .send({ isEnabled: true });
    expect(res.status).toBe(401);
  });
});
