/**
 * Testes do worker de agentes (F2-S11).
 *
 * `@hm/agents-core` é mockado (resolvePolicy/guardResolved/estimateCostUsd) para
 * controlar o caminho de cost-guard sem DB; `@hm/agents-client` é mockado via a
 * porta injetada `client.run` (AsyncGenerator de eventos). O `store`, `socket` e
 * `outbound` são fakes injetados — `runAgent` não toca RabbitMQ nem Postgres.
 *
 * Cobre: cost-guard deny (não chama o runtime, marca failed, emite completed),
 * happy-path (stream → persiste a mensagem do agente + enfileira outbound +
 * completa a execução), e erro do runtime (`AgentRuntimeError` → failed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock de @hm/agents-core (policy + cost-guard) ────────────────────────────

const resolvePolicyMock = vi.fn((..._args: unknown[]): unknown => undefined);
const guardResolvedMock = vi.fn((..._args: unknown[]): unknown => undefined);
const estimateCostUsdMock = vi.fn((..._args: unknown[]): number => 0.001);

vi.mock('@hm/agents-core', () => ({
  resolvePolicy: (...args: unknown[]) => resolvePolicyMock(...args),
  guardResolved: (...args: unknown[]) => guardResolvedMock(...args),
  estimateCostUsd: (...args: unknown[]) => estimateCostUsdMock(...args),
}));

// ─── Mock de @hm/db (RLS) para os testes de DbAgentRunStore.loadContext ───────
//
// `withWorkspace(id, fn)` chama `fn(tx)` com um fake de `tx` controlável. O fake
// de `tx.select()` devolve, em ordem, as linhas empilhadas em `selectQueue`
// (1ª chamada = conversa, 2ª = agente, etc.); `tx.update()` registra os UPDATEs
// em `updateCalls`. `agentDepartmentsRepo.getDefaultAgentForDepartment` é um spy.

interface UpdateCall {
  readonly set: Record<string, unknown>;
}

let selectQueue: unknown[][] = [];
let updateCalls: UpdateCall[] = [];
const getDefaultAgentForDepartmentMock = vi.fn(
  async (..._args: unknown[]): Promise<string | null> => null,
);

function makeTx(): unknown {
  const chain = (rows: unknown[]): unknown => ({
    from: () => chain(rows),
    where: () => chain(rows),
    orderBy: () => chain(rows),
    limit: () => Promise.resolve(rows),
  });
  return {
    select: () => chain(selectQueue.shift() ?? []),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updateCalls.push({ set });
        return { where: () => Promise.resolve() };
      },
    }),
  };
}

vi.mock('@hm/db', () => ({
  withWorkspace: (_id: string, fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
  agentDepartmentsRepo: {
    getDefaultAgentForDepartment: (...args: unknown[]) =>
      getDefaultAgentForDepartmentMock(...args),
  },
  schema: {
    conversations: {
      id: 'id',
      remoteId: 'remote_id',
      channelId: 'channel_id',
      aiMode: 'ai_mode',
      agentId: 'agent_id',
      departmentId: 'department_id',
    },
    agents: { id: 'id', status: 'status' },
    messages: {
      conversationId: 'conversation_id',
      externalId: 'external_id',
      direction: 'direction',
      content: 'content',
      createdAt: 'created_at',
    },
  },
}));

// Import APÓS o mock.
const { runAgent, DbAgentRunStore } = await import('./run');
const { handleAgentEnvelope } = await import('./worker');
const { AgentRuntimeError } = await import('@hm/agents-client');

import type {
  AgentRunContext,
  AgentRunDeps,
  AgentRunStore,
} from './run';
import type { AgentStreamEvent } from '@hm/agents-client';
import type { Envelope } from '@hm/shared/mq';

const WS = '00000000-0000-0000-0000-0000000000aa';
const CONV = '00000000-0000-0000-0000-0000000000c1';
const AGENT = '00000000-0000-0000-0000-0000000000a1';

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

function resolved() {
  return {
    workspaceId: WS,
    policy: { maxMonthlyCostUsd: null, maxTokensPerCall: 8000 },
    monthToDateSpendUsd: 0,
    snapshot: SNAPSHOT,
  };
}

function ctx(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    conversationId: CONV,
    chatId: '5511999',
    channelId: 'ch1',
    aiMode: 'on',
    agentId: AGENT,
    agentStatus: 'active',
    userInput: 'oi',
    history: [],
    ...overrides,
  };
}

/** Gera um AsyncGenerator de eventos a partir de um array. */
async function* gen(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent, void, unknown> {
  for (const ev of events) yield ev;
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function makeDeps(
  store: AgentRunStore,
  run: (...args: unknown[]) => AsyncGenerator<AgentStreamEvent, void, unknown>,
): {
  deps: AgentRunDeps;
  started: ReturnType<typeof vi.fn>;
  completed: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const started = vi.fn(async () => undefined);
  const completed = vi.fn(async () => undefined);
  const enqueue = vi.fn(async () => undefined);
  return {
    started,
    completed,
    enqueue,
    deps: {
      store,
      socket: { emitStarted: started, emitCompleted: completed },
      client: { run, health: vi.fn(), cancel: vi.fn() } as never,
      outbound: { enqueueText: enqueue },
      logger,
    },
  };
}

function makeStore(context: AgentRunContext | null): {
  store: AgentRunStore;
  startExecution: ReturnType<typeof vi.fn>;
  completeExecution: ReturnType<typeof vi.fn>;
  failExecution: ReturnType<typeof vi.fn>;
  persistAgentMessage: ReturnType<typeof vi.fn>;
} {
  const startExecution = vi.fn(async () => 'exec1');
  const completeExecution = vi.fn(async () => undefined);
  const failExecution = vi.fn(async () => undefined);
  const persistAgentMessage = vi.fn(async () => 'msg1');
  return {
    startExecution,
    completeExecution,
    failExecution,
    persistAgentMessage,
    store: {
      loadContext: vi.fn(async () => context),
      startExecution,
      completeExecution,
      failExecution,
      persistAgentMessage,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolvePolicyMock.mockResolvedValue(resolved());
  estimateCostUsdMock.mockReturnValue(0.001);
  selectQueue = [];
  updateCalls = [];
  getDefaultAgentForDepartmentMock.mockResolvedValue(null);
});

describe('runAgent — cost-guard', () => {
  it('bloqueia (não chama o runtime), marca failed e emite completed', async () => {
    guardResolvedMock.mockReturnValue({
      ok: false,
      reason: 'monthly_budget_exceeded',
      message: 'cap atingido',
    });
    const s = makeStore(ctx());
    const runSpy = vi.fn(() => gen([]));
    const { deps, completed } = makeDeps(s.store, runSpy);

    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);

    expect(outcome.status).toBe('budget_denied');
    expect(runSpy).not.toHaveBeenCalled();
    expect(s.failExecution).toHaveBeenCalledOnce();
    expect(s.persistAgentMessage).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledOnce();
  });
});

describe('runAgent — happy path', () => {
  it('consome o stream, persiste a mensagem do agente e enfileira outbound', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0.001 });
    const s = makeStore(ctx());
    const events: AgentStreamEvent[] = [
      { type: 'token', content: 'Olá' },
      { type: 'token', content: ', tudo bem?' },
      {
        type: 'final',
        reply: 'Olá, tudo bem?',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost_usd: 0.002 },
        openrouter_generation_id: 'gen-1',
      },
    ];
    const runSpy = vi.fn(() => gen(events));
    const { deps, started, completed, enqueue } = makeDeps(s.store, runSpy);

    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);

    expect(outcome.status).toBe('replied');
    expect(runSpy).toHaveBeenCalledOnce();
    expect(started).toHaveBeenCalledOnce();
    expect(s.persistAgentMessage).toHaveBeenCalledOnce();
    expect(s.persistAgentMessage.mock.calls[0]?.[0]).toMatchObject({
      conversationId: CONV,
      agentId: AGENT,
      content: 'Olá, tudo bem?',
    });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      conversationId: CONV,
      channelId: 'ch1',
      chatId: '5511999',
      messageId: 'msg1',
      text: 'Olá, tudo bem?',
    });
    expect(s.completeExecution).toHaveBeenCalledOnce();
    expect(s.completeExecution.mock.calls[0]?.[0]).toMatchObject({ totalTokens: 15 });
    expect(completed).toHaveBeenCalledOnce();
  });

  it('pula quando a conversa não tem contexto executável', async () => {
    const s = makeStore(null);
    const runSpy = vi.fn(() => gen([]));
    const { deps } = makeDeps(s.store, runSpy);

    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_context' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('pula quando ai_mode não está on', async () => {
    const s = makeStore(ctx({ aiMode: 'paused' }));
    const { deps } = makeDeps(s.store, vi.fn(() => gen([])));
    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);
    expect(outcome).toEqual({ status: 'skipped', reason: 'ai_off' });
  });
});

describe('runAgent — erro do runtime', () => {
  it('marca failed e emite completed quando o client lança AgentRuntimeError', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0.001 });
    const s = makeStore(ctx());
    const runSpy = vi.fn(() => {
      // Async iterator que lança no 1º `next` (espelha o `error` do runtime,
      // que o client converte em `AgentRuntimeError` ao consumir o stream).
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<AgentStreamEvent>> {
          return Promise.reject(new AgentRuntimeError('runtime boom', { kind: 'runtime' }));
        },
      } as unknown as AsyncGenerator<AgentStreamEvent, void, unknown>;
    });
    const { deps, completed } = makeDeps(s.store, runSpy);

    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);

    expect(outcome.status).toBe('failed');
    expect(s.failExecution).toHaveBeenCalledOnce();
    expect(s.persistAgentMessage).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledOnce();
  });

  it('marca failed quando o runtime emite model_blocked (sem resposta)', async () => {
    guardResolvedMock.mockReturnValue({ ok: true, headroomUsd: null, estimatedCostUsd: 0.001 });
    const s = makeStore(ctx());
    const runSpy = vi.fn(() => gen([{ type: 'model_blocked', reason: 'model not allowed' }]));
    const { deps } = makeDeps(s.store, runSpy);

    const outcome = await runAgent(WS, { conversationId: CONV, contactId: 'c1', channelId: 'ch1', provider: 'waha' }, deps);

    expect(outcome.status).toBe('runtime_blocked');
    expect(s.failExecution).toHaveBeenCalledOnce();
    expect(s.persistAgentMessage).not.toHaveBeenCalled();
  });
});

describe('handleAgentEnvelope — filtro de type + parse', () => {
  function deps(): AgentRunDeps {
    const s = makeStore(ctx());
    return makeDeps(s.store, vi.fn(() => gen([]))).deps;
  }

  it('ignora envelope de outro type sem lançar', async () => {
    const envelope: Envelope = {
      id: '00000000-0000-0000-0000-000000000001',
      type: 'flow.something_else',
      workspaceId: WS,
      ts: Date.now(),
      payload: {},
    };
    await expect(handleAgentEnvelope(envelope, { deps: deps(), logger })).resolves.toBeUndefined();
  });

  it('descarta payload malformado sem lançar (ack)', async () => {
    const envelope: Envelope = {
      id: '00000000-0000-0000-0000-000000000002',
      type: 'flow.run.requested',
      workspaceId: WS,
      ts: Date.now(),
      payload: { conversationId: CONV }, // faltam channelId/contactId/provider
    };
    await expect(handleAgentEnvelope(envelope, { deps: deps(), logger })).resolves.toBeUndefined();
  });
});

// ─── F34-S03: resolução department-aware do agente em DbAgentRunStore ──────────

describe('DbAgentRunStore.loadContext — resolução department-aware (F34-S03)', () => {
  const DEPT = '00000000-0000-0000-0000-0000000000d1';
  const DEPT_AGENT = '00000000-0000-0000-0000-0000000000a2';
  const trigger = {
    conversationId: CONV,
    contactId: 'c1',
    channelId: 'ch1',
    provider: 'waha' as const,
  };

  /** Linhas de conversa + agente + trigger-input + histórico, na ordem dos selects. */
  function queueResolution(conv: Record<string, unknown>, agentId: string | null): void {
    selectQueue = [
      [conv], // 1) conversa
      ...(agentId !== null ? [[{ id: agentId, status: 'active' }]] : []), // 2) agente
      [{ content: 'oi' }], // 3) loadTriggerInput (fallback inbound)
      [], // 4) loadHistory
    ];
  }

  it('(a) conversa com agent_id setado → mantém (sticky, sem tocar departamento)', async () => {
    queueResolution(
      {
        remoteId: '5511999',
        channelId: 'ch1',
        aiMode: 'on',
        agentId: AGENT,
        departmentId: DEPT,
      },
      AGENT,
    );

    const ctxLoaded = await new DbAgentRunStore().loadContext(WS, trigger);

    expect(ctxLoaded?.agentId).toBe(AGENT);
    // agent_id já fixado → não consulta o departamento nem persiste.
    expect(getDefaultAgentForDepartmentMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('(b) sem agent_id mas department_id com default → resolve o default e persiste (sticky)', async () => {
    getDefaultAgentForDepartmentMock.mockResolvedValue(DEPT_AGENT);
    queueResolution(
      {
        remoteId: '5511999',
        channelId: 'ch1',
        aiMode: 'on',
        agentId: null,
        departmentId: DEPT,
      },
      DEPT_AGENT,
    );

    const ctxLoaded = await new DbAgentRunStore().loadContext(WS, trigger);

    expect(ctxLoaded?.agentId).toBe(DEPT_AGENT);
    expect(getDefaultAgentForDepartmentMock).toHaveBeenCalledOnce();
    expect(getDefaultAgentForDepartmentMock.mock.calls[0]?.[1]).toBe(DEPT);
    // Persistência sticky do agente resolvido na conversa.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.set).toEqual({ agentId: DEPT_AGENT });
  });

  it('(c) sem agent_id e sem departamento → fallback atual (null, sem persistir)', async () => {
    selectQueue = [
      [{ remoteId: '5511999', channelId: 'ch1', aiMode: 'on', agentId: null, departmentId: null }],
    ];

    const ctxLoaded = await new DbAgentRunStore().loadContext(WS, trigger);

    expect(ctxLoaded).toBeNull();
    expect(getDefaultAgentForDepartmentMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('(c2) department_id presente mas sem default → fallback atual (null, sem persistir)', async () => {
    getDefaultAgentForDepartmentMock.mockResolvedValue(null);
    selectQueue = [
      [{ remoteId: '5511999', channelId: 'ch1', aiMode: 'on', agentId: null, departmentId: DEPT }],
    ];

    const ctxLoaded = await new DbAgentRunStore().loadContext(WS, trigger);

    expect(ctxLoaded).toBeNull();
    expect(getDefaultAgentForDepartmentMock).toHaveBeenCalledOnce();
    expect(updateCalls).toHaveLength(0);
  });
});
