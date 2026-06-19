/**
 * Testes de rota do onboarding (F43-S04). Sem banco real: mockamos
 * `./db-internal` (instanciador + repo + registry) e `./checklist` (derivação),
 * e injetamos `req.auth`/`req.scoped`. O `requireRole` mockado usa o `can()` REAL
 * de `@hm/shared`, então a autorização (`workspace.edit`) é genuinamente testada.
 *
 * Cobre: authz (não-admin barrado), idempotência do apply (2ª == 1ª),
 * payload inválido (400) e checklist em ≥2 estados.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can, type Permission, type Role } from '@hm/shared';
import type { ChecklistStep } from './checklist';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000a1';

/** Estado de auth mutável por teste (role + se há sessão). */
const authState: { role: Role; authenticated: boolean } = {
  role: 'ADMIN',
  authenticated: true,
};

/** Resultado mockado retornado por `req.scoped(fn)`. O `fn` recebe um tx fake. */
const scopedState: { result: unknown } = { result: undefined };

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.authenticated) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: WORKSPACE_ID },
      member: { id: MEMBER_ID, role: authState.role },
    } as typeof req.auth;
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { scoped: unknown }).scoped = (fn: (tx: unknown) => Promise<unknown>) =>
      Promise.resolve(scopedState.result ?? fn({}));
    next();
  },
  // Usa a matriz REAL — authz de verdade.
  requireRole:
    (perm: Permission) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = (req.auth?.member.role ?? authState.role) as Role;
      if (!can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

// Mocks do acoplamento com @hm/db (S01/S02/S03) — sem banco.
const instantiateMock = vi.fn();
const mergeMock = vi.fn();
const getOnboardingMock = vi.fn();
const getTourMock = vi.fn();
const markTourMock = vi.fn();

vi.mock('./db-internal', () => ({
  NICHE_KEYS: ['real_estate', 'health', 'education', 'solar', 'retail', 'law', 'agency'],
  isNicheKey: (k: string) =>
    ['real_estate', 'health', 'education', 'solar', 'retail', 'law', 'agency'].includes(k),
  getBlueprint: (k: string) =>
    ['real_estate', 'health', 'education', 'solar', 'retail', 'law', 'agency'].includes(k)
      ? { key: k }
      : undefined,
  instantiateNicheBlueprint: (...args: unknown[]) => instantiateMock(...args),
  onboardingRepo: {
    mergeWorkspaceOnboarding: (...args: unknown[]) => mergeMock(...args),
    getWorkspaceOnboarding: (...args: unknown[]) => getOnboardingMock(...args),
    getMemberTourState: (...args: unknown[]) => getTourMock(...args),
    markTour: (...args: unknown[]) => markTourMock(...args),
  },
}));

const deriveChecklistMock = vi.fn();
vi.mock('./checklist', () => ({
  deriveChecklist: (...args: unknown[]) => deriveChecklistMock(...args),
}));

// Importado APÓS os mocks (vi.mock é hoisted, mas explicitamos a ordem mental).
import { createOnboardingRouter } from './index';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createOnboardingRouter());
  return app;
}

beforeEach(() => {
  authState.role = 'ADMIN';
  authState.authenticated = true;
  scopedState.result = undefined;
  instantiateMock.mockReset();
  mergeMock.mockReset();
  getOnboardingMock.mockReset();
  getTourMock.mockReset();
  markTourMock.mockReset();
  deriveChecklistMock.mockReset();
  mergeMock.mockResolvedValue({ niche_key: 'health' });
});

// ── POST /api/onboarding/apply ───────────────────────────────────────────────
describe('POST /api/onboarding/apply', () => {
  it('201 com { pipelineId, agentIds, createdCounts } para ADMIN', async () => {
    instantiateMock.mockResolvedValue({
      pipelineId: 'pipe-1',
      agentIds: ['a1', 'a2'],
      createdCounts: { pipelines: 1, agents: 2 },
    });

    const res = await request(buildApp()).post('/api/onboarding/apply').send({ niche: 'health' });

    expect(res.status).toBe(201);
    expect(res.body.pipelineId).toBe('pipe-1');
    expect(res.body.agentIds).toEqual(['a1', 'a2']);
    expect(res.body.createdCounts).toEqual({ pipelines: 1, agents: 2 });
  });

  it('403 para role sem workspace.edit (READONLY)', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp()).post('/api/onboarding/apply').send({ niche: 'health' });
    expect(res.status).toBe(403);
    expect(instantiateMock).not.toHaveBeenCalled();
  });

  it('403 para AGENT (não-admin)', async () => {
    authState.role = 'AGENT';
    const res = await request(buildApp()).post('/api/onboarding/apply').send({ niche: 'law' });
    expect(res.status).toBe(403);
  });

  it('400 para nicho inválido', async () => {
    const res = await request(buildApp())
      .post('/api/onboarding/apply')
      .send({ niche: 'not_a_niche' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(typeof res.body.message).toBe('string');
  });

  it('400 para body sem niche', async () => {
    const res = await request(buildApp()).post('/api/onboarding/apply').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('é idempotente: 2 aplicações retornam o mesmo payload (herda de S02)', async () => {
    // O instanciador é idempotente por contrato (S02). Aqui validamos que o
    // endpoint repassa de forma determinística o mesmo resultado.
    instantiateMock.mockResolvedValue({
      pipelineId: 'pipe-stable',
      agentIds: ['a1'],
      createdCounts: { pipelines: 1, agents: 1, tags: 4 },
    });

    const app = buildApp();
    const first = await request(app).post('/api/onboarding/apply').send({ niche: 'real_estate' });
    const second = await request(app).post('/api/onboarding/apply').send({ niche: 'real_estate' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    // Estado carimbado com niche_key + applied_at nas duas vezes.
    expect(mergeMock).toHaveBeenCalledTimes(2);
    const patch = mergeMock.mock.calls[0]?.[2] as { niche_key?: string; applied_at?: string };
    expect(patch.niche_key).toBe('real_estate');
    expect(typeof patch.applied_at).toBe('string');
  });
});

// ── GET /api/onboarding/checklist ────────────────────────────────────────────
describe('GET /api/onboarding/checklist', () => {
  it('estado A: nada feito → todos os passos done:false', async () => {
    const steps: ChecklistStep[] = [
      { key: 'connect_channel', label: 'Conectar o WhatsApp', done: false, href: '/settings/channels' },
      { key: 'activate_agent', label: 'Ativar seu agente de IA', done: false, href: '/agents' },
      { key: 'import_contacts', label: 'Importar contatos', done: false, href: '/contacts' },
      { key: 'publish_flow', label: 'Publicar seu primeiro fluxo', done: false, href: '/flows' },
      { key: 'send_campaign', label: 'Enviar a primeira campanha', done: false, href: '/campaigns' },
    ];
    deriveChecklistMock.mockResolvedValue(steps);

    const res = await request(buildApp()).get('/api/onboarding/checklist');
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(5);
    expect(res.body.steps.every((s: ChecklistStep) => s.done === false)).toBe(true);
  });

  it('estado B: canal + agente prontos → 2 passos done:true', async () => {
    const steps: ChecklistStep[] = [
      { key: 'connect_channel', label: 'Conectar o WhatsApp', done: true, href: '/settings/channels' },
      { key: 'activate_agent', label: 'Ativar seu agente de IA', done: true, href: '/agents' },
      { key: 'import_contacts', label: 'Importar contatos', done: false, href: '/contacts' },
      { key: 'publish_flow', label: 'Publicar seu primeiro fluxo', done: false, href: '/flows' },
      { key: 'send_campaign', label: 'Enviar a primeira campanha', done: false, href: '/campaigns' },
    ];
    deriveChecklistMock.mockResolvedValue(steps);

    const res = await request(buildApp()).get('/api/onboarding/checklist');
    expect(res.status).toBe(200);
    const done = res.body.steps.filter((s: ChecklistStep) => s.done);
    expect(done.map((s: ChecklistStep) => s.key)).toEqual(['connect_channel', 'activate_agent']);
  });

  it('403 para READONLY', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp()).get('/api/onboarding/checklist');
    expect(res.status).toBe(403);
  });
});

// ── GET /api/onboarding/state ────────────────────────────────────────────────
describe('GET /api/onboarding/state', () => {
  it('retorna { onboarding, checklist, tourState }', async () => {
    getOnboardingMock.mockResolvedValue({ niche_key: 'health', applied_at: '2026-06-19T00:00:00Z' });
    getTourMock.mockResolvedValue({ dashboard: { completed_at: '2026-06-19T00:00:00Z' } });
    deriveChecklistMock.mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/onboarding/state');
    expect(res.status).toBe(200);
    expect(res.body.onboarding.niche_key).toBe('health');
    expect(res.body.tourState.dashboard.completed_at).toBe('2026-06-19T00:00:00Z');
    expect(Array.isArray(res.body.checklist)).toBe(true);
  });
});

// ── PUT /api/onboarding/survey ───────────────────────────────────────────────
describe('PUT /api/onboarding/survey', () => {
  it('200 grava a pesquisa válida', async () => {
    mergeMock.mockResolvedValue({ survey: { teamSize: '2-5', goal: 'sell_more' } });
    const res = await request(buildApp())
      .put('/api/onboarding/survey')
      .send({ teamSize: '2-5', goal: 'sell_more', businessType: 'Imobiliária' });
    expect(res.status).toBe(200);
    expect(res.body.onboarding.survey).toBeDefined();
  });

  it('400 para pesquisa vazia (sem nenhuma resposta)', async () => {
    const res = await request(buildApp()).put('/api/onboarding/survey').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 para enum inválido', async () => {
    const res = await request(buildApp())
      .put('/api/onboarding/survey')
      .send({ teamSize: 'gigante' });
    expect(res.status).toBe(400);
  });

  it('403 para AGENT', async () => {
    authState.role = 'AGENT';
    const res = await request(buildApp())
      .put('/api/onboarding/survey')
      .send({ goal: 'automate' });
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/me/tour-state ───────────────────────────────────────────────────
describe('PUT /api/me/tour-state', () => {
  it('200 marca tour como completed (qualquer membro autenticado)', async () => {
    authState.role = 'AGENT'; // sem workspace.edit, mas é o próprio membro
    markTourMock.mockResolvedValue({ dashboard: { completed_at: '2026-06-19T00:00:00Z' } });
    const res = await request(buildApp())
      .put('/api/me/tour-state')
      .send({ tourId: 'dashboard', completed: true });
    expect(res.status).toBe(200);
    expect(markTourMock).toHaveBeenCalledTimes(1);
    const entry = markTourMock.mock.calls[0]?.[3] as { completed_at?: string };
    expect(typeof entry.completed_at).toBe('string');
  });

  it('200 marca tour como dismissed', async () => {
    markTourMock.mockResolvedValue({ pipeline: { dismissed: true } });
    const res = await request(buildApp())
      .put('/api/me/tour-state')
      .send({ tourId: 'pipeline', dismissed: true });
    expect(res.status).toBe(200);
    const entry = markTourMock.mock.calls[0]?.[3] as { dismissed?: boolean };
    expect(entry.dismissed).toBe(true);
  });

  it('400 sem completed nem dismissed', async () => {
    const res = await request(buildApp())
      .put('/api/me/tour-state')
      .send({ tourId: 'dashboard' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('401 quando não autenticado', async () => {
    authState.authenticated = false;
    const res = await request(buildApp())
      .put('/api/me/tour-state')
      .send({ tourId: 'dashboard', completed: true });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/onboarding/niche (legado) ──────────────────────────────────────
describe('POST /api/onboarding/niche (legado)', () => {
  it('201 e mapeia alias clinic → health', async () => {
    instantiateMock.mockResolvedValue({
      pipelineId: 'pipe-x',
      agentIds: [],
      createdCounts: { pipelines: 1 },
    });
    const res = await request(buildApp())
      .post('/api/onboarding/niche')
      .send({ niche: 'clinic', createAgent: true });
    expect(res.status).toBe(201);
    const patch = mergeMock.mock.calls[0]?.[2] as { niche_key?: string };
    expect(patch.niche_key).toBe('health');
  });

  it('404 para nicho legado desconhecido', async () => {
    const res = await request(buildApp())
      .post('/api/onboarding/niche')
      .send({ niche: 'desconhecido' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('niche_not_found');
  });

  it('403 para READONLY', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp())
      .post('/api/onboarding/niche')
      .send({ niche: 'real_estate' });
    expect(res.status).toBe(403);
  });
});
