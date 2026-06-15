import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  cancelFlowExecution,
  processFlowStepScoped,
  resumeFlowWithResponse,
  triggerFlow,
} from './dispatcher';
import type {
  ExecutionPatch,
  FlowDbPort,
  FlowEngineDeps,
  FlowLogEntry,
  LoadedExecution,
} from './deps';
import type { FlowHandlerResult, RegisteredFlowHandler } from './types';

const WS = '11111111-1111-1111-1111-111111111111';
const EX = '22222222-2222-2222-2222-222222222222';

function makeExec(over: Partial<LoadedExecution> = {}): LoadedExecution {
  return {
    executionId: EX,
    workspaceId: WS,
    flowId: 'f1',
    flowVersionId: 'v1',
    conversationId: 'c1',
    contactId: 'ct1',
    status: 'running',
    currentNodeId: 'n_trigger',
    variables: {},
    nodes: [
      { id: 'n_trigger', type: 'trigger', data: {} },
      { id: 'n_msg', type: 'message', data: {} },
    ],
    edges: [{ id: 'e1', source: 'n_trigger', target: 'n_msg' }],
    ...over,
  };
}

function makeDeps(exec: LoadedExecution, opts: { result?: FlowHandlerResult } = {}) {
  const patches: { id: string; patch: ExecutionPatch }[] = [];
  const logs: FlowLogEntry[] = [];
  const enqueued: { workspaceId: string; executionId: string }[] = [];
  let current = exec;

  const db: FlowDbPort = {
    createExecution: vi.fn(async () => ({ executionId: EX })),
    loadExecution: vi.fn(async () => current),
    loadExecutionByIdOnly: vi.fn(async () => current),
    patchExecution: vi.fn(async (_ws, id, patch) => {
      patches.push({ id, patch });
      current = { ...current, ...patch } as LoadedExecution;
    }),
    insertLog: vi.fn(async (entry) => {
      logs.push(entry);
    }),
    findActiveByConversation: vi.fn(async () => [current]),
  };

  const deps: FlowEngineDeps = {
    db,
    queue: { enqueueStep: vi.fn(async (i) => void enqueued.push(i)) },
    outbound: {
      sendMessage: vi.fn(async () => {}),
      sendPresence: vi.fn(async () => {}),
      setConversationAi: vi.fn(async () => {}),
      setConversationStatus: vi.fn(async () => {}),
    },
    http: { request: vi.fn(async () => ({ status: 200, ok: true, body: null, headers: {} })) },
    logger: { log: vi.fn() },
    now: () => new Date('2026-06-10T00:00:00.000Z'),
  };

  const result = opts.result ?? { status: 'SUCCESS' as const };
  const handler: RegisteredFlowHandler = {
    schema: z.record(z.unknown()),
    execute: vi.fn(async () => result),
  };
  deps.resolveHandler = () => handler;

  return { deps, patches, logs, enqueued, handler };
}

describe('processFlowStep (algoritmo secao 3.2)', () => {
  it('SUCCESS avanca para a proxima edge e re-enfileira', async () => {
    const { deps, patches, enqueued } = makeDeps(makeExec());
    await processFlowStepScoped(deps, WS, EX);
    const last = patches.at(-1);
    expect(last?.patch.status).toBe('running');
    expect(last?.patch.currentNodeId).toBe('n_msg');
    expect(enqueued).toEqual([{ workspaceId: WS, executionId: EX }]);
  });

  it('completa quando nao ha proxima edge', async () => {
    const exec = makeExec({ currentNodeId: 'n_msg' });
    const { deps, patches, enqueued } = makeDeps(exec);
    await processFlowStepScoped(deps, WS, EX);
    const last = patches.at(-1);
    expect(last?.patch.status).toBe('completed');
    expect(last?.patch.completedAt).toBeInstanceOf(Date);
    expect(enqueued).toHaveLength(0);
  });

  it('WAITING persiste next_step_at e nao re-enfileira', async () => {
    const next = '2026-06-10T00:05:00.000Z';
    const { deps, patches, enqueued } = makeDeps(makeExec(), {
      result: { status: 'WAITING', nextStepAt: next },
    });
    await processFlowStepScoped(deps, WS, EX);
    const last = patches.at(-1);
    expect(last?.patch.status).toBe('waiting');
    expect(last?.patch.nextStepAt).toEqual(new Date(next));
    expect(enqueued).toHaveLength(0);
  });

  it('ERROR sem fallback falha a execucao', async () => {
    const { deps, patches } = makeDeps(makeExec(), {
      result: { status: 'ERROR', error: 'boom' },
    });
    await processFlowStepScoped(deps, WS, EX);
    const last = patches.at(-1);
    expect(last?.patch.status).toBe('failed');
    expect(last?.patch.lastError).toBe('boom');
  });

  it('guard: execucao nao-running/waiting e no-op', async () => {
    const { deps, patches } = makeDeps(makeExec({ status: 'completed' }));
    await processFlowStepScoped(deps, WS, EX);
    expect(patches).toHaveLength(0);
  });

  it('edgeHandle seleciona a edge correta (true/false)', async () => {
    const exec = makeExec({
      currentNodeId: 'n_cond',
      nodes: [
        { id: 'n_cond', type: 'condition', data: {} },
        { id: 'n_yes', type: 'message', data: {} },
        { id: 'n_no', type: 'message', data: {} },
      ],
      edges: [
        { id: 'e_t', source: 'n_cond', target: 'n_yes', sourceHandle: 'true' },
        { id: 'e_f', source: 'n_cond', target: 'n_no', sourceHandle: 'false' },
      ],
    });
    const { deps, patches } = makeDeps(exec, {
      result: { status: 'SUCCESS', edgeHandle: 'false' },
    });
    await processFlowStepScoped(deps, WS, EX);
    expect(patches.at(-1)?.patch.currentNodeId).toBe('n_no');
  });
});

describe('triggerFlow', () => {
  it('cria execucao e enfileira o primeiro step', async () => {
    const { deps, enqueued } = makeDeps(makeExec());
    const out = await triggerFlow(deps, {
      workspaceId: WS,
      flowId: 'f1',
      triggeredBy: 'manual',
      triggerData: { foo: 'bar' },
    });
    expect(out.executionId).toBe(EX);
    expect(deps.db.createExecution).toHaveBeenCalledOnce();
    expect(enqueued).toEqual([{ workspaceId: WS, executionId: EX }]);
  });
});

describe('resumeFlowWithResponse', () => {
  it('marca responded e re-enfileira execucoes em waiting', async () => {
    const exec = makeExec({ status: 'waiting', variables: { waiting_for_response: true } });
    const { deps, patches, enqueued } = makeDeps(exec);
    await resumeFlowWithResponse(deps, {
      conversationId: 'c1',
      responseType: 'response',
      responseContent: 'oi',
    });
    const last = patches.at(-1);
    expect(last?.patch.status).toBe('running');
    expect(last?.patch.variables?.['responded']).toBe(true);
    expect(last?.patch.variables?.['last_response']).toBe('oi');
    expect(enqueued).toHaveLength(1);
  });
});

describe('cancelFlowExecution', () => {
  it('cancela execucao viva', async () => {
    const { deps, patches } = makeDeps(makeExec());
    await cancelFlowExecution(deps, WS, EX, 'user');
    expect(patches.at(-1)?.patch.status).toBe('cancelled');
  });

  it('no-op em execucao terminal', async () => {
    const { deps, patches } = makeDeps(makeExec({ status: 'completed' }));
    await cancelFlowExecution(deps, WS, EX);
    expect(patches).toHaveLength(0);
  });
});

describe('go_to_flow enqueue (F33-S01)', () => {
  const CHILD_EX = '33333333-3333-3333-3333-333333333333';

  it('enfileira o step do flow filho quando handler retorna _goto_flow_execution_id', async () => {
    const exec = makeExec();
    // O handler go_to_flow retorna SUCCESS com os marcadores nas variables.
    const { deps, enqueued, patches } = makeDeps(exec, {
      result: {
        status: 'SUCCESS' as const,
        variables: {
          _goto_flow_execution_id: CHILD_EX,
          _goto_flow_initiated: true,
        },
      },
    });
    await processFlowStepScoped(deps, WS, EX);

    // Deve ter enfileirado 2 vezes: o proximo step do flow pai + o primeiro step do filho.
    expect(enqueued).toHaveLength(2);
    expect(enqueued).toContainEqual({ workspaceId: WS, executionId: CHILD_EX });

    // As vars persistidas NAO devem conter as flags internas.
    const patch = patches.find((p) => p.patch.variables !== undefined);
    expect(patch?.patch.variables).not.toHaveProperty('_goto_flow_execution_id');
    expect(patch?.patch.variables).not.toHaveProperty('_goto_flow_initiated');
  });

  it('nao enfileira flow filho quando handler nao retorna _goto_flow_execution_id (flowId ausente)', async () => {
    const exec = makeExec();
    // go_to_flow sem flowId retorna SUCCESS simples (no-op).
    const { deps, enqueued } = makeDeps(exec, {
      result: { status: 'SUCCESS' as const },
    });
    await processFlowStepScoped(deps, WS, EX);

    // Apenas o step do flow pai e enfileirado (avanco normal).
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({ workspaceId: WS, executionId: EX });
  });
});
