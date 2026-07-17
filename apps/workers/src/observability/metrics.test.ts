import { afterEach, describe, expect, it } from 'vitest';
import { setDlqDepth, startMetricsServer, stopMetricsServer } from './metrics';
import { clearHealthProbes, registerHealthProbe } from './health';

// Porta única por teste: evita que o pool de conexões do fetch (undici) reuse um
// socket de um servidor já fechado no teste anterior (ECONNRESET intermitente).
let nextPort = 19191;

afterEach(async () => {
  await stopMetricsServer();
  clearHealthProbes();
  delete process.env['WORKERS_METRICS_PORT'];
});

describe('servidor de métricas — /healthz (contrato F56-S18)', () => {
  it('200 quando saudável e 503 quando uma probe reprova (AMQP caído)', async () => {
    const port = String(nextPort++);
    process.env['WORKERS_METRICS_PORT'] = port;
    expect(startMetricsServer()).toBe(true);

    const ok = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { status: string };
    expect(okBody.status).toBe('ok');

    // Simula a queda da conexão AMQP.
    registerHealthProbe('amqp', () => ({ healthy: false, detail: { connections: 0 } }));
    const bad = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(bad.status).toBe(503);
    const badBody = (await bad.json()) as { status: string };
    expect(badBody.status).toBe('unhealthy');
  });

  it('expõe /metrics com a gauge hm_dlq_depth', async () => {
    const port = String(nextPort++);
    process.env['WORKERS_METRICS_PORT'] = port;
    startMetricsServer();
    setDlqDepth(3);
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('hm_dlq_depth');
  });

  it('startMetricsServer é no-op sem WORKERS_METRICS_PORT', () => {
    expect(startMetricsServer()).toBe(false);
  });
});
