/**
 * Ouvinte de `dashboard:metric_changed` do Painel completo (segurança M-1, F72-S04).
 *
 * Duas travas, nesta ordem: (1) só reage a métrica que está no painel renderizado (o
 * conjunto já veio recortado pelo papel no servidor); (2) a rajada vira UMA invalidação
 * de `/api/dashboard/me` por janela de 3 s (`createInvalidationBatch`, a mesma da
 * Home). Sem a (2), uma importação ou um disparo em massa refaria a leitura pesada do
 * painel a cada evento, por aba aberta.
 *
 * Puro (sem React, sem socket) para ser testado com relógio falso.
 */
import type { QueryKey } from '@tanstack/react-query';
import {
  REALTIME_BATCH_MS,
  createInvalidationBatch,
  type InvalidatesQueries,
} from './home/realtime-batch';

export interface MetricChangedListener {
  readonly onChanged: (payload: { readonly metricKey: string }) => void;
  /** Descarta a invalidação pendente (desmontagem / troca de dependências). */
  readonly cancel: () => void;
}

export function createMetricChangedListener(
  qc: InvalidatesQueries,
  queryKey: QueryKey,
  visibleMetricKeys: ReadonlySet<string>,
  waitMs: number = REALTIME_BATCH_MS,
): MetricChangedListener {
  const batch = createInvalidationBatch(qc, [queryKey], waitMs);
  return {
    onChanged: (payload) => {
      if (visibleMetricKeys.has(payload.metricKey)) batch.call();
    },
    cancel: batch.cancel,
  };
}
