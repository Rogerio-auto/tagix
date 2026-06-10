import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createKnowledgeRouter } from './index';

// Mini-app montando so o router de KB (o orchestrator o monta em app.ts).
// Sem sessao, os guards barram antes de tocar o DB/MQ.
const app = express();
app.use(express.json());
app.use(createKnowledgeRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de knowledge base (autorizacao)', () => {
  it('POST /api/knowledge/documents sem sessao -> 401', async () => {
    const res = await request(app)
      .post('/api/knowledge/documents')
      .send({ title: 'x', rawContent: 'y' });
    expect(res.status).toBe(401);
  });

  it('GET /api/knowledge/documents sem sessao -> 401', async () => {
    const res = await request(app).get('/api/knowledge/documents');
    expect(res.status).toBe(401);
  });

  it('GET /api/knowledge/documents/:id sem sessao -> 401', async () => {
    const res = await request(app).get('/api/knowledge/documents/abc');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/knowledge/documents/:id sem sessao -> 401', async () => {
    const res = await request(app).patch('/api/knowledge/documents/abc').send({ title: 'z' });
    expect(res.status).toBe(401);
  });

  it('POST /api/knowledge/documents/:id/reprocess sem sessao -> 401', async () => {
    const res = await request(app).post('/api/knowledge/documents/abc/reprocess');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/knowledge/documents/:id sem sessao -> 401', async () => {
    const res = await request(app).delete('/api/knowledge/documents/abc');
    expect(res.status).toBe(401);
  });
});
