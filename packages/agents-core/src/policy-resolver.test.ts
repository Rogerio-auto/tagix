/**
 * Testes do policy-resolver (F2-S09).
 *
 * `@hm/db` é mockado: `withWorkspace(id, fn)` roda `fn` com um `tx` fake cujos
 * builders Drizzle (`select().from().where().limit()` e
 * `select({...}).from().where()`) devolvem linhas enfileiradas em ordem de
 * chamada. Sem Postgres real.
 *
 * Cobre: leitura da policy sob RLS, fallback para defaults quando o workspace
 * não tem linha, soma do gasto do mês, e a montagem do snapshot
 * (`remaining_monthly_budget_usd`: null sem cap, `cap − gasto` com cap, clamp
 * em 0 quando o gasto excede o cap).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// ─── Mock de @hm/db ───────────────────────────────────────────────────────────

/** Fila de respostas para cada `.select()` (uma chain = uma posição). */
let selectQueue: unknown[][] = [];
/** Condições passadas a `.where()`, em ordem (renderizadas com o dialeto real do Drizzle). */
let whereCalls: unknown[] = [];

/** Builder Drizzle fake: thenable que resolve com a próxima fila de linhas. */
function makeSelectChain(): Record<string, unknown> {
  const rows = selectQueue.shift() ?? [];
  const result = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (cond: unknown) => {
      whereCalls.push(cond);
      return chain;
    },
    limit: () => chain,
    // Torna o builder awaitable como uma Promise<rows>.
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result),
  };
  return chain;
}

const tx = { select: () => makeSelectChain() };

vi.mock('@hm/db', async () => {
  // Colunas REAIS do Drizzle (mesmos nomes do schema): o filtro do gasto é renderizado em SQL
  // e conferido, em vez de confiar que o mock "aceitou" qualquer coisa.
  const pg = await import('drizzle-orm/pg-core');
  const llmUsageLogs = pg.pgTable('llm_usage_logs', {
    workspaceId: pg.uuid('workspace_id').notNull(),
    costUsd: pg.numeric('cost_usd').notNull(),
    surface: pg.text('surface').notNull(),
    isTest: pg.boolean('is_test').notNull(),
    createdAt: pg.timestamp('created_at', { withTimezone: true }).notNull(),
  });
  return {
    withWorkspace: (_id: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    schema: {
      workspaceAgentPolicies: {
        workspaceId: 'workspace_id',
      },
      llmUsageLogs,
    },
  };
});

const dialect = new PgDialect();
function renderWhere(index: number): { sql: string; params: unknown[] } {
  const cond = whereCalls[index];
  if (!(cond instanceof SQL)) throw new Error(`where #${index} não é SQL`);
  return dialect.sqlToQuery(cond);
}

// Import após o mock.
const {
  resolvePolicy,
  loadWorkspacePolicy,
  monthToDateSpendUsd,
  POLICY_DEFAULTS,
  buildSnapshot,
  copilotBudgetState,
  COPILOT_QUERY_HARD_CEILING_RATIO,
} = await import('./policy-resolver');

const WS = '00000000-0000-0000-0000-0000000000aa';
const AT = new Date('2026-06-15T12:00:00Z');

/** Linha completa de `workspace_agent_policies` ($inferSelect). */
function policyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspaceId: WS,
    allowedModels: ['openai/gpt-4o-mini'],
    defaultChatModel: 'openai/gpt-4o-mini',
    allowStreaming: true,
    allowInterrupts: false,
    allowParallelTools: true,
    allowVision: false,
    allowTranscription: false,
    allowPersistentCheckpoints: true,
    allowAgentConversions: false,
    agentConversionRequireApproval: true,
    maxIterations: 5,
    maxToolsPerAgent: 20,
    maxTokensPerCall: 8000,
    maxMonthlyCostUsd: '50.00',
    maxDailyInvocations: null,
    allowedToolCategories: ['database', 'workflow'],
    updatedBy: null,
    updatedAt: AT,
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue = [];
  whereCalls = [];
});

describe('loadWorkspacePolicy', () => {
  it('lê a linha do workspace e normaliza o cap numérico', async () => {
    selectQueue = [[policyRow()]];
    const policy = await loadWorkspacePolicy(WS);
    expect(policy.workspaceId).toBe(WS);
    expect(policy.maxMonthlyCostUsd).toBe(50);
    expect(policy.allowedModels).toEqual(['openai/gpt-4o-mini']);
    expect(policy.allowedToolCategories).toEqual(['database', 'workflow']);
  });

  it('cap NULL no banco → maxMonthlyCostUsd null', async () => {
    selectQueue = [[policyRow({ maxMonthlyCostUsd: null })]];
    const policy = await loadWorkspacePolicy(WS);
    expect(policy.maxMonthlyCostUsd).toBeNull();
  });

  it('workspace sem linha de policy → aplica os defaults do schema', async () => {
    selectQueue = [[]]; // nenhuma linha
    const policy = await loadWorkspacePolicy(WS);
    expect(policy).toEqual({ workspaceId: WS, ...POLICY_DEFAULTS });
    expect(policy.maxMonthlyCostUsd).toBeNull();
    expect(policy.maxIterations).toBe(5);
  });
});

describe('monthToDateSpendUsd', () => {
  it('soma cost_usd do mês (string numeric → number)', async () => {
    selectQueue = [[{ spendUsd: '12.345678' }]];
    const spend = await monthToDateSpendUsd(WS, AT);
    expect(spend).toBeCloseTo(12.345678, 6);
  });

  it('sem linhas / soma 0 → devolve 0', async () => {
    selectQueue = [[{ spendUsd: '0' }]];
    expect(await monthToDateSpendUsd(WS, AT)).toBe(0);
  });

  it('linha ausente (defensivo) → 0', async () => {
    selectQueue = [[]];
    expect(await monthToDateSpendUsd(WS, AT)).toBe(0);
  });
});

describe('buildSnapshot', () => {
  it('sem cap → remaining_monthly_budget_usd null', () => {
    const policy = { workspaceId: WS, ...POLICY_DEFAULTS, maxMonthlyCostUsd: null };
    const snap = buildSnapshot(policy, 100);
    expect(snap.remaining_monthly_budget_usd).toBeNull();
  });

  it('com cap → remaining = cap − gasto', () => {
    const policy = { workspaceId: WS, ...POLICY_DEFAULTS, maxMonthlyCostUsd: 50 };
    expect(buildSnapshot(policy, 12.5).remaining_monthly_budget_usd).toBe(37.5);
  });

  it('gasto acima do cap → remaining clampa em 0 (runtime exige >= 0)', () => {
    const policy = { workspaceId: WS, ...POLICY_DEFAULTS, maxMonthlyCostUsd: 50 };
    expect(buildSnapshot(policy, 60).remaining_monthly_budget_usd).toBe(0);
  });

  it('snapshot é snake_case e mapeia todos os campos da policy', () => {
    const policy = {
      workspaceId: WS,
      ...POLICY_DEFAULTS,
      allowedModels: ['a', 'b'],
      allowStreaming: false,
      maxIterations: 9,
      allowedToolCategories: ['knowledge'],
      maxMonthlyCostUsd: 10,
    };
    const snap = buildSnapshot(policy, 4);
    expect(snap).toEqual({
      allowed_models: ['a', 'b'],
      allow_streaming: false,
      allow_interrupts: false,
      allow_parallel_tools: true,
      allow_vision: false,
      allow_transcription: false,
      max_iterations: 9,
      max_tokens_per_call: 8000,
      max_tools_per_agent: 20,
      allowed_tool_categories: ['knowledge'],
      remaining_monthly_budget_usd: 6,
    });
  });
});

describe('resolvePolicy', () => {
  it('combina policy + gasto e monta o snapshot (1ª select = policy, 2ª = gasto)', async () => {
    selectQueue = [[policyRow()], [{ spendUsd: '20.00' }]];
    const resolved = await resolvePolicy(WS, undefined, AT);
    expect(resolved.workspaceId).toBe(WS);
    expect(resolved.policy.maxMonthlyCostUsd).toBe(50);
    expect(resolved.monthToDateSpendUsd).toBe(20);
    expect(resolved.snapshot.remaining_monthly_budget_usd).toBe(30);
  });

  it('agentId é informativo no MVP — não altera o snapshot', async () => {
    selectQueue = [[policyRow()], [{ spendUsd: '20.00' }]];
    const withAgent = await resolvePolicy(WS, 'agent-123', AT);
    selectQueue = [[policyRow()], [{ spendUsd: '20.00' }]];
    const withoutAgent = await resolvePolicy(WS, undefined, AT);
    expect(withAgent.snapshot).toEqual(withoutAgent.snapshot);
  });

  it('workspace sem policy + sem gasto → snapshot de defaults, sem cap', async () => {
    selectQueue = [[], [{ spendUsd: '0' }]];
    const resolved = await resolvePolicy(WS, undefined, AT);
    expect(resolved.snapshot.remaining_monthly_budget_usd).toBeNull();
    expect(resolved.snapshot.max_iterations).toBe(5);
  });
});

describe('monthToDateSpendUsd por superfície (F73-S10)', () => {
  it('padrão = agent: o teto dos agentes soma só surface=agent, do workspace e do mês', async () => {
    selectQueue = [[{ spendUsd: '3.5' }]];
    expect(await monthToDateSpendUsd(WS, AT)).toBe(3.5);
    const q = renderWhere(0);
    expect(q.sql).toContain('"llm_usage_logs"."workspace_id" = $1');
    expect(q.sql).toContain('"llm_usage_logs"."surface" = $2');
    expect(q.sql).toContain('"llm_usage_logs"."created_at" >= $3');
    expect(q.sql).toContain('"llm_usage_logs"."created_at" < $4');
    expect(q.params[0]).toBe(WS);
    expect(q.params[1]).toBe('agent');
    // Janela do mês UTC de AT.
    expect(String(q.params[2])).toContain('2026-06-01');
    expect(String(q.params[3])).toContain('2026-07-01');
    // Comportamento dos agentes inalterado: `is_test` não entra no filtro (como antes).
    expect(q.sql).not.toContain('is_test');
  });

  it('surface copilot lê só o gasto do Copiloto', async () => {
    selectQueue = [[{ spendUsd: '1.25' }]];
    expect(await monthToDateSpendUsd(WS, AT, undefined, { surface: 'copilot' })).toBe(1.25);
    expect(renderWhere(0).params[1]).toBe('copilot');
  });

  it('cap dos agentes inalterado: resolvePolicy consulta o gasto com surface=agent', async () => {
    selectQueue = [[policyRow()], [{ spendUsd: '20.00' }]];
    const resolved = await resolvePolicy(WS, undefined, AT);
    // 1ª where = policy; 2ª = gasto.
    expect(renderWhere(1).params[1]).toBe('agent');
    expect(resolved.snapshot.remaining_monthly_budget_usd).toBe(30);
  });

  it('soma não finita (defensivo) → 0, nunca NaN no snapshot', async () => {
    selectQueue = [[{ spendUsd: 'NaN' }]];
    expect(await monthToDateSpendUsd(WS, AT)).toBe(0);
  });
});

describe('copilotBudgetState (F73-S10; P8)', () => {
  const settings = (
    over: Partial<{
      monthlyBudgetUsd: string;
      budgetAlertPct: number;
      budgetMode: 'queries_only' | 'pause';
    }> = {},
  ) => ({
    monthlyBudgetUsd: '30.00',
    budgetAlertPct: 80,
    budgetMode: 'queries_only' as const,
    ...over,
  });

  it('abaixo do alerta → ok; no alerta → alert', () => {
    expect(copilotBudgetState(settings(), 0)).toBe('ok');
    expect(copilotBudgetState(settings(), 23.99)).toBe('ok');
    expect(copilotBudgetState(settings(), 24)).toBe('alert');
    expect(copilotBudgetState(settings(), 29.99)).toBe('alert');
  });

  it('no teto: queries_only segue consultando até o teto duro; pause para tudo', () => {
    expect(copilotBudgetState(settings(), 30)).toBe('queries_only');
    expect(copilotBudgetState(settings(), 30 * COPILOT_QUERY_HARD_CEILING_RATIO - 0.01)).toBe(
      'queries_only',
    );
    expect(copilotBudgetState(settings(), 30 * COPILOT_QUERY_HARD_CEILING_RATIO)).toBe('paused');
    expect(copilotBudgetState(settings({ budgetMode: 'pause' }), 30)).toBe('paused');
    expect(copilotBudgetState(settings({ budgetMode: 'pause' }), 29.99)).toBe('alert');
  });

  it('teto zero: qualquer gasto (inclusive 0) já está no teto', () => {
    expect(copilotBudgetState(settings({ monthlyBudgetUsd: '0' }), 0)).toBe('paused');
    expect(copilotBudgetState(settings({ monthlyBudgetUsd: '0', budgetMode: 'pause' }), 0)).toBe(
      'paused',
    );
  });

  it('valor corrompido falha fechado', () => {
    expect(copilotBudgetState(settings({ monthlyBudgetUsd: 'abc' }), 1)).toBe('paused');
    expect(copilotBudgetState(settings(), Number.NaN)).toBe('paused');
  });
});
