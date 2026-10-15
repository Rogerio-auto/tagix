import { describe, expect, it } from 'vitest';
import { formatTotals, openDeals, stageAge, sumByCurrency } from './format';
import type { Deal, Stage } from './types';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function deal(over: Partial<Deal>): Deal {
  return {
    id: 'd1',
    pipelineId: 'p1',
    stageId: 's1',
    contactId: 'c1',
    title: 'Negócio',
    valueCents: 0,
    currency: 'BRL',
    ownerId: null,
    position: 0,
    customFields: {},
    closedAt: null,
    closedWon: null,
    ...over,
  };
}

function stage(over: Partial<Stage>): Stage {
  return {
    id: 's1',
    pipelineId: 'p1',
    name: 'Lead',
    color: 'var(--info)',
    icon: null,
    position: 0,
    isWon: false,
    isLost: false,
    probability: null,
    automationRules: [],
    transitionRules: {},
    ...over,
  };
}

describe('stageAge', () => {
  it('sem datas devolve null (o card não inventa tempo)', () => {
    expect(stageAge({}, NOW)).toBeNull();
    expect(stageAge({ updatedAt: 'lixo' }, NOW)).toBeNull();
  });

  it('usa updatedAt e cai em createdAt', () => {
    const a = stageAge({ updatedAt: new Date(NOW - 3 * DAY).toISOString() }, NOW);
    expect(a?.short).toBe('3d');
    const b = stageAge({ updatedAt: null, createdAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW);
    expect(b?.short).toBe('5h');
  });

  it('abaixo de 1h e relógio adiantado não ficam negativos', () => {
    expect(stageAge({ updatedAt: new Date(NOW - 10 * 60_000).toISOString() }, NOW)?.short).toBe('<1h');
    expect(stageAge({ updatedAt: new Date(NOW + DAY).toISOString() }, NOW)?.short).toBe('<1h');
  });

  it('marca como parado a partir de 7 dias e passa a semanas a partir de 14', () => {
    expect(stageAge({ updatedAt: new Date(NOW - 6 * DAY).toISOString() }, NOW)?.stale).toBe(false);
    expect(stageAge({ updatedAt: new Date(NOW - 7 * DAY).toISOString() }, NOW)?.stale).toBe(true);
    const long = stageAge({ updatedAt: new Date(NOW - 15 * DAY).toISOString() }, NOW);
    expect(long?.short).toBe('2sem');
    expect(long?.long).toBe('2 semanas');
  });
});

describe('totais por moeda', () => {
  it('soma só valores positivos e nunca mistura moedas', () => {
    const deals = [
      deal({ id: 'a', valueCents: 1000 }),
      deal({ id: 'b', valueCents: 2500 }),
      deal({ id: 'c', valueCents: 0 }),
      deal({ id: 'd', valueCents: 700, currency: 'USD' }),
    ];
    const totals = sumByCurrency(deals);
    expect(totals.get('BRL')).toBe(3500);
    expect(totals.get('USD')).toBe(700);
    expect(totals.size).toBe(2);
  });

  it('sem valor devolve null', () => {
    expect(formatTotals([deal({ valueCents: 0 })])).toBeNull();
  });

  it('uma moeda gera um único total; duas geram duas partes', () => {
    expect(formatTotals([deal({ valueCents: 1000 })])?.split(' · ')).toHaveLength(1);
    expect(
      formatTotals([deal({ valueCents: 1000 }), deal({ id: 'x', valueCents: 5, currency: 'USD' })])?.split(' · '),
    ).toHaveLength(2);
  });

  it('moeda inválida não derruba o card', () => {
    expect(formatTotals([deal({ valueCents: 1000, currency: 'xx' })])).toContain('10.00');
  });
});

describe('openDeals', () => {
  it('exclui etapas de ganho e perda', () => {
    const stages = [stage({ id: 's1' }), stage({ id: 'won', isWon: true }), stage({ id: 'lost', isLost: true })];
    const deals = [deal({ id: 'a', stageId: 's1' }), deal({ id: 'b', stageId: 'won' }), deal({ id: 'c', stageId: 'lost' })];
    expect(openDeals(deals, stages).map((d) => d.id)).toEqual(['a']);
  });
});
