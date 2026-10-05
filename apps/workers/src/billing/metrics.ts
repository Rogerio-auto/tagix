/**
 * Métricas do worker de cobrança (F71-S06), no registry do `/metrics` dos workers.
 *
 * `hm_billing_trial_expired_total` conta as empresas movidas de `trial` para `expired` pelo
 * tick — um salto inesperado (ex.: logo depois do deploy do backfill da S01) aparece aqui
 * antes de aparecer no suporte. Sem rótulos: nada de id de empresa em métrica.
 */
import { Counter } from 'prom-client';
import { getWorkersMetricsRegistry } from '../observability/metrics';

const trialExpiredTotal = new Counter({
  name: 'hm_billing_trial_expired_total',
  help: 'Empresas cujo trial venceu e foram movidas para expired pelo worker de cobrança.',
  registers: [getWorkersMetricsRegistry()],
});

/** Soma `count` empresas expiradas (no-op para 0). */
export function recordTrialsExpired(count: number): void {
  if (Number.isFinite(count) && count > 0) trialExpiredTotal.inc(count);
}
