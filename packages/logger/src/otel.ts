import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/**
 * OpenTelemetry pronto desde o dia 1, porém **opt-in**: só inicia quando
 * `OTEL_EXPORTER_OTLP_ENDPOINT` está setado (no-op caso contrário). O exporter
 * OTLP lê o endpoint da própria env (convenção OTel).
 */
let sdk: NodeSDK | null = null;

export function startTelemetry(): boolean {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint || sdk) return false;
  sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
  sdk.start();
  return true;
}

export async function stopTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
