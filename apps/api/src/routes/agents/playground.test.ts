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
// Captura a string de permissão que a rota exige (asserção de autorização real).
const requireRoleSpy = vi.fn((..._args: unknown[]): void => undefined);

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
  requireRole: (...args: unknown[]) => {
    requireRoleSpy(...args);
    return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  },
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

// ─── Cobertura adicional (QA F2-S19) ────────────────────────────────────────────
//
// Casos que faltavam no suite original: validação de entrada (faltante/limite),
// proxy do snapshot/history para o runtime, propagação de eventos intermediários
// não-`final` (model_blocked/iteration_exceeded), e o caminho de erro genérico
// (não-AgentRuntimeError → ref sintético `hm-agent-internal-`).

describe('POST /api/agents/:id/playground — validação de entrada', () => {
  it('body sem user_input (campo ausente) → 400, sem tocar policy/runtime', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ history: [] });
    expect(res.status).toBe(400);
    expect(resolvePolicyMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('user_input só com whitespace (trim → vazio) → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: '    \n\t  ' });
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('user_input acima de 20000 chars → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'x'.repeat(20001) });
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('history com role inválido (não é ChatMessage) → 400', async () => {
    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi', history: [{ role: 'banana', content: 'x' }] });
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/agents/:id/playground — proxy do request ao runtime', () => {
  beforeEach(() => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0 });
  });

  it('encaminha policy_snapshot e history (turnos prévios) ao runtime', async () => {
    runMock.mockReturnValue(
      gen([{ type: 'final', reply: 'ok', usage: { prompt_tokens: 1, completion_tokens: 1, total_cost_usd: 0 }, openrouter_generation_id: null }]),
    );
    const history = [
      { role: 'user', content: 'antes' },
      { role: 'assistant', content: 'depois' },
    ];

    await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi', history });

    expect(runMock).toHaveBeenCalledTimes(1);
    const [runReq] = runMock.mock.calls[0] as [
      { policy_snapshot: unknown; messages: unknown[]; metadata: { playground?: boolean }; agent_id: string },
    ];
    expect(runReq.policy_snapshot).toEqual(SNAPSHOT);
    expect(runReq.messages).toEqual(history);
    expect(runReq.metadata).toEqual({ playground: true });
    expect(runReq.agent_id).toBe(AGENT);
  });

  it('passa o AbortSignal do request ao client.run (lifecycle de desconexão)', async () => {
    runMock.mockReturnValue(
      gen([{ type: 'final', reply: 'ok', usage: { prompt_tokens: 0, completion_tokens: 0, total_cost_usd: 0 }, openrouter_generation_id: null }]),
    );

    await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    const opts = runMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('POST /api/agents/:id/playground — proxy de eventos intermediários', () => {
  beforeEach(() => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0 });
  });

  it('proxia tool_call_started + tool_call_completed antes do final', async () => {
    const final = { type: 'final', reply: 'pronto', usage: { prompt_tokens: 1, completion_tokens: 1, total_cost_usd: 0 }, openrouter_generation_id: null };
    runMock.mockReturnValue(
      gen([
        { type: 'tool_call_started', tool_key: 'db.query', args: {} },
        { type: 'tool_call_completed', tool_key: 'db.query', result: {}, duration_ms: 12 },
        final,
      ]),
    );

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    const frames = parseFrames(res.text) as Array<{ type: string }>;
    expect(frames.map((f) => f.type)).toEqual(['tool_call_started', 'tool_call_completed', 'final']);
  });

  it('proxia model_blocked como frame terminal (stream do runtime encerra sem final)', async () => {
    runMock.mockReturnValue(gen([{ type: 'model_blocked', reason: 'modelo fora da whitelist' }]));

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    expect(res.status).toBe(200);
    const frames = parseFrames(res.text) as Array<{ type: string; reason?: string }>;
    expect(frames).toEqual([{ type: 'model_blocked', reason: 'modelo fora da whitelist' }]);
  });

  it('proxia iteration_exceeded como frame terminal', async () => {
    runMock.mockReturnValue(gen([{ type: 'iteration_exceeded' }]));

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    const frames = parseFrames(res.text);
    expect(frames).toEqual([{ type: 'iteration_exceeded' }]);
  });

  it('para de proxiar após o final (eventos pós-final são ignorados)', async () => {
    const final = { type: 'final', reply: 'fim', usage: { prompt_tokens: 0, completion_tokens: 0, total_cost_usd: 0 }, openrouter_generation_id: null };
    runMock.mockReturnValue(
      gen([{ type: 'token', content: 'a' }, final, { type: 'token', content: 'NAO_DEVE_VAZAR' }]),
    );

    const res = await request(makeApp())
      .post(`/api/agents/${AGENT}/playground`)
      .set('x-test-auth', '1')
      .send({ user_input: 'oi' });

    expect(res.text).not.toContain('NAO_DEVE_VAZAR');
    const frames = parseFrames(res.text) as Array<{ type: string }>;
    expect(frames[frames.length - 1]?.type).toBe('final');
  });
});

describe('POST /api/agents/:id/playground — erro genérico (não-AgentRuntimeError)', () => {
  it('falha não-tipada no stream → frame error com ref sintético hm-agent-internal-', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0 });
    runMock.mockReturnValue(
      (async function* () {
        if (Math.random() >= 0) throw new TypeError('kaboom interno');
        yield { type: 'token', content: '' };
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
    // Não vaza a mensagem crua do erro interno ao cliente.
    expect(frames[0]?.message).not.toContain('kaboom interno');
    expect(frames[0]?.message).toMatch(/ref hm-agent-internal-/);
  });
});

// Autorização: a rota executa o modelo e gasta budget, então DEVE exigir
// `agent.playground` (= STAFF, exclui READONLY) — não `agent.list` (= ALL).
describe('POST /api/agents/:id/playground — autorização', () => {
  it('exige a permissão dedicada `agent.playground` (não `agent.list`)', () => {
    // O router registra o guard no construtor — basta criá-lo.
    createAgentPlaygroundRouter();
    expect(requireRoleSpy).toHaveBeenCalledWith('agent.playground');
    expect(requireRoleSpy).not.toHaveBeenCalledWith('agent.list');
  });
});
