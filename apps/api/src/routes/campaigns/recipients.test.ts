import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createCampaignRecipientsRouter, isE164, parseCsv } from './recipients';
import { createContactsOptInRouter } from '../contacts/opt-in';

const app = express();
app.use(express.json());
app.use(createCampaignRecipientsRouter());
app.use(createContactsOptInRouter());

afterAll(async () => {
  await closeDb();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('recipients + opt-in (autorizacao)', () => {
  it('POST /api/campaigns/:id/recipients/bulk sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns/' + ID + '/recipients/bulk').send({ rows: [] })).status).toBe(401);
  });
  it('POST /api/campaigns/:id/recipients/bulk-opt-in sem sessao -> 401', async () => {
    expect((await request(app).post('/api/campaigns/' + ID + '/recipients/bulk-opt-in').send({})).status).toBe(401);
  });
  it('POST /api/contacts/:id/opt-in sem sessao -> 401', async () => {
    expect((await request(app).post('/api/contacts/' + ID + '/opt-in').send({ method: 'manual' })).status).toBe(401);
  });
  it('POST /api/contacts/:id/opt-out sem sessao -> 401', async () => {
    expect((await request(app).post('/api/contacts/' + ID + '/opt-out').send({})).status).toBe(401);
  });
  it('POST /api/contacts/bulk-opt-in sem sessao -> 401', async () => {
    expect((await request(app).post('/api/contacts/bulk-opt-in').send({ contactIds: [ID] })).status).toBe(401);
  });
});

describe('isE164', () => {
  it('aceita E.164 valido', () => {
    expect(isE164('+5511999998888')).toBe(true);
    expect(isE164('+14155552671')).toBe(true);
  });
  it('rejeita sem +, com zero inicial, curto demais ou com letras', () => {
    expect(isE164('5511999998888')).toBe(false);
    expect(isE164('+0511999998888')).toBe(false);
    expect(isE164('+12345')).toBe(false);
    expect(isE164('+55abc99998888')).toBe(false);
    expect(isE164('')).toBe(false);
  });
});

describe('parseCsv', () => {
  it('parseia header phone,name,opt_in', () => {
    const rows = parseCsv('phone,name,opt_in\n+5511999998888,Joao,true\n+14155552671,Maria,false');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ phone: '+5511999998888', name: 'Joao', optIn: true });
    expect(rows[1]?.optIn).toBe(false);
  });
  it('sem header de phone usa a primeira coluna', () => {
    const rows = parseCsv('telefone\n+5511999998888');
    expect(rows[0]?.phone).toBe('+5511999998888');
  });
  it('ignora linhas vazias', () => {
    expect(parseCsv('phone\n\n\n')).toHaveLength(0);
  });
});
