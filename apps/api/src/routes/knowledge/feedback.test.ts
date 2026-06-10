import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createKnowledgeFeedbackRouter } from './feedback';

// Mini-app montando so o router de feedback (o orchestrator o monta em app.ts).
// Sem sessao, os guards barram antes de tocar o DB.
const app = express();
app.use(express.json());
app.use(createKnowledgeFeedbackRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de feedback de KB (autorizacao)', () => {
  it('POST /api/knowledge/feedback sem sessao -> 401', async () => {
    const res = await request(app)
      .post('/api/knowledge/feedback')
      .send({ documentId: '11111111-1111-1111-1111-111111111111', helpful: true });
    expect(res.status).toBe(401);
  });

  it('GET /api/knowledge/feedback sem sessao -> 401', async () => {
    const res = await request(app)
      .get('/api/knowledge/feedback')
      .query({ documentId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(401);
  });
});
