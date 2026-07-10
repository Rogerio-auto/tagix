import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  cancelFlowExecution,
  FLOW_MAX_STEPS,
  FlowStepInFlightError,
  processFlowStepScoped,
  resumeFlowWithResponse,
  triggerFlow,
} from './dispatcher';
import type {
  ExecutionPatch,
  FlowClaimResult,
  FlowDbPort,
  FlowEngineDeps,
  FlowExecutionEvent,
  FlowExecutionStatus,
  FlowLogEntry,
  LoadedExecution,
} from './deps';
import type { FlowHandlerResult, RegisteredFlowHandler } from './types';

const WS = '11111111-1111-1111-1111-111111111111';
const EX = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-06-10T00:00:00.000Z');

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
    stepCount: 0,
    variables: {},
    nodes: [
      { id: 'n_trigger', type: 'trigger', data: {} },
      { id: 'n_msg', type: 'message', data: {} },
    ],
    edges: [{ id: 'e1', source: 'n_trigger', target: 'n_msg' }],
    ...over,
  };
}

/** Estado da "linha" no fake — espelha a semantica do claim SQL real (db.port). */
interface FakeRow {
  status: FlowExecutionStatus;
  nextStepAt: Date | null;
  stepCount: number;
  /** simula lease de `processing` expirado (takeover permitido). */
  staleLease: boolean;
}

interface MakeDepsOpts {
  result?: FlowHandlerResult;
  /** execute custom (permite mutar a linha no meio do step, ex.: cancel concorrente). */
  execute?: () => Promise<FlowHandlerResult> | FlowHandlerResult;
  /** next_step_at inicial da linha (waiting vencida vs prematura). */
  nextStepAt?: Date | null;
}

function makeDeps(exec: LoadedExecution, opts: MakeDepsOpts = {}) {
  const patches: { id: string; patch: ExecutionPatch }[] = [];
  const logs: FlowLogEntry[] = [];
  const enqueued: { workspaceId: string; executionId: string }[] = [];
  const events: FlowExecutionEvent[] = [];
  let current = exec;
  const row: FakeRow = {
    status: exec.status,
    nextStepAt: opts.nextStepAt ?? null,
    stepCount: exec.stepCount,
    staleLease: false,
  };

  // Espelha o UPDATE condicional atomico do db.port real (INF-04).
  const doClaim = async (): Promise<FlowClaimResult> => {
    const claimable =
      row.status === 'running' ||
      (row.status === 'waiting' &&
        (row.nextStepAt === null || row.nextStepAt.getTime() <= NOW.getTime())) ||
      (row.status === 'processing' && row.staleLease);
    if (!claimable) {
      if (row.status === 'processing') return { claimed: false, reason: 'in_flight' };
      if (row.status === 'waiting') return { claimed: false, reason: 'not_due' };
      return { claimed: false, reason: 'terminal' };
    }
    row.status = 'processing';
    row.staleLease = false;
    row.stepCount += 1;
    current = { ...current, status: 'processing', stepCount: row.stepCount };
    return { claimed: true, execution: current };
  };

  const db: FlowDbPort = {
    createExecution: vi.fn(async () => ({ executionId: EX })),
    loadExecution: vi.fn(async () => current),
    loadExecutionByIdOnly: vi.fn(async () => current),
    claimExecution: vi.fn(doClaim),
    claimExecutionByIdOnly: vi.fn(doClaim),
    patchExecution: vi.fn(async (_ws, id, patch, options) => {
      // Fencing: compare-and-set contra o status ATUAL da linha (como no UPDATE real).
      if (options?.expectStatus !== undefined && !options.expectStatus.includes(row.status)) {
        return false;
      }
      patches.push({ id, patch });
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.nextStepAt !== undefined) row.nextStepAt = patch.nextStepAt;
      current = { ...current, ...patch } as LoadedExecution;
      return true;
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
    events: { executionChanged: vi.fn((e: FlowExecutionEvent) => void events.push(e)) },
    now: () => NOW,
  };

  const result = opts.result ?? { status: 'SUCCESS' as const };
  const customExecute = opts.execute;
  const handler: RegisteredFlowHandler = {
    schema: z.record(z.unknown()),
    execute: vi.fn(async () => (customExecute ? customExecute() : result)),
  };
  deps.resolveHandler = () => handler;

  return { deps, patches, logs, enqueued, events, handler, row };
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

describe('eventos de execução (F51-S02)', () => {
  it('triggerFlow emite running uma vez', async () => {
    const { deps, events } = makeDeps(makeExec());
    await triggerFlow(deps, { workspaceId: WS, flowId: 'f1', conversationId: 'c1', triggeredBy: 'manual' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'running', flowId: 'f1', conversationId: 'c1', nextStepAt: null });
  });

  it('WAITING emite waiting com nextStepAt', async () => {
    const next = '2026-06-10T00:05:00.000Z';
    const { deps, events } = makeDeps(makeExec(), { result: { status: 'WAITING', nextStepAt: next } });
    await processFlowStepScoped(deps, WS, EX);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'waiting' });
    expect(events[0]?.nextStepAt).toEqual(new Date(next));
  });

  it('advance running→running NÃO emite (anti-ruído)', async () => {
    // n_trigger → n_msg: avança para o próximo node, segue running. Nenhum evento.
    const { deps, events } = makeDeps(makeExec());
    await processFlowStepScoped(deps, WS, EX);
    expect(events).toHaveLength(0);
  });

  it('completa (sem próxima edge) emite completed', async () => {
    const { deps, events } = makeDeps(makeExec({ currentNodeId: 'n_msg' }));
    await processFlowStepScoped(deps, WS, EX);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'completed', nextStepAt: null });
  });

  it('ERROR sem fallback emite failed', async () => {
    const { deps, events } = makeDeps(makeExec(), { result: { status: 'ERROR', error: 'boom' } });
    await processFlowStepScoped(deps, WS, EX);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'failed' });
  });

  it('cancel de execução viva emite cancelled; terminal não emite', async () => {
    const live = makeDeps(makeExec());
    await cancelFlowExecution(live.deps, WS, EX, 'user');
    expect(live.events).toEqual([expect.objectContaining({ status: 'cancelled' })]);

    const terminal = makeDeps(makeExec({ status: 'completed' }));
    await cancelFlowExecution(terminal.deps, WS, EX);
    expect(terminal.events).toHaveLength(0);
  });

  it('engine sem events port não lança', async () => {
    const { deps } = makeDeps(makeExec());
    const noEvents: FlowEngineDeps = { ...deps, events: undefined };
    await expect(processFlowStepScoped(noEvents, WS, EX)).resolves.toBeUndefined();
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

describe('claim atomico (F56-S13 / INF-04)', () => {
  it('dois envelopes concorrentes do mesmo executionId produzem UMA execucao', async () => {
    const { deps, handler, enqueued } = makeDeps(makeExec());
    const [a, b] = await Promise.allSettled([
      processFlowStepScoped(deps, WS, EX),
      processFlowStepScoped(deps, WS, EX),
    ]);

    // Exatamente um processa; o outro perde o claim e lanca (retry ladder decide depois).
    const outcomes = [a, b].map((r) => r.status).sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const rejected = [a, b].find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(FlowStepInFlightError);

    // O handler executou UMA vez e so UM proximo step foi enfileirado (sem mensagem dupla).
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(enqueued).toEqual([{ workspaceId: WS, executionId: EX }]);
  });

  it('envelope sobre execucao em voo (processing, lease vivo) lanca FlowStepInFlightError', async () => {
    const { deps, handler } = makeDeps(makeExec({ status: 'processing' }));
    await expect(processFlowStepScoped(deps, WS, EX)).rejects.toBeInstanceOf(
      FlowStepInFlightError,
    );
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it('takeover: processing com lease expirado e reivindicavel (recuperacao pos-crash)', async () => {
    const { deps, handler, row, patches } = makeDeps(makeExec({ status: 'processing' }));
    row.staleLease = true;
    await processFlowStepScoped(deps, WS, EX);
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(patches.at(-1)?.patch.status).toBe('running');
  });

  it('waiting ANTES do prazo nao e reivindicavel (wakeup prematuro absorvido, sem timeout antecipado)', async () => {
    const future = new Date(NOW.getTime() + 60_000);
    const { deps, handler, patches, enqueued } = makeDeps(makeExec({ status: 'waiting' }), {
      nextStepAt: future,
    });
    await processFlowStepScoped(deps, WS, EX);
    expect(handler.execute).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('waiting com prazo vencido e reivindicada (wakeup legitimo do scheduler)', async () => {
    const past = new Date(NOW.getTime() - 1_000);
    const { deps, handler } = makeDeps(makeExec({ status: 'waiting' }), { nextStepAt: past });
    await processFlowStepScoped(deps, WS, EX);
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it('cancel durante o step vence: patch final fenced e recusado e NADA e re-enfileirado', async () => {
    // O handler simula um cancelFlowExecution concorrente aterrissando no meio do step.
    const made = makeDeps(makeExec(), {
      execute: () => {
        made.row.status = 'cancelled';
        return { status: 'SUCCESS' as const };
      },
    });
    await processFlowStepScoped(made.deps, WS, EX);
    // A transicao final do step foi descartada (linha ja nao era `processing`)…
    expect(made.patches).toHaveLength(0);
    expect(made.row.status).toBe('cancelled');
    // …e a execucao cancelada NAO foi ressuscitada na fila.
    expect(made.enqueued).toHaveLength(0);
  });

  it('resume e fenced em waiting: nao sobrescreve um step em voo (processing)', async () => {
    const exec = makeExec({ status: 'waiting', variables: { waiting_for_response: true } });
    const made = makeDeps(exec);
    made.row.status = 'processing'; // timeout do wait em voo neste exato momento
    await resumeFlowWithResponse(made.deps, {
      conversationId: 'c1',
      responseType: 'response',
      responseContent: 'oi',
    });
    expect(made.patches).toHaveLength(0);
    expect(made.enqueued).toHaveLength(0);
  });

  it('envelope duplicado tardio sobre execucao terminal e absorvido (drop, sem throw)', async () => {
    const { deps, handler, patches } = makeDeps(makeExec({ status: 'completed' }));
    await expect(processFlowStepScoped(deps, WS, EX)).resolves.toBeUndefined();
    expect(handler.execute).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
  });
});

describe('anti-loop step_count (F56-S13 / INF-05)', () => {
  it('execucao acima do teto falha como "loop suspeito" sem executar o node', async () => {
    const made = makeDeps(makeExec());
    made.row.stepCount = FLOW_MAX_STEPS; // o claim incrementa para FLOW_MAX_STEPS + 1
    await processFlowStepScoped(made.deps, WS, EX);

    expect(made.handler.execute).not.toHaveBeenCalled();
    const last = made.patches.at(-1);
    expect(last?.patch.status).toBe('failed');
    expect(last?.patch.lastError).toContain('loop suspeito');
    expect(made.logs.at(-1)?.level).toBe('error');
    expect(made.enqueued).toHaveLength(0);
    expect(made.events).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('flow ciclico (a→b→a) drena a fila e falha em <= teto de steps (sem flood)', async () => {
    const exec = makeExec({
      currentNodeId: 'n_a',
      nodes: [
        { id: 'n_a', type: 'message', data: {} },
        { id: 'n_b', type: 'message', data: {} },
      ],
      edges: [
        { id: 'e_ab', source: 'n_a', target: 'n_b' },
        { id: 'e_ba', source: 'n_b', target: 'n_a' },
      ],
    });
    const { deps, enqueued, row, handler } = makeDeps(exec);

    // Drena a fila em FIFO como o worker faria; o teto tem que parar o ciclo sozinho.
    await processFlowStepScoped(deps, WS, EX);
    let cursor = 0;
    let processed = 1;
    const hardStop = FLOW_MAX_STEPS * 2; // paraquedas do teste — nunca deve ser atingido
    while (cursor < enqueued.length && processed < hardStop) {
      cursor += 1;
      processed += 1;
      await processFlowStepScoped(deps, WS, EX);
    }

    expect(row.status).toBe('failed');
    // Cada step enfileira no maximo 1 proximo: falhar no teto drena a fila (sem flood).
    expect(processed).toBeLessThanOrEqual(FLOW_MAX_STEPS + 1);
    expect(handler.execute).toHaveBeenCalledTimes(FLOW_MAX_STEPS);
    expect(cursor).toBe(enqueued.length); // fila totalmente drenada
  });
});
