/**
 * Testes do roll-up de `agent_metrics` (F2-S13).
 *
 * `@hm/db` é mockado: `getDb().execute` serve a descoberta cross-tenant de
 * workspaces e as duas agregações (`llm_usage_logs` / `agent_executions`);
 * `withWorkspace` apenas executa o callback com um `tx` fake cujo
 * `insert().onConflictDoUpdate()` registra os valores upserted. Sem Postgres real.
 *
 * Cobre: merge das duas fontes por (agent, bucket), substituição idempotente
 * (re-run grava os mesmos números, nunca soma), seleção de período e tolerância
 * a falha por-workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

interface UpsertCapture {
  workspaceId: string;
  period: string;
  values: Record<string, unknown>;
}

const captured: UpsertCapture[] = [];

/** Fila de respostas para `execute`, consumida em ordem de chamada. */
let executeQueue: unknown[][] = [];
const executeMock = vi.fn(async () => {
  const next = executeQueue.shift();
  return next ?? [];
});

/** `tx` fake: só o caminho insert→onConflictDoUpdate + execute (agregações). */
function makeTx(workspaceId: string) {
  return {
    execute: executeMock,
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (_args: unknown) => {
          captured.push({ workspaceId, period: String(values['period']), values });
          return Promise.resolve();
        },
      }),
    }),
  };
}

let withWorkspaceImpl: (id: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

vi.mock('@hm/db', () => ({
  getDb: () => ({ execute: executeMock }),
  withWorkspace: (id: string, fn: (tx: unknown) => Promise<unknown>) =>
    withWorkspaceImpl(id, fn),
  schema: {
    agentMetrics: {
      agentId: 'agent_id',
      period: 'period',
      periodStart: 'period_start',
    },
  },
}));

// Import APÓS o mock (hoisted pelo vitest, mas mantém a intenção explícita).
const { runAgentMetricsRollup } = await import('./metrics');

const WS = '00000000-0000-0000-0000-0000000000aa';
const AGENT_A = '00000000-0000-0000-0000-00000000a001';
const AGENT_B = '00000000-0000-0000-0000-00000000b002';
const DAY = '2026-06-09';

beforeEach(() => {
  captured.length = 0;
  executeQueue = [];
  executeMock.mockClear();
  withWorkspaceImpl = (id, fn) => fn(makeTx(id));
});

describe('runAgentMetricsRollup', () => {
  it('funde llm_usage_logs + agent_executions por (agent, bucket) e faz upsert', async () => {
    // 1ª execute = agregação de usage; 2ª = execuções (período único: day).
    executeQueue = [
      [
        {
          agent_id: AGENT_A,
          period_start: DAY,
          total_tokens: 1500,
          total_cost_usd: '0.045000',
          avg_latency_ms: 820,
        },
      ],
      [
        {
          agent_id: AGENT_A,
          period_start: DAY,
          total_conversations: 3,
          total_messages: 7,
          handoff_count: 1,
          error_count: 0,
        },
      ],
    ];

    const res = await runAgentMetricsRollup({
      workspaceId: WS,
      periods: ['day'],
    });

    expect(res.workspaces).toBe(1);
    expect(res.bucketsUpserted).toBe(1);
    expect(captured).toHaveLength(1);

    const row = captured[0];
    expect(row?.workspaceId).toBe(WS);
    expect(row?.period).toBe('day');
    expect(row?.values).toMatchObject({
      agentId: AGENT_A,
      periodStart: DAY,
      totalTokens: 1500,
      totalCostUsd: '0.045000',
      avgLatencyMs: 820,
      totalConversations: 3,
      totalMessages: 7,
      handoffCount: 1,
      errorCount: 0,
    });
  });

  it('cria bucket mesmo quando só há execuções (erro puro, sem custo)', async () => {
    executeQueue = [
      [], // usage vazio
      [
        {
          agent_id: AGENT_B,
          period_start: DAY,
          total_conversations: 1,
          total_messages: 0,
          handoff_count: 0,
          error_count: 2,
        },
      ],
    ];

    const res = await runAgentMetricsRollup({ workspaceId: WS, periods: ['day'] });

    expect(res.bucketsUpserted).toBe(1);
    expect(captured[0]?.values).toMatchObject({
      agentId: AGENT_B,
      totalTokens: 0,
      totalCostUsd: '0',
      avgLatencyMs: 0,
      errorCount: 2,
    });
  });

  it('é idempotente: re-run grava os mesmos números (substitui, não soma)', async () => {
    const usage = [
      {
        agent_id: AGENT_A,
        period_start: DAY,
        total_tokens: 1000,
        total_cost_usd: '0.010000',
        avg_latency_ms: 500,
      },
    ];
    const execs = [
      {
        agent_id: AGENT_A,
        period_start: DAY,
        total_conversations: 2,
        total_messages: 4,
        handoff_count: 0,
        error_count: 0,
      },
    ];

    executeQueue = [usage, execs];
    await runAgentMetricsRollup({ workspaceId: WS, periods: ['day'] });

    executeQueue = [usage, execs];
    await runAgentMetricsRollup({ workspaceId: WS, periods: ['day'] });

    expect(captured).toHaveLength(2);
    expect(captured[0]?.values).toMatchObject({ totalTokens: 1000, totalMessages: 4 });
    expect(captured[1]?.values).toEqual(captured[0]?.values);
  });

  it('descobre workspaces cross-tenant quando workspaceId não é dado', async () => {
    // 1ª execute = descoberta de workspaces; depois usage+execs por período.
    executeQueue = [
      [{ workspace_id: WS }],
      [], // usage
      [], // execs
    ];

    const res = await runAgentMetricsRollup({ periods: ['day'] });

    expect(res.workspaces).toBe(1);
    expect(res.bucketsUpserted).toBe(0);
    // 1 descoberta + (usage,execs) = 3 chamadas a execute.
    expect(executeMock).toHaveBeenCalledTimes(3);
  });

  it('rola múltiplos períodos (day+week+month) numa só passada', async () => {
    const usage = [
      {
        agent_id: AGENT_A,
        period_start: DAY,
        total_tokens: 100,
        total_cost_usd: '0.001000',
        avg_latency_ms: 300,
      },
    ];
    const execs = [
      {
        agent_id: AGENT_A,
        period_start: DAY,
        total_conversations: 1,
        total_messages: 1,
        handoff_count: 0,
        error_count: 0,
      },
    ];
    // 3 períodos → 3 pares (usage, execs).
    executeQueue = [usage, execs, usage, execs, usage, execs];

    const res = await runAgentMetricsRollup({
      workspaceId: WS,
      periods: ['day', 'week', 'month'],
    });

    expect(res.bucketsUpserted).toBe(3);
    expect(captured.map((c) => c.period)).toEqual(['day', 'week', 'month']);
  });

  it('falha de um workspace não derruba os demais', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    // Descoberta retorna 2 workspaces; o primeiro estoura no withWorkspace.
    executeQueue = [[{ workspace_id: 'ws-bad' }, { workspace_id: 'ws-ok' }]];
    let call = 0;
    withWorkspaceImpl = (id, fn) => {
      call += 1;
      if (id === 'ws-bad') return Promise.reject(new Error('boom'));
      // ws-ok: serve usage+execs vazios.
      executeQueue = [[], []];
      return fn(makeTx(id));
    };

    const res = await runAgentMetricsRollup({ periods: ['day'] }, logger as never);

    expect(call).toBe(2);
    expect(res.workspaces).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      'agent-metrics: roll-up de workspace falhou',
      expect.objectContaining({ workspaceId: 'ws-bad' }),
    );
  });
});
