import { Counter, Histogram } from 'prom-client';
import { getMeter } from '@hm/logger';
import { CAPABILITY_KEYS } from '@hm/shared';
import { getMetricsRegistry } from '../middlewares/metrics';

/**
 * Métricas Prometheus do Copiloto (F73-S15; COPILOTO.md §9), no mesmo registry do `/metrics`.
 *
 * Cardinalidade (regra de ouro): NENHUM rótulo de `workspace_id`, `member_id`, `turn_id` ou
 * texto livre. Todo rótulo vem de um conjunto fechado, e o que o chamador pode influenciar
 * (chave de ferramenta, capacidade) passa por um normalizador que colapsa o desconhecido em
 * `other`/`unknown`. Custo por empresa mora no `/usage` e nos logs (`copilot.turn`), não aqui.
 *
 *   copilot_turns_total{status}                          completed|failed|cancelled|budget_blocked|rate_limited|rejected
 *   copilot_turn_duration_seconds{status}                completed|failed|cancelled (turno que de fato rodou)
 *   copilot_ttfb_seconds                                 até o frame `turn_started`
 *   copilot_tool_calls_total{tool_key,decision}          chaves do registro (≤ 64 distintas) × decisão
 *   copilot_proposals_total{capability,risk_level,status} capacidades do catálogo × 1..4 × status
 *   copilot_cost_usd_total                               soma do custo dos turnos concluídos
 *   copilot_runtime_unavailable_total                    turnos que terminaram em `runtime_unavailable`
 *
 * Em paralelo registra os mesmos sinais no `Meter` OTel (opt-in via `@hm/logger`; no-op sem ele).
 */
const registry = getMetricsRegistry();
const meter = getMeter('@hm/api');

/** Conjuntos fechados dos rótulos. */
export const COPILOT_TURN_METRIC_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'budget_blocked',
  'rate_limited',
  'rejected',
] as const;
export type CopilotTurnMetricStatus = (typeof COPILOT_TURN_METRIC_STATUSES)[number];

/** Estados em que o turno de fato rodou (têm duração). */
export type CopilotRanTurnStatus = Extract<
  CopilotTurnMetricStatus,
  'completed' | 'failed' | 'cancelled'
>;

const TOOL_DECISIONS = [
  'executed',
  'proposed',
  'blocked',
  'denied',
  'invalid_args',
  'error',
] as const;
type ToolDecision = (typeof TOOL_DECISIONS)[number];

const PROPOSAL_STATUSES = [
  'proposed',
  'blocked',
  'awaiting_approval',
  'expired',
  'cancelled',
  'confirmed',
  'executing',
  'completed',
  'partially_completed',
  'failed',
  'undone',
  'partially_undone',
] as const;

/** Teto de chaves de ferramenta distintas: o registro tem ~25; 64 dá folga e protege o resto. */
const TOOL_KEY_LIMIT = 64;
const TOOL_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/;

const TURN_STATUS_SET: ReadonlySet<string> = new Set(COPILOT_TURN_METRIC_STATUSES);
const TOOL_DECISION_SET: ReadonlySet<string> = new Set(TOOL_DECISIONS);
const PROPOSAL_STATUS_SET: ReadonlySet<string> = new Set(PROPOSAL_STATUSES);
const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITY_KEYS);
const knownToolKeys = new Set<string>();

/**
 * Chave de ferramenta como rótulo. O runtime só chama ferramentas do registro, mas o callback
 * também registra tentativas de chaves inexistentes: a chave crua nunca vira rótulo sem passar
 * pelo formato e pelo teto de chaves distintas.
 */
export function normalizeToolKey(toolKey: string): string {
  if (!TOOL_KEY_PATTERN.test(toolKey)) return 'other';
  if (knownToolKeys.has(toolKey)) return toolKey;
  if (knownToolKeys.size >= TOOL_KEY_LIMIT) return 'other';
  knownToolKeys.add(toolKey);
  return toolKey;
}

// --- Prometheus (scrape via /metrics) ---

const turnsTotal = new Counter({
  name: 'copilot_turns_total',
  help: 'Turnos do Copiloto por desfecho (inclui recusas antes do turno: orçamento e limite de taxa).',
  labelNames: ['status'] as const,
  registers: [registry],
});

/**
 * Buckets cobrem a meta (final p50 <= 4 s, p95 <= 10 s) com folga até o teto do turno (70 s no
 * Node): 0,5 s ... 60 s.
 */
const turnDuration = new Histogram({
  name: 'copilot_turn_duration_seconds',
  help: 'Duração do turno do Copiloto (do pedido ao encerramento), em segundos.',
  labelNames: ['status'] as const,
  buckets: [0.5, 1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 45, 60],
  registers: [registry],
});

/** Buckets em torno da meta (800 ms) e do limite do alerta (1,5 s). */
const ttfb = new Histogram({
  name: 'copilot_ttfb_seconds',
  help: 'Tempo até o primeiro frame (`turn_started`) do SSE do Copiloto, em segundos.',
  buckets: [0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 5],
  registers: [registry],
});

const toolCallsTotal = new Counter({
  name: 'copilot_tool_calls_total',
  help: 'Chamadas de ferramenta do Copiloto, por ferramenta e decisão.',
  labelNames: ['tool_key', 'decision'] as const,
  registers: [registry],
});

const proposalsTotal = new Counter({
  name: 'copilot_proposals_total',
  help: 'Transições de propostas de ação do Copiloto, por capacidade, nível de risco e status de destino.',
  labelNames: ['capability', 'risk_level', 'status'] as const,
  registers: [registry],
});

const costUsdTotal = new Counter({
  name: 'copilot_cost_usd_total',
  help: 'Custo acumulado dos turnos concluídos do Copiloto, em US$ (sem rótulo de workspace: cardinalidade).',
  registers: [registry],
});

const runtimeUnavailableTotal = new Counter({
  name: 'copilot_runtime_unavailable_total',
  help: 'Turnos do Copiloto que terminaram em runtime_unavailable (runtime fora do ar ou sem configuração).',
  registers: [registry],
});

// --- OTel (opt-in, mesmo sinal pelo collector) ---

const otelTurns = meter.createCounter('hm.copilot.turns', {
  description: 'Turnos do Copiloto por desfecho.',
});
const otelTurnDuration = meter.createHistogram('hm.copilot.turn_duration', {
  description: 'Duração do turno do Copiloto.',
  unit: 's',
});
const otelTtfb = meter.createHistogram('hm.copilot.ttfb', {
  description: 'Tempo até o primeiro frame do SSE do Copiloto.',
  unit: 's',
});
const otelToolCalls = meter.createCounter('hm.copilot.tool_calls', {
  description: 'Chamadas de ferramenta do Copiloto.',
});
const otelProposals = meter.createCounter('hm.copilot.proposals', {
  description: 'Transições de propostas do Copiloto.',
});
const otelCost = meter.createCounter('hm.copilot.cost', {
  description: 'Custo do Copiloto em US$.',
  unit: 'USD',
});

const otelRuntimeUnavailable = meter.createCounter('hm.copilot.runtime_unavailable', {
  description: 'Turnos do Copiloto que terminaram em runtime_unavailable.',
});

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Desfecho de um turno. `durationSeconds` só para turno que rodou (completed/failed/cancelled);
 * recusas antes do turno (orçamento, limite de taxa, outras) só incrementam o contador.
 */
export function recordCopilotTurn(status: CopilotTurnMetricStatus, durationSeconds?: number): void {
  const label = TURN_STATUS_SET.has(status) ? status : 'rejected';
  turnsTotal.inc({ status: label });
  otelTurns.add(1, { status: label });
  if (
    durationSeconds !== undefined &&
    finiteNonNegative(durationSeconds) &&
    (label === 'completed' || label === 'failed' || label === 'cancelled')
  ) {
    turnDuration.observe({ status: label }, durationSeconds);
    otelTurnDuration.record(durationSeconds, { status: label });
  }
}

/** Status de turno que rodou, a partir do `copilot_turns.status` final (desconhecido = `failed`). */
export function copilotRanStatus(status: string | null | undefined): CopilotRanTurnStatus {
  return status === 'completed' || status === 'cancelled' ? status : 'failed';
}

/**
 * Recusa antes de existir turno (não vira linha de `copilot_turns`, COMMS S10): o motivo é o
 * mesmo do log `copilot.turn_rejected`. Erro nosso ou do runtime conta como `failed` (entra na
 * taxa de erro do alerta); orçamento e limite de taxa têm status próprio e ficam FORA dela.
 */
export function recordCopilotRejection(reason: string): void {
  if (reason === 'runtime_unavailable') recordCopilotRuntimeUnavailable();
  if (reason === 'rate_limited') recordCopilotTurn('rate_limited');
  else if (reason === 'budget_exceeded') recordCopilotTurn('budget_blocked');
  else if (reason === 'runtime_unavailable' || reason === 'internal' || reason === 'timeout') {
    recordCopilotTurn('failed');
  } else recordCopilotTurn('rejected');
}

/** O runtime não respondeu (ou não está configurado): base do alerta "runtime indisponível". */
export function recordCopilotRuntimeUnavailable(): void {
  runtimeUnavailableTotal.inc();
  otelRuntimeUnavailable.add(1);
}

/** Tempo até o `turn_started`, em segundos. */
export function recordCopilotTtfb(seconds: number): void {
  if (!finiteNonNegative(seconds)) return;
  ttfb.observe(seconds);
  otelTtfb.record(seconds);
}

/** Uma chamada de ferramenta (depois do commit do registro em `copilot_tool_calls`). */
export function recordCopilotToolCall(toolKey: string, decision: string): void {
  const labels = {
    tool_key: normalizeToolKey(toolKey),
    decision: TOOL_DECISION_SET.has(decision) ? (decision as ToolDecision) : 'error',
  };
  toolCallsTotal.inc(labels);
  otelToolCalls.add(1, labels);
}

/** Uma transição de proposta (status de destino). */
export function recordCopilotProposal(capability: string, riskLevel: number, status: string): void {
  const labels = {
    capability: CAPABILITY_SET.has(capability) ? capability : 'other',
    risk_level: riskLevel >= 1 && riskLevel <= 4 ? String(riskLevel) : 'unknown',
    status: PROPOSAL_STATUS_SET.has(status) ? status : 'unknown',
  };
  proposalsTotal.inc(labels);
  otelProposals.add(1, labels);
}

/** Custo em US$ de um turno concluído. */
export function recordCopilotCost(costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  costUsdTotal.inc(costUsd);
  otelCost.add(costUsd);
}
