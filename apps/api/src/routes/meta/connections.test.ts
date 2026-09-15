/**
 * F69-S02 — rotas da conexão Meta.
 *
 * O que este arquivo protege: que só membro autorizado mexa na conexão, e que o
 * que sai para a tela nunca carregue token nem o ID de usuário da Meta.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, type MetaConnectionPublic } from '@hm/db';
import { createMetaConnectionsRouter, toView } from './connections';

const app = express();
app.use(express.json());
app.use(createMetaConnectionsRouter());

afterAll(async () => {
  await closeDb();
});

const ID = '00000000-0000-0000-0000-000000000001';

describe('autorização', () => {
  it('criar sem sessão → 401', async () => {
    const res = await request(app).post('/api/meta/connections').send({ code: 'c', useCases: ['leads'] });
    expect(res.status).toBe(401);
  });
  it('listar sem sessão → 401', async () => {
    expect((await request(app).get('/api/meta/connections')).status).toBe(401);
  });
  it('reler sem sessão → 401', async () => {
    expect((await request(app).post(`/api/meta/connections/${ID}/refresh`)).status).toBe(401);
  });
  it('remover sem sessão → 401', async () => {
    expect((await request(app).delete(`/api/meta/connections/${ID}`)).status).toBe(401);
  });
});

describe('toView — o que a tela recebe', () => {
  const agora = new Date('2026-09-14T12:00:00Z');
  const conexao: MetaConnectionPublic = {
    id: ID,
    workspaceId: 'ws',
    metaUserId: 'asid-secreto-123',
    metaUserName: 'Ana',
    tokenExpiresAt: new Date('2026-11-01T00:00:00Z'),
    useCases: ['leads', 'ads_read', 'caso_de_uso_antigo'],
    grantedPermissions: ['ads_read', 'business_management'],
    declinedPermissions: ['leads_retrieval'],
    assets: { pages: [], adAccounts: [] },
    status: 'active',
    connectedBy: null,
    lastCheckedAt: agora,
    createdAt: agora,
    updatedAt: null,
  };

  it('não expõe o ID de usuário da Meta', () => {
    expect(JSON.stringify(toView(conexao, agora))).not.toContain('asid-secreto-123');
  });

  it('diz qual caso de uso parou e o que falta', () => {
    const v = toView(conexao, agora);
    expect(v.health).toBe('missing_permissions');
    const leads = v.useCases.find((u) => u.id === 'leads');
    expect(leads?.label).toBe('Leads dos anúncios');
    expect(leads?.missing).toContain('leads_retrieval');
    expect(v.useCases.find((u) => u.id === 'ads_read')?.missing).toEqual([]);
  });

  it('caso de uso desconhecido gravado no banco é ignorado, não quebra a tela', () => {
    expect(toView(conexao, agora).useCases.map((u) => u.id)).toEqual(['leads', 'ads_read']);
  });
});
