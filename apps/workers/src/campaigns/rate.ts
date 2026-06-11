/**
 * Rate adaptativo (CAMPAIGNS.md 7). Puro/testavel.
 *
 * - YELLOW -> metade do rate; RED -> 0 (o caller pausa a campanha);
 * - delivery_rate < 0.85 -> 70% do rate (throttle por queda de entrega);
 * - piso de 1 quando o resultado seria 0 mas a quality nao e RED.
 */
import type { QualityRating } from '@hm/channels';

export interface RateInputs {
  readonly baseRatePerMinute: number;
  readonly qualityRating: QualityRating;
  /** delivery_rate atual (delivered/sent); undefined = sem dados ainda. */
  readonly deliveryRate?: number | null;
}

/**
 * Calcula o rate efetivo/min. Retorna 0 SOMENTE em RED (sinal de auto-pause).
 * Em qualquer outro caso o piso e 1 (nunca trava por arredondamento).
 */
export function effectiveRatePerMinute(inputs: RateInputs): number {
  if (inputs.qualityRating === 'RED') return 0;
  let rate = inputs.baseRatePerMinute;
  if (inputs.qualityRating === 'YELLOW') rate = Math.floor(rate * 0.5);
  if (inputs.deliveryRate != null && inputs.deliveryRate < 0.85) {
    rate = Math.floor(rate * 0.7);
  }
  return Math.max(1, rate);
}

/** Tamanho do batch por tick (~rate/4 p/ distribuir em ~15s). Min 1. */
export function batchSizeForTick(ratePerMinute: number): number {
  return Math.max(1, Math.floor(ratePerMinute / 4));
}
