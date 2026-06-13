/**
 * Testes de autorizacao das rotas do wizard IG (F15-S06): sem sessao -> 401.
 * Permission scope: channel.connect (owner/admin). Nao exercita Graph/DB reais.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createChannelsRouter } from './index';

const app = express();
app.use(express.json());
app.use(createChannelsRouter());

afterAll(async () => {
  await closeDb();
});

describe('rotas do wizard Instagram (autorizacao)', () => {
  it('POST /api/channels/instagram/accounts sem sessao -> 401', async () => {
    const res = await request(app)
      .post('/api/channels/instagram/accounts')
      .send({ userAccessToken: 'x' });
    expect(res.status).toBe(401);
  });

  it('POST /api/channels/instagram/connect sem sessao -> 401', async () => {
    const res = await request(app)
      .post('/api/channels/instagram/connect')
      .send({ name: 'IG', pageId: 'p', pageAccessToken: 't', igUserId: 'u' });
    expect(res.status).toBe(401);
  });
});
