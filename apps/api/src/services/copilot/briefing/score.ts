/**
 * Score explicável do briefing (COPILOTO.md §7.1): `score = valor_em_risco × peso(tipo, urgência)`.
 *
 * Função pura, sem relógio nem banco: o instante entra por parâmetro. A tabela de pesos é
 * versionada (`BRIEFING_SCORE_VERSION`) e fica à vista aqui; mudar um peso é mudar a versão, e a
 * versão que gerou o item viaja com ele (`_meta.v`), então um item antigo nunca é "reexplicado"
 * com pesos novos.
 *
 * Por que cada peso (resumo; a calibração real vem da telemetria da F73-S15):
 * - `deals_idle`: o dinheiro está na gaveta e esfria com o tempo. Parado há 7+ dias pesa 1,25 e
 *   há 14+ pesa 1,5: quanto mais tempo sem resposta, menos provável o negócio voltar sozinho.
 * - `leads_waiting`: lead que acabou de escrever é o dinheiro mais perto de fechar, e é o que a
 *   concorrência também está tentando responder. O peso máximo (1,5) é a faixa "atenção"
 *   (15 a 59 min, mesma régua do `/api/dashboard/today`): ainda dá para salvar, e já está
 *   escorregando. Acima de 1 h (`esfriando`) pesa 1,25: a chance caiu, mas o volume é grande.
 * - `events_today`: compromisso sem confirmação perde o horário. Nas próximas 2 h pesa 1,5; até
 *   6 h, 1,25. A base 0,9 reflete que o negócio ligado já tem data marcada (menos incerteza).
 * - `autopilot_pending`: a sugestão espera aprovação, não some. Peso fixo e baixo (0,7).
 * - `campaign_issue`: o valor é uma estimativa (alcance pendente × ticket × taxa), por isso a
 *   base é a menor (0,5); campanha em estado crítico sobe para 1,5.
 * - `integration_alert`: seam da F75; o provedor informa o valor, peso neutro.
 */
import type { BriefingItemKind } from '@hm/shared';
import type { BriefingCandidate } from './types';

/** Mudar qualquer peso desta tabela exige subir esta versão. */
export const BRIEFING_SCORE_VERSION = 1;

/** Faixa de urgência: a primeira que casa vence. Limites inclusivos. */
export interface UrgencyBand {
  readonly id: string;
  readonly min?: number;
  readonly max?: number;
  readonly factor: number;
}

export interface KindWeights {
  readonly base: number;
  readonly bands: readonly UrgencyBand[];
}

export const BRIEFING_WEIGHTS: Readonly<Record<BriefingItemKind, KindWeights>> = {
  deals_idle: {
    base: 1,
    bands: [
      { id: 'idle_14', min: 14, factor: 1.5 },
      { id: 'idle_7', min: 7, factor: 1.25 },
      { id: 'idle_3', factor: 1 },
    ],
  },
  leads_waiting: {
    base: 1,
    bands: [
      { id: 'cooling', min: 60, factor: 1.25 },
      { id: 'attention', min: 15, factor: 1.5 },
      { id: 'now', factor: 1 },
    ],
  },
  events_today: {
    base: 0.9,
    bands: [
      { id: 'within_2h', max: 2, factor: 1.5 },
      { id: 'within_6h', max: 6, factor: 1.25 },
      { id: 'later_today', factor: 1 },
    ],
  },
  autopilot_pending: { base: 0.7, bands: [{ id: 'fixed', factor: 1 }] },
  campaign_issue: {
    base: 0.5,
    bands: [
      { id: 'critical', min: 1, factor: 1.5 },
      { id: 'warning', factor: 1 },
    ],
  },
  integration_alert: { base: 1, bands: [{ id: 'fixed', factor: 1 }] },
};

export interface ScoreBreakdown {
  readonly version: number;
  readonly kind: BriefingItemKind;
  readonly valueAtRisk: number;
  readonly base: number;
  readonly factor: number;
  /** `base × factor`: o número que multiplica o valor. */
  readonly weight: number;
  readonly band: string;
  /** Valor do eixo de urgência usado (dias, minutos, horas ou 0). */
  readonly urgency: number;
  readonly score: number;
}

const MS_MINUTE = 60_000;
const MS_HOUR = 3_600_000;

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Valor do eixo de urgência no instante `now`. Espera e compromisso dependem do relógio
 * (a espera cresce, o compromisso se aproxima), então saem de `oldestAt`; os demais já
 * chegam medidos pelo coletor.
 */
export function urgencyAt(candidate: BriefingCandidate, now: Date): number {
  switch (candidate.kind) {
    case 'leads_waiting':
      return Math.max(0, Math.floor((now.getTime() - candidate.oldestAt.getTime()) / MS_MINUTE));
    case 'events_today':
      return Math.max(0, (candidate.oldestAt.getTime() - now.getTime()) / MS_HOUR);
    default:
      return candidate.urgency;
  }
}

function pickBand(bands: readonly UrgencyBand[], urgency: number): UrgencyBand {
  for (const band of bands) {
    if (band.min !== undefined && urgency < band.min) continue;
    if (band.max !== undefined && urgency > band.max) continue;
    return band;
  }
  // A última faixa de toda tabela é a sem limites; chegar aqui é tabela malformada.
  const last = bands[bands.length - 1];
  if (!last) throw new Error('briefing: tabela de pesos sem faixas.');
  return last;
}

/** Pontua um candidato. Determinística: mesmo candidato e mesmo `now`, mesmo resultado. */
export function scoreItem(candidate: BriefingCandidate, now: Date): ScoreBreakdown {
  const weights = BRIEFING_WEIGHTS[candidate.kind];
  const urgency = urgencyAt(candidate, now);
  const band = pickBand(weights.bands, urgency);
  const weight = round(weights.base * band.factor, 4);
  const value = Math.max(0, candidate.valueAtRisk);
  return {
    version: BRIEFING_SCORE_VERSION,
    kind: candidate.kind,
    valueAtRisk: value,
    base: weights.base,
    factor: band.factor,
    weight,
    band: band.id,
    urgency,
    score: round(value * weight, 2),
  };
}
