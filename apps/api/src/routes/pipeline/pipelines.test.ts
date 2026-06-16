import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPipelinesRouter } from './pipelines';

/**
 * Testes de unidade para F35-S02: limite de pipelines + shape { data, meta }.
 * Mocka os middlewares de auth e req.scoped — sem banco real.
 */

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.auth = {
      workspace: { id: '00000000-0000-0000-0000-000000000001' },
      member: { id: 'mem-1', role: 'ADMIN' },
    } as typeof req.auth;
    next();
  },
  withRLS: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    next();
  },
  requireRole:
    (_perm: string) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      next();
    },
}));

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

function pipelineRow(id: string, name: string) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name,
    description: null,
    industry: null,
    isDefault: false,
    isActive: true,
    settings: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Injeta req.auth e req.scoped mockado na stack do Express. */
function withMockedScoped(app: express.Express, returnValue: unknown): express.Express {
  app.use((req: express.Request, _res, next) => {
    req.auth = {
      workspace: { id: WORKSPACE_ID },
      member: { id: 'mem-1', role: 'ADMIN' },
    } as typeof req.auth;
    // Usamos 'as unknown' para compatibilidade com o genérico de req.scoped
    (req as unknown as { scoped: unknown }).scoped = () =>
      Promise.resolve(returnValue);
    next();
  });
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/pipelines — shape { data, meta }
// ---------------------------------------------------------------------------
describe('GET /api/pipelines', () => {
  it('retorna { data, meta: { limit:10, current } } sem override', async () => {
    const rows = [pipelineRow('p1', 'P1'), pipelineRow('p2', 'P2')];
    const app = withMockedScoped(express(), [rows, []]);
    app.use(express.json());
    app.use(createPipelinesRouter());

    const res = await request(app).get('/api/pipelines');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ limit: 10, current: 2 });
  });

  it('respeita override max_pipelines=3', async () => {
    const rows = [pipelineRow('p1', 'P1')];
    const app = withMockedScoped(express(), [rows, [{ limits: { max_pipelines: 3 } }]]);
    app.use(express.json());
    app.use(createPipelinesRouter());

    const res = await request(app).get('/api/pipelines');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ limit: 3, current: 1 });
  });
});

// ---------------------------------------------------------------------------
// POST /api/pipelines — limite
// ---------------------------------------------------------------------------
describe('POST /api/pipelines', () => {
  it('400 para body invalido (sem nome)', async () => {
    const app = withMockedScoped(express(), { ok: false, current: 0, limit: 10 });
    app.use(express.json());
    app.use(createPipelinesRouter());

    const res = await request(app).post('/api/pipelines').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('422 pipeline_limit_reached quando workspace tem >= 10 pipelines', async () => {
    const app = withMockedScoped(express(), { ok: false as const, current: 10, limit: 10 });
    app.use(express.json());
    app.use(createPipelinesRouter());

    const res = await request(app)
      .post('/api/pipelines')
      .send({ name: 'Pipeline extra' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('pipeline_limit_reached');
    expect(res.body.current).toBe(10);
    expect(res.body.max).toBe(10);
  });

  it('201 quando abaixo do limite', async () => {
    const created = pipelineRow('p-new', 'Nova Pipeline');
    const app = withMockedScoped(express(), { ok: true as const, pipeline: created });
    app.use(express.json());
    app.use(createPipelinesRouter());

    const res = await request(app)
      .post('/api/pipelines')
      .send({ name: 'Nova Pipeline' });
    expect(res.status).toBe(201);
    expect(res.body.pipeline).toBeDefined();
    expect(res.body.pipeline.name).toBe('Nova Pipeline');
  });
});
