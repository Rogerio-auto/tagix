import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@hm/db';
import { createDealsRouter } from './index';
import { TransitionError, validateTransition, type DealActor } from '../../services/deal-move';

// Storage fake (a porta) p/ nao tocar driver real nos testes de autorizacao.
const fakeStorage = {
  getSignedUrl: async (key: string) => ({ url: `https://x/${key}`, expiresAt: new Date() }),
  delete: async () => {},
};

const app = express();
app.use(express.json());
app.use(createDealsRouter(fakeStorage));

afterAll(async () => {
  await closeDb();
});

describe('rotas de deals (autorizacao)', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  it('GET /api/deals sem sessao -> 401', async () => {
    expect((await request(app).get('/api/deals')).status).toBe(401);
  });
  it('POST /api/deals sem sessao -> 401', async () => {
    expect((await request(app).post('/api/deals').send({})).status).toBe(401);
  });
  it('GET /api/deals/:id sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/deals/${ID}`)).status).toBe(401);
  });
  it('POST /api/deals/:id/move-stage sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/deals/${ID}/move-stage`).send({ stageId: ID })).status).toBe(401);
  });
  it('POST /api/deals/:id/close-won sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/deals/${ID}/close-won`)).status).toBe(401);
  });
  it('POST /api/deals/:id/close-lost sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/deals/${ID}/close-lost`).send({})).status).toBe(401);
  });
  it('POST /api/deals/:id/reopen sem sessao -> 401', async () => {
    expect((await request(app).post(`/api/deals/${ID}/reopen`)).status).toBe(401);
  });
  it('GET /api/deals/:id/history sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/deals/${ID}/history`)).status).toBe(401);
  });
  it('GET /api/deals/:id/attachments sem sessao -> 401', async () => {
    expect((await request(app).get(`/api/deals/${ID}/attachments`)).status).toBe(401);
  });
  it('POST /api/deals/:id/attachments/signed-url sem sessao -> 401', async () => {
    expect(
      (await request(app).post(`/api/deals/${ID}/attachments/signed-url`).send({ filename: 'a.jpg', mime: 'image/jpeg' })).status,
    ).toBe(401);
  });
});

describe('validateTransition (PIPELINE.md 4.2)', () => {
  const baseStage = {
    id: 's1',
    workspaceId: 'w',
    pipelineId: 'p',
    name: 'From',
    color: '#fff',
    icon: null,
    position: 0,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [],
    transitionRules: {},
    createdAt: new Date(),
    updatedAt: null,
  } as never;
  const baseDeal = { id: 'd', customFields: {} } as never;
  const member: DealActor = { type: 'member', memberId: 'm', role: 'AGENT' };

  it('bloqueia from-stage fora de allowedFromStageIds', () => {
    const to = { ...(baseStage as object), id: 's2', name: 'To', transitionRules: { allowedFromStageIds: ['sX'] } } as never;
    expect(() => validateTransition({ from: baseStage, to, deal: baseDeal, actor: member })).toThrow(TransitionError);
  });

  it('bloqueia required field ausente', () => {
    const to = { ...(baseStage as object), id: 's2', transitionRules: { requiredFields: ['budget'] } } as never;
    expect(() => validateTransition({ from: baseStage, to, deal: { id: 'd', customFields: {} } as never, actor: member })).toThrow(TransitionError);
  });

  it('passa required field presente', () => {
    const to = { ...(baseStage as object), id: 's2', transitionRules: { requiredFields: ['budget'] } } as never;
    expect(() => validateTransition({ from: baseStage, to, deal: { id: 'd', customFields: { budget: 100 } } as never, actor: member })).not.toThrow();
  });

  it('bloqueia role insuficiente', () => {
    const to = { ...(baseStage as object), id: 's2', transitionRules: { requiredRoles: ['ADMIN'] } } as never;
    expect(() => validateTransition({ from: baseStage, to, deal: baseDeal, actor: member })).toThrow(TransitionError);
  });

  it('passa role suficiente', () => {
    const to = { ...(baseStage as object), id: 's2', transitionRules: { requiredRoles: ['AGENT'] } } as never;
    expect(() => validateTransition({ from: baseStage, to, deal: baseDeal, actor: member })).not.toThrow();
  });
});
