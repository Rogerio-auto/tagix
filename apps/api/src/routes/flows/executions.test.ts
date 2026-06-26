import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createFlowExecutionsRouter } from './executions';

// Mini-app só com o router de executions. Sem sessão, os guards barram (401) antes do DB.
// O enriquecimento com flowName e a emissão de socket no cancel são validados E2E em prod
// (DB+sessão reais) — o harness de rota cobre só autorização.
const app = express();
app.use(express.json());
app.use(createFlowExecutionsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de executions (autorização)', () => {
  it('GET /api/flows/executions?conversationId sem sessão -> 401', async () => {
    expect(
      (await request(app).get('/api/flows/executions?conversationId=11111111-1111-1111-1111-111111111111'))
        .status,
    ).toBe(401);
  });

  it('GET /api/flow-executions/:id sem sessão -> 401', async () => {
    expect((await request(app).get('/api/flow-executions/abc')).status).toBe(401);
  });

  it('POST /api/flow-executions/:id/cancel sem sessão -> 401', async () => {
    expect((await request(app).post('/api/flow-executions/abc/cancel').send({})).status).toBe(401);
  });
});
