import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics, type Meter } from '@opentelemetry/api';

/**
 * OpenTelemetry pronto desde o dia 1, porém **opt-in**: só inicia quando
 * `OTEL_EXPORTER_OTLP_ENDPOINT` está setado (no-op caso contrário). O exporter
 * OTLP lê o endpoint da própria env (convenção OTel).
 *
 * Desde F10-S01 também liga **métricas** (RED / latência / throughput) via
 * `MeterProvider` + `PeriodicExportingMetricReader` apontando para o mesmo
 * collector OTLP. Continua tudo opt-in: sem endpoint, nenhum meter é registrado
 * e `getMeter()` devolve o no-op meter da API (zero overhead, zero exceção).
 */
let sdk: NodeSDK | null = null;

/** Intervalo de export das métricas OTLP (ms). Default 60s (convenção OTel). */
function metricExportIntervalMs(): number {
  const raw = process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'];
  if (!raw) return 60_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function startTelemetry(): boolean {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint || sdk) return false;
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: metricExportIntervalMs(),
    }),
  });
  sdk.start();
  return true;
}

export async function stopTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

/**
 * Devolve um `Meter` OTel para instrumentação de domínio. Quando a telemetria
 * não foi iniciada (sem endpoint), o `MeterProvider` global é o no-op da API —
 * os instrumentos criados não fazem nada e não custam nada. Seguro chamar
 * sempre, em qualquer app.
 */
export function getMeter(name: string, version?: string): Meter {
  return metrics.getMeter(name, version);
}

export type { Meter } from '@opentelemetry/api';
