import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createFlowsRouter } from './index';

// Mini-app so com o router de flows (o orchestrator monta em app.ts fora do boundary).
// Sem sessao, os guards barram antes de tocar o DB.
const app = express();
app.use(express.json());
app.use(createFlowsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de flows (autorizacao)', () => {
  it('GET /api/flows sem sessao -> 401', async () => {
    expect((await request(app).get('/api/flows')).status).toBe(401);
  });

  it('GET /api/flows/:id sem sessao -> 401', async () => {
    expect((await request(app).get('/api/flows/abc')).status).toBe(401);
  });

  it('POST /api/flows sem sessao -> 401', async () => {
    expect(
      (await request(app).post('/api/flows').send({ name: 'x', triggerType: 'manual' })).status,
    ).toBe(401);
  });

  it('PUT /api/flows/:id sem sessao -> 401', async () => {
    expect((await request(app).put('/api/flows/abc').send({ name: 'y' })).status).toBe(401);
  });

  it('POST /api/flows/:id/publish sem sessao -> 401', async () => {
    expect((await request(app).post('/api/flows/abc/publish')).status).toBe(401);
  });

  it('POST /api/flows/:id/unpublish sem sessao -> 401', async () => {
    expect((await request(app).post('/api/flows/abc/unpublish')).status).toBe(401);
  });

  it('POST /api/flows/:id/archive sem sessao -> 401', async () => {
    expect((await request(app).post('/api/flows/abc/archive')).status).toBe(401);
  });

  it('POST /api/flows/:id/trigger sem sessao -> 401', async () => {
    expect((await request(app).post('/api/flows/abc/trigger').send({})).status).toBe(401);
  });

  it('GET /api/flows/:id/versions sem sessao -> 401', async () => {
    expect((await request(app).get('/api/flows/abc/versions')).status).toBe(401);
  });

  it('PATCH /api/flows/manual-order sem sessao -> 401', async () => {
    expect(
      (
        await request(app)
          .patch('/api/flows/manual-order')
          .send({ order: [{ id: '00000000-0000-0000-0000-000000000001', manualPosition: 0 }] })
      ).status,
    ).toBe(401);
  });

  it('GET /api/flows/:id/executions sem sessao -> 401', async () => {
    expect((await request(app).get('/api/flows/abc/executions')).status).toBe(401);
  });

  it('GET /api/flow-executions/:id sem sessao -> 401', async () => {
    expect((await request(app).get('/api/flow-executions/abc')).status).toBe(401);
  });

  it('POST /api/flow-executions/:id/cancel sem sessao -> 401', async () => {
    expect((await request(app).post('/api/flow-executions/abc/cancel').send({})).status).toBe(401);
  });
});
