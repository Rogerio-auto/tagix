import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createConversionsRouter } from './index';

const app = express();
app.use(express.json());
app.use(createConversionsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de conversoes (autorizacao)', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  it('GET /api/conversions sem sessao -> 401', async () => {
    expect((await request(app).get('/api/conversions')).status).toBe(401);
  });
  it('POST /api/conversions sem sessao -> 401', async () => {
    expect((await request(app).post('/api/conversions').send({ contactId: ID, conversionTypeKey: 'venda' })).status).toBe(401);
  });
  it('POST /api/conversions/:id/cancel sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/conversions/${ID}/cancel`).send({})).status).toBe(401);
  });
  it('GET /api/conversion-types sem sessao -> 401', async () => {
    expect((await request(app).get('/api/conversion-types')).status).toBe(401);
  });
  it('POST /api/conversion-types sem sessao -> 401', async () => {
    expect((await request(app).post('/api/conversion-types').send({ key: 'venda', label: 'Venda' })).status).toBe(401);
  });
  it('PUT /api/conversion-types/:id sem sessao -> 401', async () => {
    expect((await request(app).put(`/api/conversion-types/${ID}`).send({ label: 'X' })).status).toBe(401);
  });
  it('DELETE /api/conversion-types/:id sem sessao -> 401', async () => {
    expect((await request(app).delete(`/api/conversion-types/${ID}`)).status).toBe(401);
  });
});
