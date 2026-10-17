/**
 * F73-S15 · métricas do Copiloto: nomes e rótulos expostos no `/metrics`, e a regra de
 * cardinalidade (nada de workspace/membro/turno; chave de ferramenta e capacidade normalizadas).
 */
import { describe, expect, it } from 'vitest';
import { getMetricsRegistry } from '../middlewares/metrics';
import {
  COPILOT_TURN_METRIC_STATUSES,
  copilotRanStatus,
  normalizeToolKey,
  recordCopilotCost,
  recordCopilotProposal,
  recordCopilotRejection,
  recordCopilotRuntimeUnavailable,
  recordCopilotToolCall,
  recordCopilotTtfb,
  recordCopilotTurn,
} from './copilot-metrics';

interface Sample {
  readonly labels: Record<string, string | number>;
  readonly value: number;
  readonly metricName?: string;
}

async function samples(name: string): Promise<Sample[]> {
  const metric = (await getMetricsRegistry().getMetricsAsJSON()).find((m) => m.name === name);
  return (metric?.values ?? []) as Sample[];
}

async function valueOf(
  name: string,
  labels: Record<string, string>,
  suffix?: string,
): Promise<number> {
  const all = await samples(name);
  return all
    .filter((s) =>
      suffix
        ? s.metricName === `${name}${suffix}`
        : s.metricName === undefined || s.metricName === name,
    )
    .filter((s) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))
    .reduce((sum, s) => sum + s.value, 0);
}

describe('métricas do Copiloto', () => {
  it('expõe os seis nomes do contrato do slot no registry do /metrics', async () => {
    recordCopilotTurn('completed', 2);
    recordCopilotTtfb(0.3);
    recordCopilotToolCall('get_pipeline_overview', 'executed');
    recordCopilotProposal('deal.move', 3, 'proposed');
    recordCopilotCost(0.01);
    const text = await getMetricsRegistry().metrics();
    for (const name of [
      'copilot_turns_total',
      'copilot_turn_duration_seconds',
      'copilot_ttfb_seconds',
      'copilot_tool_calls_total',
      'copilot_proposals_total',
      'copilot_cost_usd_total',
      'copilot_runtime_unavailable_total',
    ]) {
      expect(text).toContain(`# TYPE ${name} `);
    }
  });

  it('turno: contador por status e duração só para turno que rodou', async () => {
    const before = await valueOf('copilot_turns_total', { status: 'completed' });
    const beforeCount = await valueOf(
      'copilot_turn_duration_seconds',
      { status: 'completed' },
      '_count',
    );
    recordCopilotTurn('completed', 3.2);
    recordCopilotTurn('rate_limited', 9);
    expect(await valueOf('copilot_turns_total', { status: 'completed' })).toBe(before + 1);
    expect(await valueOf('copilot_turn_duration_seconds', { status: 'completed' }, '_count')).toBe(
      beforeCount + 1,
    );
    // Recusa não tem duração: nenhuma série `rate_limited` no histograma.
    expect(
      await valueOf('copilot_turn_duration_seconds', { status: 'rate_limited' }, '_count'),
    ).toBe(0);
  });

  it('recusas antes do turno viram o status certo; erro nosso conta como failed', async () => {
    const b = await valueOf('copilot_turns_total', { status: 'budget_blocked' });
    const f = await valueOf('copilot_turns_total', { status: 'failed' });
    const r = await valueOf('copilot_turns_total', { status: 'rejected' });
    recordCopilotRejection('budget_exceeded');
    recordCopilotRejection('runtime_unavailable');
    recordCopilotRejection('turn_in_progress');
    expect(await valueOf('copilot_turns_total', { status: 'budget_blocked' })).toBe(b + 1);
    expect(await valueOf('copilot_turns_total', { status: 'failed' })).toBe(f + 1);
    expect(await valueOf('copilot_turns_total', { status: 'rejected' })).toBe(r + 1);
  });

  it('runtime indisponível: recusa antes do turno e chamada direta incrementam o contador do alerta', async () => {
    const before = await valueOf('copilot_runtime_unavailable_total', {});
    recordCopilotRejection('runtime_unavailable');
    recordCopilotRuntimeUnavailable();
    recordCopilotRejection('internal'); // erro nosso não é runtime fora do ar
    expect(await valueOf('copilot_runtime_unavailable_total', {})).toBe(before + 2);
  });

  it('copilotRanStatus: só completed/cancelled passam; o resto é failed', () => {
    expect(copilotRanStatus('completed')).toBe('completed');
    expect(copilotRanStatus('cancelled')).toBe('cancelled');
    expect(copilotRanStatus('running')).toBe('failed');
    expect(copilotRanStatus(null)).toBe('failed');
  });

  it('TTFB e custo ignoram valores inválidos', async () => {
    const before = await valueOf('copilot_ttfb_seconds', {}, '_count');
    recordCopilotTtfb(Number.NaN);
    recordCopilotTtfb(-1);
    recordCopilotTtfb(0.5);
    expect(await valueOf('copilot_ttfb_seconds', {}, '_count')).toBe(before + 1);
    const cost = await valueOf('copilot_cost_usd_total', {});
    recordCopilotCost(0);
    recordCopilotCost(-3);
    recordCopilotCost(Number.POSITIVE_INFINITY);
    recordCopilotCost(0.25);
    expect(await valueOf('copilot_cost_usd_total', {})).toBeCloseTo(cost + 0.25, 8);
  });

  it('cardinalidade: chave de ferramenta fora do formato ou além do teto vira `other`', () => {
    expect(normalizeToolKey('get_deal')).toBe('get_deal');
    expect(normalizeToolKey('GET DEAL; drop table')).toBe('other');
    expect(normalizeToolKey('../../etc/passwd')).toBe('other');
    expect(normalizeToolKey('x'.repeat(200))).toBe('other');
    for (let i = 0; i < 200; i += 1) normalizeToolKey(`tool_${i}`);
    expect(normalizeToolKey('tool_novissima_depois_do_teto')).toBe('other');
    // Chave já conhecida continua com o próprio rótulo mesmo depois do teto.
    expect(normalizeToolKey('get_deal')).toBe('get_deal');
  });

  it('cardinalidade: capacidade, risco, status e decisão desconhecidos colapsam', async () => {
    recordCopilotProposal('capacidade.inventada', 9, 'status_estranho');
    recordCopilotToolCall('get_deal', 'decisao_inventada');
    const proposals = await samples('copilot_proposals_total');
    expect(
      proposals.some(
        (s) =>
          s.labels['capability'] === 'other' &&
          s.labels['risk_level'] === 'unknown' &&
          s.labels['status'] === 'unknown',
      ),
    ).toBe(true);
    expect(
      (await samples('copilot_tool_calls_total')).some(
        (s) => s.labels['tool_key'] === 'get_deal' && s.labels['decision'] === 'error',
      ),
    ).toBe(true);
  });

  it('nenhuma série do Copiloto carrega workspace, membro ou turno', async () => {
    const forbidden = ['workspace_id', 'workspace', 'member_id', 'member', 'turn_id', 'session_id'];
    const registry = getMetricsRegistry();
    const metrics = await registry.getMetricsAsJSON();
    const copilot = metrics.filter((m) => m.name.startsWith('copilot_'));
    expect(copilot.length).toBeGreaterThanOrEqual(6);
    for (const metric of copilot) {
      for (const sample of metric.values) {
        for (const key of Object.keys(sample.labels)) {
          expect(forbidden).not.toContain(key);
        }
      }
    }
    expect(COPILOT_TURN_METRIC_STATUSES).toHaveLength(6);
  });
});
