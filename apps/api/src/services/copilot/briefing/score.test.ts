/**
 * F73-S12 · score do briefing: teste por tabela. Função pura, sem banco.
 */
import { describe, expect, it } from 'vitest';
import type { BriefingItemKind } from '@hm/shared';
import {
  BRIEFING_SCORE_VERSION,
  BRIEFING_WEIGHTS,
  scoreItem,
  urgencyAt,
} from './score';
import type { BriefingCandidate, CandidateFacts } from './types';

const NOW = new Date('2026-10-17T13:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;

function facts(kind: BriefingItemKind): CandidateFacts {
  switch (kind) {
    case 'deals_idle':
      return {
        kind,
        count: 1,
        stageId: 's',
        stageName: 'S',
        idleDaysThreshold: 3,
        maxIdleDays: 3,
        avgIdleDays: 3,
        reactivationStageName: null,
      };
    case 'leads_waiting':
      return { kind, count: 1, oldestWaitingMinutes: 0, ticket: 1, ticketBasis: 'won_90d' };
    case 'events_today':
      return { kind, count: 1, dealCount: 0, hoursUntilFirst: 1 };
    case 'autopilot_pending':
      return { kind, count: 1 };
    case 'campaign_issue':
      return {
        kind,
        campaignId: 'c',
        campaignName: 'C',
        health: 'warning',
        sent: 1,
        total: 2,
        failed: 1,
        pending: 1,
        ticket: 1,
      };
    case 'integration_alert':
      return { kind, title: 't', why: ['w'], action: { kind: 'navigate', value: '/x', label: 'x' } };
  }
}

function candidate(
  kind: BriefingItemKind,
  over: Partial<BriefingCandidate> = {},
): BriefingCandidate {
  return {
    kind,
    key: kind,
    valueAtRisk: 1000,
    urgency: 0,
    oldestAt: NOW,
    facts: facts(kind),
    refs: {},
    source: 'x',
    asOf: NOW,
    ...over,
  };
}

describe('scoreItem · tabela de pesos', () => {
  const rows: {
    name: string;
    c: BriefingCandidate;
    weight: number;
    band: string;
    score: number;
  }[] = [
    { name: 'parado 3 dias', c: candidate('deals_idle', { urgency: 3 }), weight: 1, band: 'idle_3', score: 1000 },
    { name: 'parado 6 dias', c: candidate('deals_idle', { urgency: 6 }), weight: 1, band: 'idle_3', score: 1000 },
    { name: 'parado 7 dias', c: candidate('deals_idle', { urgency: 7 }), weight: 1.25, band: 'idle_7', score: 1250 },
    { name: 'parado 14 dias', c: candidate('deals_idle', { urgency: 14 }), weight: 1.5, band: 'idle_14', score: 1500 },
    {
      name: 'lead esperando há 5 min',
      c: candidate('leads_waiting', { oldestAt: new Date(NOW.getTime() - 5 * MIN) }),
      weight: 1,
      band: 'now',
      score: 1000,
    },
    {
      name: 'lead esperando há 15 min (atenção)',
      c: candidate('leads_waiting', { oldestAt: new Date(NOW.getTime() - 15 * MIN) }),
      weight: 1.5,
      band: 'attention',
      score: 1500,
    },
    {
      name: 'lead esperando há 59 min (atenção)',
      c: candidate('leads_waiting', { oldestAt: new Date(NOW.getTime() - 59 * MIN) }),
      weight: 1.5,
      band: 'attention',
      score: 1500,
    },
    {
      name: 'lead esperando há 2 h (esfriando)',
      c: candidate('leads_waiting', { oldestAt: new Date(NOW.getTime() - 120 * MIN) }),
      weight: 1.25,
      band: 'cooling',
      score: 1250,
    },
    {
      name: 'compromisso em 1 h',
      c: candidate('events_today', { oldestAt: new Date(NOW.getTime() + HOUR) }),
      weight: 1.35,
      band: 'within_2h',
      score: 1350,
    },
    {
      name: 'compromisso em 5 h',
      c: candidate('events_today', { oldestAt: new Date(NOW.getTime() + 5 * HOUR) }),
      weight: 1.125,
      band: 'within_6h',
      score: 1125,
    },
    {
      name: 'compromisso em 9 h',
      c: candidate('events_today', { oldestAt: new Date(NOW.getTime() + 9 * HOUR) }),
      weight: 0.9,
      band: 'later_today',
      score: 900,
    },
    { name: 'sugestões do piloto', c: candidate('autopilot_pending'), weight: 0.7, band: 'fixed', score: 700 },
    { name: 'campanha em alerta', c: candidate('campaign_issue', { urgency: 0 }), weight: 0.5, band: 'warning', score: 500 },
    { name: 'campanha crítica', c: candidate('campaign_issue', { urgency: 1 }), weight: 0.75, band: 'critical', score: 750 },
    { name: 'alerta de integração', c: candidate('integration_alert'), weight: 1, band: 'fixed', score: 1000 },
  ];

  it.each(rows)('$name', ({ c, weight, band, score }) => {
    const out = scoreItem(c, NOW);
    expect(out.band).toBe(band);
    expect(out.weight).toBe(weight);
    expect(out.score).toBe(score);
    expect(out.version).toBe(BRIEFING_SCORE_VERSION);
  });

  it('o score é exatamente valor × (base × fator): o `why` pode reproduzir a conta', () => {
    for (const c of [
      candidate('deals_idle', { urgency: 9, valueAtRisk: 31_400 }),
      candidate('leads_waiting', { valueAtRisk: 4_200.5, oldestAt: new Date(NOW.getTime() - 30 * MIN) }),
      candidate('campaign_issue', { urgency: 1, valueAtRisk: 187.4 }),
    ]) {
      const out = scoreItem(c, NOW);
      expect(out.weight).toBeCloseTo(out.base * out.factor, 6);
      expect(out.score).toBeCloseTo(out.valueAtRisk * out.weight, 2);
    }
  });

  it('valor zero ou negativo não pontua; é determinístico para o mesmo `now`', () => {
    expect(scoreItem(candidate('deals_idle', { valueAtRisk: 0 }), NOW).score).toBe(0);
    expect(scoreItem(candidate('deals_idle', { valueAtRisk: -50 }), NOW).score).toBe(0);
    const c = candidate('deals_idle', { urgency: 10, valueAtRisk: 777 });
    expect(scoreItem(c, NOW)).toEqual(scoreItem(c, NOW));
  });

  it('a espera do lead e a proximidade do compromisso dependem do relógio', () => {
    const lead = candidate('leads_waiting', { oldestAt: NOW });
    expect(urgencyAt(lead, new Date(NOW.getTime() + 20 * MIN))).toBe(20);
    expect(scoreItem(lead, new Date(NOW.getTime() + 20 * MIN)).band).toBe('attention');
    const ev = candidate('events_today', { oldestAt: new Date(NOW.getTime() + 3 * HOUR) });
    expect(scoreItem(ev, NOW).band).toBe('within_6h');
    expect(scoreItem(ev, new Date(NOW.getTime() + 2 * HOUR)).band).toBe('within_2h');
  });

  it('toda tabela termina numa faixa sem limites (nunca cai no erro de tabela malformada)', () => {
    for (const w of Object.values(BRIEFING_WEIGHTS)) {
      const last = w.bands[w.bands.length - 1];
      expect(last).toBeDefined();
      expect(last?.min === undefined || last.min <= 0 || w.bands.length === 1).toBe(true);
    }
  });
});
