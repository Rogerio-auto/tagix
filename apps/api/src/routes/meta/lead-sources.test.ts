/**
 * F69-S03 — rotas das páginas que enviam leads.
 *
 * Protege: só membro autorizado assina página, e assinar `leadgen` não apaga campos
 * que o app já recebia na página (ex.: mensagens do Instagram).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createLeadSourcesRouter, mergeSubscribedFields } from './lead-sources';

const app = express();
app.use(express.json());
app.use(createLeadSourcesRouter());

afterAll(async () => {
  await closeDb();
});

describe('autorização', () => {
  it('listar sem sessão → 401', async () => {
    expect((await request(app).get('/api/meta/lead-sources')).status).toBe(401);
  });
  it('assinar sem sessão → 401', async () => {
    const res = await request(app)
      .post('/api/meta/lead-sources')
      .send({ connectionId: '00000000-0000-0000-0000-000000000001', pageId: '123' });
    expect(res.status).toBe(401);
  });
  it('parar sem sessão → 401', async () => {
    expect((await request(app).delete('/api/meta/lead-sources/00000000-0000-0000-0000-000000000001')).status).toBe(401);
  });
});

describe('mergeSubscribedFields', () => {
  it('mantém o que o app já recebia e acrescenta leadgen', () => {
    const atual = {
      data: [
        { id: '999', subscribed_fields: ['messages', 'messaging_postbacks'] },
        { id: 'outro-app', subscribed_fields: ['feed'] },
      ],
    };
    expect(mergeSubscribedFields(atual, '999')).toEqual(['leadgen', 'messages', 'messaging_postbacks']);
  });

  it('app ainda não instalado na página: só leadgen', () => {
    expect(mergeSubscribedFields({ data: [] }, '999')).toEqual(['leadgen']);
    expect(mergeSubscribedFields(null, '999')).toEqual(['leadgen']);
  });

  it('não duplica leadgen já assinado', () => {
    expect(mergeSubscribedFields({ data: [{ id: 999, subscribed_fields: ['leadgen'] }] }, '999')).toEqual(['leadgen']);
  });
});
