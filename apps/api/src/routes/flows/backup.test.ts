import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createFlowsRouter } from './index';

// Mini-app só com o router de flows (inclui backup). Sem sessão, os guards barram (401)
// antes de tocar o DB — mesmo padrão de routes.test.ts.
const app = express();
app.use(express.json());
app.use(createFlowsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas de backup de flows (autorização)', () => {
  it('GET /api/flows/backup/export sem sessão -> 401', async () => {
    expect((await request(app).get('/api/flows/backup/export')).status).toBe(401);
  });

  it('POST /api/flows/backup/preview sem sessão -> 401', async () => {
    expect(
      (await request(app).post('/api/flows/backup/preview').send({ envelope: {} })).status,
    ).toBe(401);
  });

  it('POST /api/flows/backup/import sem sessão -> 401', async () => {
    expect(
      (
        await request(app)
          .post('/api/flows/backup/import')
          .send({ envelope: {}, confirmedChecksum: 'a'.repeat(64) })
      ).status,
    ).toBe(401);
  });

  it('rota literal de backup tem precedência sobre /:id (não cai em 401 de detalhe por engano)', async () => {
    // export é GET; sem sessão deve ser 401 do guard de backup, não 404/200 de /:id.
    const res = await request(app).get('/api/flows/backup/export');
    expect(res.status).toBe(401);
  });
});
