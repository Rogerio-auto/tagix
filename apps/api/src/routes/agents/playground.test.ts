/**
 * Testes do Playground SSE (F2-S19).
 *
 * Foco: o contrato do endpoint sem subir runtime/DB reais.
 *  - Sem sessão → 401 (guard de auth real barra antes de tocar qualquer infra).
 *  - Cost-guard deny → frame SSE `budget_exceeded` + headers de event-stream,
 *    SEM chamar o runtime.
 *  - Happy-path → proxy dos frames `token` + `final` do runtime para o browser.
 *
 * `@hm/db`, `@hm/agents-core` e `@hm/agents-client` são mockados; os middlewares
 * de auth são stubados para injetar `req.auth`/`req.scoped` (o teste de 401 usa
 * o stub que rejeita sem cabeçalho). Espelha o estilo de mock do worker
 * (`apps/workers/src/agents/agents.test.ts`).
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as AgentsClientModule from '@hm/agents-client';

// ─── Mocks de infra ───────────────────────────────────────────────────────────

const resolvePolicyMock = vi.fn((..._args: unknown[]): unknown => undefined);
const guardResolvedMock = vi.fn((..._args: unknown[]): unknown => undefined);
const estimateCostUsdMock = vi.fn((..._args: unknown[]): number => 0);

vi.mock('@hm/agents-core', () => ({
  resolvePolicy: (...args: unknown[]) => resolvePolicyMock(...args),
  guardResolved: (...args: unknown[]) => guardResolvedMock(...args),
  estimateCostUsd: (...args: unknown[]) => estimateCostUsdMock(...args),
}));

const runMock = vi.fn();

vi.mock('@hm/agents-client', async (importActual) => {
  const actual = await importActual<typeof AgentsClientModule>();
  return {
    ...actual,
    createAgentsClient: () => ({ run: runMock, health: vi.fn(), cancel: vi.fn() }),
  };
});

// `@hm/db` só precisa do `schema.agents` (usado nas queries do router); a query em
// si roda dentro do `req.scoped` stubado, que devolve a linha do agente.
vi.mock('@hm/db', () => ({
  schema: { agents: { id: 'id', status: 'status' } },
}));

// Middlewares de auth: stub que injeta auth/scoped quando há `x-test-auth`.
const WS = '00000000-0000-0000-0000-0000000000aa';
const AGENT = '00000000-0000-0000-0000-0000000000a1';
let agentRow: { id: string; status: string } | null = { id: AGENT, status: 'active' };

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-test-auth'] !== '1') {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    (req as { auth?: unknown }).auth = { workspace: { id: WS }, member: { role: 'owner' } };
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as { scoped?: unknown }).scoped = async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => (agentRow ? [agentRow] : []) }),
          }),
        }),
      });
    next();
  },
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const { createAgentPlaygroundRouter } = await import('./playground');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createAgentPlaygroundRouter());
  return app;
}

/** Gerador assíncrono a partir de uma lista de eventos. */
async function* gen(events: unknown[]): AsyncGenerator<unknown> {
  for (const ev of events) yield ev;
}

const SNAPSHOT = {
  allowed_models: ['openai/gpt-4o-mini'],
  allow_streaming: true,
  allow_interrupts: false,
  allow_parallel_tools: true,
  allow_vision: false,
  allow_transcription: false,
  max_iterations: 5,
  max_tokens_per_call: 8000,
  max_tools_per_agent: 20,
  allowed_tool_categories: ['database'],
  remaining_monthly_budget_usd: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  agentRow = { id: AGENT, status: 'active' };
  estimateCostUsdMock.mockReturnValue(0);
  resolvePolicyMock.mockResolvedValue({
    workspaceId: WS,
    policy: { maxTokensPerCall: 8000, maxMonthlyCostUsd: null },
    monthToDateSpendUsd: 0,
    snapshot: SNAPSHOT,
  });
  process.env['AGENT_RUNTIME_URL'] = 'http://runtime.test';
  process.env['AGENT_RUNTIME_TOKEN'] = 'test-token';
});

/** Parseia o corpo SSE bruto em eventos JSON. */
function parseFrames(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((f) => f.trim())
    .filter((f) => f.startsWith('data:'))
    .map((f) => JSON.parse(f.slice(5).trim()));
}

describe('POST /api/agents/:id/playground', () => {
  it('sem sessão → 401', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .send({ user_input: 'oi' });
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('agente inexistente → 404', async () => {
    agentRow = null;
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });
    expect(res.status).toBe(404);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('body inválido (user_input vazio) → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: '' });
    expect(res.status).toBe(400);
  });

  it('cost-guard deny → SSE budget_exceeded com headers de event-stream, sem chamar o runtime', async () => {
    guardResolvedMock.mockReturnValue({
      ok: false,
      reason: 'monthly_budget_exceeded',
      capUsd: 10,
      spentUsd: 10,
      headroomUsd: 0,
      estimatedCostUsd: 0.5,
      message: 'cap atingido',
    });

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(parseFrames(res.text)).toEqual([{ type: 'budget_exceeded' }]);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('happy-path → proxia frames token + final do runtime', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0 });
    const finalEv = {
      type: 'final',
      reply: 'Olá!',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_cost_usd: 0.0001 },
      openrouter_generation_id: 'gen-1',
    };
    runMock.mockReturnValue(gen([{ type: 'token', content: 'Olá' }, { type: 'token', content: '!' }, finalEv]));

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = parseFrames(res.text);
    expect(frames).toContainEqual({ type: 'token', content: 'Olá' });
    expect(frames).toContainEqual(finalEv);

    // O request ao runtime é de playground (sem conversa/contato reais).
    expect(runMock).toHaveBeenCalledTimes(1);
    const [runReq] = runMock.mock.calls[0] as [{ is_playground: boolean; conversation_id: null; contact_id: null; workspace_id: string }];
    expect(runReq.is_playground).toBe(true);
    expect(runReq.conversation_id).toBeNull();
    expect(runReq.contact_id).toBeNull();
    expect(runReq.workspace_id).toBe(WS);
  });

  it('AgentRuntimeError no stream → frame SSE error com ref (nunca lança cru)', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0 });
    const { AgentRuntimeError } = await import('@hm/agents-client');
    runMock.mockReturnValue(
      (async function* () {
        if (Math.random() >= 0) throw AgentRuntimeError.runtime('boom');
        yield { type: 'token', content: '' }; // inalcançável; satisfaz require-yield.
      })(),
    );

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    expect(res.status).toBe(200);
    const frames = parseFrames(res.text) as Array<{ type: string; message?: string }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('error');
    expect(frames[0]?.message).toMatch(/ref hm-agent-runtime-/);
  });
});
