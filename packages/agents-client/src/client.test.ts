/**
 * Testes do cliente `@hm/agents-client`: validação de contrato Zod no boundary,
 * parsing de SSE → eventos tipados, e mapeamento de falhas para
 * `AgentRuntimeError`. Sem rede — `fetch` é injetado.
 */

import { describe, expect, it, vi } from 'vitest';

import { createAgentsClient, type AgentsClientConfig } from './client';
import { AgentRuntimeError } from './errors';
import {
  AgentRunRequestSchema,
  AgentStreamEventSchema,
  type AgentRunRequest,
  type AgentStreamEvent,
} from './types';

// --- Helpers ---------------------------------------------------------------

const VALID_POLICY: AgentRunRequest['policy_snapshot'] = {
  allowed_models: ['openai/gpt-4o-mini'],
  allow_streaming: true,
  allow_interrupts: false,
  allow_parallel_tools: false,
  allow_vision: false,
  allow_transcription: false,
  max_iterations: 5,
  max_tokens_per_call: 1024,
  max_tools_per_agent: 6,
  allowed_tool_categories: ['database'],
  remaining_monthly_budget_usd: 10,
};

function makeRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    workspace_id: 'ws_1',
    agent_id: 'ag_1',
    conversation_id: 'cv_1',
    user_input: 'oi',
    policy_snapshot: VALID_POLICY,
    ...overrides,
  };
}

/** Constrói um Response com corpo SSE a partir de frames `data:`. */
function sseResponse(events: readonly unknown[], status = 200): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Mock de `fetch` com a assinatura correta (preserva tipos de `mock.calls`). */
function fetchMockOf(impl: typeof fetch) {
  return vi.fn<typeof fetch>(impl);
}

function clientWith(fetchImpl: typeof fetch, extra: Partial<AgentsClientConfig> = {}) {
  return createAgentsClient({
    baseUrl: 'http://agent-runtime:8001/',
    token: 'secret-token',
    fetch: fetchImpl,
    ...extra,
  });
}

async function drain(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// --- Contrato Zod ----------------------------------------------------------

describe('AgentRunRequestSchema', () => {
  it('aplica defaults (messages, tools, is_playground)', () => {
    const parsed = AgentRunRequestSchema.parse(makeRequest());
    expect(parsed.messages).toEqual([]);
    expect(parsed.tools).toEqual([]);
    expect(parsed.is_playground).toBe(false);
  });

  it('rejeita policy com max_iterations <= 0', () => {
    const bad = makeRequest({ policy_snapshot: { ...VALID_POLICY, max_iterations: 0 } });
    expect(AgentRunRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('aceita remaining_monthly_budget_usd = null (sem cap)', () => {
    const r = makeRequest({ policy_snapshot: { ...VALID_POLICY, remaining_monthly_budget_usd: null } });
    expect(AgentRunRequestSchema.safeParse(r).success).toBe(true);
  });
});

describe('AgentStreamEventSchema', () => {
  it('valida o evento final com usage', () => {
    const ev = {
      type: 'final',
      reply: 'pronto',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_cost_usd: 0.0001 },
      openrouter_generation_id: 'gen_123',
    };
    expect(AgentStreamEventSchema.parse(ev).type).toBe('final');
  });

  it('rejeita type desconhecido', () => {
    expect(AgentStreamEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});

// --- run(): streaming ------------------------------------------------------

describe('createAgentsClient.run', () => {
  it('produz eventos tipados a partir do SSE', async () => {
    const events = [
      { type: 'token', content: 'Olá' },
      { type: 'token', content: ' mundo' },
      {
        type: 'final',
        reply: 'Olá mundo',
        usage: { prompt_tokens: 3, completion_tokens: 2, total_cost_usd: 0.00005 },
        openrouter_generation_id: 'gen_abc',
      },
    ];
    const fetchMock = fetchMockOf(async () => sseResponse(events));
    const client = clientWith(fetchMock);

    const received = await drain(client.run(makeRequest()));

    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ type: 'token', content: 'Olá' });
    expect(received[2]?.type).toBe('final');

    // Auth + endpoint corretos.
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('http://agent-runtime:8001/run');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secret-token');
  });

  it('lança contract error em request inválido (sem rede)', async () => {
    const fetchMock = fetchMockOf(async () => new Response(null));
    const client = clientWith(fetchMock);
    const bad = makeRequest({ policy_snapshot: { ...VALID_POLICY, max_iterations: -1 } });

    await expect(drain(client.run(bad))).rejects.toMatchObject({
      name: 'AgentRuntimeError',
      kind: 'contract',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança http error em resposta não-2xx com detail', async () => {
    const fetchMock = fetchMockOf(async () =>
      new Response(JSON.stringify({ detail: 'agent not found' }), { status: 404 }),
    );
    const client = clientWith(fetchMock);

    await expect(drain(client.run(makeRequest()))).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 404,
      retryable: false,
      message: 'agent not found',
    });
  });

  it('marca 5xx como retryable', async () => {
    const fetchMock = fetchMockOf(async () => new Response('boom', { status: 503 }));
    const client = clientWith(fetchMock);
    const err = await drain(client.run(makeRequest())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentRuntimeError);
    expect((err as AgentRuntimeError).retryable).toBe(true);
  });

  it('converte evento error do grafo em throw tipado', async () => {
    const fetchMock = fetchMockOf(async () =>
      sseResponse([
        { type: 'token', content: 'parcial' },
        { type: 'error', message: 'model exploded' },
      ]),
    );
    const client = clientWith(fetchMock);

    const received: AgentStreamEvent[] = [];
    const err = await (async () => {
      try {
        for await (const ev of client.run(makeRequest())) received.push(ev);
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();

    expect(received).toHaveLength(1); // o token veio antes do erro
    expect(err).toBeInstanceOf(AgentRuntimeError);
    expect((err as AgentRuntimeError).kind).toBe('runtime');
    expect((err as AgentRuntimeError).message).toBe('model exploded');
  });

  it('lança contract error em frame SSE com type desconhecido', async () => {
    const fetchMock = fetchMockOf(async () => sseResponse([{ type: 'totally_unknown' }]));
    const client = clientWith(fetchMock);
    await expect(drain(client.run(makeRequest()))).rejects.toMatchObject({ kind: 'contract' });
  });

  it('propaga falha de rede como network error retryable', async () => {
    const fetchMock = fetchMockOf(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = clientWith(fetchMock);
    await expect(drain(client.run(makeRequest()))).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
  });
});

// --- health() --------------------------------------------------------------

describe('createAgentsClient.health', () => {
  it('valida e retorna o corpo de health', async () => {
    const fetchMock = fetchMockOf(async () =>
      new Response(JSON.stringify({ status: 'ok', service: 'agent-runtime' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = clientWith(fetchMock);
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://agent-runtime:8001/health');
  });

  it('lança http error se health falha', async () => {
    const fetchMock = fetchMockOf(async () => new Response('down', { status: 500 }));
    const client = clientWith(fetchMock);
    await expect(client.health()).rejects.toMatchObject({ kind: 'http', httpStatus: 500 });
  });
});

// --- cancel() --------------------------------------------------------------

describe('createAgentsClient.cancel', () => {
  it('POSTa no endpoint de cancel com o executionId', async () => {
    const fetchMock = fetchMockOf(async () => new Response(null, { status: 204 }));
    const client = clientWith(fetchMock);
    await client.cancel('exec 1/x');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://agent-runtime:8001/run/exec%201%2Fx/cancel');
  });

  it('trata 404 como idempotente (não lança)', async () => {
    const fetchMock = fetchMockOf(async () => new Response('gone', { status: 404 }));
    const client = clientWith(fetchMock);
    await expect(client.cancel('exec_1')).resolves.toBeUndefined();
  });

  it('rejeita executionId vazio sem chamar a rede', async () => {
    const fetchMock = fetchMockOf(async () => new Response(null));
    const client = clientWith(fetchMock);
    await expect(client.cancel('')).rejects.toMatchObject({ kind: 'contract' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
