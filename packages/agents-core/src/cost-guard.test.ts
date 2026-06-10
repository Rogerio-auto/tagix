/**
 * Testes do hard cap de custo pré-chamada (F2-S09).
 *
 * Puro (sem DB): cobre a álgebra do orçamento — sem cap, exatamente no cap,
 * acima do cap, custo 0 com cap esgotado — e a estimativa conservadora de custo
 * a partir de tokens + pricing.
 */
import { describe, expect, it } from 'vitest';
import {
  assertWithinBudget,
  estimateCostUsd,
  guardResolved,
  type AssertWithinBudgetInput,
} from './cost-guard';
import { POLICY_DEFAULTS, type ResolvedPolicy, type WorkspacePolicy } from './policy-resolver';

const WS = '00000000-0000-0000-0000-0000000000aa';

function policyWithCap(cap: number | null): WorkspacePolicy {
  return { workspaceId: WS, ...POLICY_DEFAULTS, maxMonthlyCostUsd: cap };
}

function input(
  cap: number | null,
  spent: number,
  estimated: number,
): AssertWithinBudgetInput {
  return {
    workspaceId: WS,
    policy: policyWithCap(cap),
    monthToDateSpendUsd: spent,
    estimatedCostUsd: estimated,
  };
}

describe('assertWithinBudget', () => {
  it('sem cap (null) → sempre permite, headroom null', () => {
    const d = assertWithinBudget(input(null, 9999, 9999));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.headroomUsd).toBeNull();
  });

  it('bem abaixo do cap → permite, headroom = cap − gasto', () => {
    const d = assertWithinBudget(input(10, 2, 0.5));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.headroomUsd).toBe(8);
  });

  it('estimado cabe exatamente no headroom (gasto + estimado == cap) → permite', () => {
    const d = assertWithinBudget(input(10, 9, 1));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.headroomUsd).toBe(1);
  });

  it('estimado estoura o cap por um epsilon → bloqueia', () => {
    const d = assertWithinBudget(input(10, 9, 1.0001));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe('monthly_budget_exceeded');
      expect(d.capUsd).toBe(10);
      expect(d.spentUsd).toBe(9);
      expect(d.headroomUsd).toBeCloseTo(1, 6);
    }
  });

  it('já exatamente no cap, qualquer custo positivo → bloqueia (headroom 0)', () => {
    const d = assertWithinBudget(input(10, 10, 0.01));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.headroomUsd).toBe(0);
      expect(d.spentUsd).toBe(10);
    }
  });

  it('já acima do cap (gasto > cap), custo positivo → bloqueia, headroom clampa em 0', () => {
    const d = assertWithinBudget(input(10, 12, 0.01));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.headroomUsd).toBe(0);
  });

  it('custo estimado 0 (pricing desconhecido) nunca estoura, mesmo no cap', () => {
    const d = assertWithinBudget(input(10, 10, 0));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.headroomUsd).toBe(0);
      expect(d.estimatedCostUsd).toBe(0);
    }
  });

  it('estimativa negativa é tratada como 0 (defensivo)', () => {
    const d = assertWithinBudget(input(10, 10, -5));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.estimatedCostUsd).toBe(0);
  });

  it('mensagem de bloqueio inclui workspace, gasto, estimado e cap', () => {
    const d = assertWithinBudget(input(5, 5, 1));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.message).toContain(WS);
      expect(d.message).toContain('5.00');
    }
  });
});

describe('estimateCostUsd', () => {
  it('soma prompt + completion pelo pricing por 1M tokens', () => {
    // 1M prompt @ $0.15 + 1M completion @ $0.60 = $0.75
    const cost = estimateCostUsd(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      { promptPer1m: 0.15, completionPer1m: 0.6 },
    );
    expect(cost).toBeCloseTo(0.75, 8);
  });

  it('pricing ausente (null) conta como 0 naquele eixo — nunca infla', () => {
    const cost = estimateCostUsd(
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
      { promptPer1m: null, completionPer1m: null },
    );
    expect(cost).toBe(0);
  });

  it('escala linear com tokens', () => {
    const cost = estimateCostUsd(
      { promptTokens: 500_000, completionTokens: 0 },
      { promptPer1m: 1, completionPer1m: 1 },
    );
    expect(cost).toBeCloseTo(0.5, 8);
  });
});

describe('guardResolved', () => {
  it('aplica o guard a partir de um ResolvedPolicy', () => {
    const resolved: ResolvedPolicy = {
      workspaceId: WS,
      policy: policyWithCap(10),
      monthToDateSpendUsd: 9.5,
      snapshot: {
        allowed_models: [],
        allow_streaming: true,
        allow_interrupts: false,
        allow_parallel_tools: true,
        allow_vision: false,
        allow_transcription: false,
        max_iterations: 5,
        max_tokens_per_call: 8000,
        max_tools_per_agent: 20,
        allowed_tool_categories: ['database'],
        remaining_monthly_budget_usd: 0.5,
      },
    };
    expect(guardResolved(resolved, 0.4).ok).toBe(true);
    expect(guardResolved(resolved, 0.6).ok).toBe(false);
  });
});
