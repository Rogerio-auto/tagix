/**
 * Métricas do worker de mídia (F70-S27), no registry do `/metrics` dos workers.
 *
 * Por que existem: no incidente de 25/09 o storage recusou a credencial e nada no
 * sistema contou isso — os jobs só apareciam, horas depois, nas filas de retry e na
 * DLQ. Agora cada recusa conta, e a regra `LeadiumMediaStorageDenied`
 * (`infra/prometheus/alerts.yml`) dispara no primeiro upload negado.
 *
 * Rótulos de cardinalidade fechada: `kind` (3 valores), `operation` (5), `code` (códigos
 * S3/de rede saneados por `@hm/storage` — conjunto pequeno e estável), `reason` (7).
 * Nada de id de mensagem, workspace ou bucket em rótulo.
 */
import { Counter } from 'prom-client';
import { getWorkersMetricsRegistry } from '../observability/metrics';
import type { MediaFailureReason, MediaMetricsPort } from './ports';

const registry = getWorkersMetricsRegistry();

const storageFailuresTotal = new Counter({
  name: 'hm_media_storage_failures_total',
  help: 'Falhas de storage no worker de mídia, por natureza (config/transient/unknown), código e operação.',
  labelNames: ['kind', 'code', 'operation'] as const,
  registers: [registry],
});

const jobsParkedTotal = new Counter({
  name: 'hm_media_jobs_parked_total',
  help: 'Jobs de mídia estacionados por storage negado (voltam com backoff longo, sem gastar retentativa).',
  registers: [registry],
});

const mediaFailedTotal = new Counter({
  name: 'hm_media_failed_total',
  help: 'Mídias marcadas como falha, por motivo.',
  labelNames: ['reason'] as const,
  registers: [registry],
});

/** Implementação default: publica no registry Prometheus dos workers. */
export const promMediaMetrics: MediaMetricsPort = {
  storageFailure(kind: string, code: string, operation: string): void {
    storageFailuresTotal.inc({ kind, code, operation });
  },
  jobParked(): void {
    jobsParkedTotal.inc();
  },
  mediaFailed(reason: MediaFailureReason): void {
    mediaFailedTotal.inc({ reason });
  },
};
