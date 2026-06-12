import { getMetricsRegistry } from '../middlewares/metrics';
import { Counter, Histogram } from 'prom-client';
import { getMeter } from '@hm/logger';

/**
 * Métricas de DOMÍNIO da API, no mesmo registry Prometheus do `/metrics`.
 *
 * Cobrem o que o RED de HTTP não vê: publicações na fila (MQ), envio de
 * mensagens por canal e disparo de runs de agente. Em paralelo registra os
 * mesmos sinais no `Meter` OTel (opt-in via `@hm/logger`) — quando a telemetria
 * está ligada, o collector também recebe; quando não, o meter é no-op.
 *
 * O orchestrator não precisa wire nada: os pontos de instrumentação importam
 * estes helpers onde fizer sentido (publish, dispatch, agent-run).
 */
const registry = getMetricsRegistry();
const meter = getMeter('@hm/api');

// --- Prometheus (scrape via /metrics) ---

const mqPublishedTotal = new Counter({
  name: 'hm_mq_published_total',
  help: 'Mensagens publicadas na fila pela API, por tópico e resultado.',
  labelNames: ['topic', 'result'] as const,
  registers: [registry],
});

const channelMessagesSentTotal = new Counter({
  name: 'hm_channel_messages_sent_total',
  help: 'Mensagens enviadas a canais (whatsapp/instagram/waha), por canal e resultado.',
  labelNames: ['channel', 'result'] as const,
  registers: [registry],
});

const agentRunsTotal = new Counter({
  name: 'hm_agent_runs_total',
  help: 'Runs de agente disparados pela API, por resultado.',
  labelNames: ['result'] as const,
  registers: [registry],
});

const agentRunLatency = new Histogram({
  name: 'hm_agent_run_latency_seconds',
  help: 'Latência fim-a-fim do disparo de run de agente, em segundos.',
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

// --- OTel (opt-in, mesmo sinal pelo collector) ---

const otelMqPublished = meter.createCounter('hm.mq.published', {
  description: 'Mensagens publicadas na fila pela API.',
});
const otelChannelSent = meter.createCounter('hm.channel.messages_sent', {
  description: 'Mensagens enviadas a canais.',
});
const otelAgentRuns = meter.createCounter('hm.agent.runs', {
  description: 'Runs de agente disparados pela API.',
});

type Result = 'ok' | 'error';

/** Registra uma publicação na fila (sucesso/erro). */
export function recordMqPublish(topic: string, result: Result): void {
  mqPublishedTotal.inc({ topic, result });
  otelMqPublished.add(1, { topic, result });
}

/** Registra um envio a canal (sucesso/erro). */
export function recordChannelSend(channel: string, result: Result): void {
  channelMessagesSentTotal.inc({ channel, result });
  otelChannelSent.add(1, { channel, result });
}

/** Registra o disparo de um run de agente, com latência em segundos. */
export function recordAgentRun(result: Result, latencySeconds: number): void {
  agentRunsTotal.inc({ result });
  if (Number.isFinite(latencySeconds) && latencySeconds >= 0) {
    agentRunLatency.observe(latencySeconds);
  }
  otelAgentRuns.add(1, { result });
}
