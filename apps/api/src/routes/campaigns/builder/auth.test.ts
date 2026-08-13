/**
 * Sessão ausente nos endpoints do criador guiado. Fica em arquivo próprio de
 * propósito: aqui os middlewares de auth são os REAIS (o teste de permissão os
 * substitui por mocks e não conseguiria provar o 401).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createCampaignBuilderRouter } from './index';

const app = express();
app.use(express.json());
app.use(createCampaignBuilderRouter());

afterAll(async () => {
  await closeDb();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('criador guiado sem sessão', () => {
  it('GET /api/campaigns/builder/options -> 401', async () => {
    expect((await request(app).get('/api/campaigns/builder/options')).status).toBe(401);
  });

  it.each(['preview', 'estimate', 'preflight', 'test'])(
    'POST /api/campaigns/:id/builder/%s -> 401',
    async (endpoint) => {
      const response = await request(app)
        .post(`/api/campaigns/${ID}/builder/${endpoint}`)
        .send({});
      expect(response.status).toBe(401);
    },
  );
});
