/**
 * F73-S12 · composição do briefing: ≤ 3 itens, overflow, desempate estável, texto por locale.
 * Puro, sem banco.
 */
import { describe, expect, it } from 'vitest';
import { BRIEFING_MAX_ITEMS, BriefingItemSchema, BriefingSchema } from '@hm/shared';
import { compose, toPublicItem } from './compose';
import { scoreItem } from './score';
import { makeTextKit, pushTitle } from './texts';
import type { BriefingCandidate, StoredBriefingItem } from './types';

const NOW = new Date('2026-10-17T13:00:00.000Z');
const DAY = 86_400_000;
const MIN = 60_000;

/** `Intl` separa a moeda do número com espaço sem quebra (U+00A0): é o texto certo; o teste normaliza. */
const norm = (text: string | undefined): string => (text ?? '').replace(/\u00a0/g, ' ');

const PT = { currency: 'BRL', locale: 'pt-BR', timezone: 'America/Sao_Paulo' } as const;
const EN = { currency: 'USD', locale: 'en-US', timezone: 'America/New_York' } as const;

function idle(over: {
  stage: string;
  value: number;
  count?: number;
  days?: number;
  reactivation?: string | null;
}): BriefingCandidate {
  const days = over.days ?? 3;
  return {
    kind: 'deals_idle',
    key: `deals_idle:${over.stage}`,
    valueAtRisk: over.value,
    urgency: days,
    oldestAt: new Date(NOW.getTime() - days * DAY),
    facts: {
      kind: 'deals_idle',
      count: over.count ?? 4,
      stageId: `00000000-0000-4000-8000-${over.stage.padStart(12, '0')}`,
      stageName: `Estágio ${over.stage}`,
      idleDaysThreshold: 3,
      maxIdleDays: days,
      avgIdleDays: days,
      reactivationStageName: over.reactivation ?? null,
    },
    refs: { stageId: over.stage },
    source: 'Pipeline',
    asOf: NOW,
  };
}

const leads = (count: number, ticket: number, waitMin: number): BriefingCandidate => ({
  kind: 'leads_waiting',
  key: 'leads_waiting',
  valueAtRisk: count * ticket,
  urgency: waitMin,
  oldestAt: new Date(NOW.getTime() - waitMin * MIN),
  facts: { kind: 'leads_waiting', count, oldestWaitingMinutes: waitMin, ticket, ticketBasis: 'won_90d' },
  refs: {},
  source: 'Caixa de entrada',
  asOf: NOW,
});

describe('compose', () => {
  it('escolhe os 3 de maior score, em ordem, e conta o resto como overflow', () => {
    const c = [
      idle({ stage: '1', value: 1_000 }),
      idle({ stage: '2', value: 9_000 }),
      idle({ stage: '3', value: 5_000 }),
      idle({ stage: '4', value: 7_000 }),
      idle({ stage: '5', value: 100 }),
    ];
    const out = compose(c, { fmt: PT, now: NOW });
    expect(out.items).toHaveLength(BRIEFING_MAX_ITEMS);
    expect(out.items.map((i) => i.id)).toEqual(['deals_idle:2', 'deals_idle:4', 'deals_idle:3']);
    expect(out.overflowCount).toBe(2);
    expect(out.items.map((i) => i.priority)).toEqual(['high', 'medium', 'low']);
  });

  it('ordena por receita em risco PONDERADA, não pelo valor bruto', () => {
    // R$ 8.000 parados há 3 dias (peso 1) perde para R$ 7.000 parados há 20 dias (peso 1,5).
    const out = compose(
      [idle({ stage: 'a', value: 8_000, days: 3 }), idle({ stage: 'b', value: 7_000, days: 20 })],
      { fmt: PT, now: NOW },
    );
    expect(out.items.map((i) => i.id)).toEqual(['deals_idle:b', 'deals_idle:a']);
  });

  it('empate de score: o registro mais antigo vem primeiro; empate total: pela chave (estável)', () => {
    const older = idle({ stage: 'x', value: 1_000, days: 5 });
    const newer = idle({ stage: 'y', value: 1_000, days: 4 });
    // Pesos iguais (faixa 3+), valores iguais: decide a idade.
    const byAge = compose([newer, older], { fmt: PT, now: NOW });
    expect(byAge.items.map((i) => i.id)).toEqual(['deals_idle:x', 'deals_idle:y']);

    const a = idle({ stage: 'aa', value: 2_000, days: 4 });
    const b = idle({ stage: 'bb', value: 2_000, days: 4 });
    expect(compose([b, a], { fmt: PT, now: NOW }).items.map((i) => i.id)).toEqual(
      compose([a, b], { fmt: PT, now: NOW }).items.map((i) => i.id),
    );
  });

  it('a ordem de entrada dos coletores não muda o resultado (determinismo)', () => {
    const c = [
      idle({ stage: '1', value: 3_000, days: 8 }),
      leads(3, 1_000, 20),
      idle({ stage: '2', value: 3_000, days: 8 }),
      idle({ stage: '3', value: 500 }),
    ];
    const one = compose(c, { fmt: PT, now: NOW });
    const two = compose([...c].reverse(), { fmt: PT, now: NOW });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('sem candidatos: nenhum item e overflow 0', () => {
    expect(compose([], { fmt: PT, now: NOW })).toEqual({ items: [], overflowCount: 0 });
  });

  it('o `why` reproduz os números do score (valor, quantidade e peso)', () => {
    const c = idle({ stage: '7', value: 31_400, days: 9, count: 4 });
    const breakdown = scoreItem(c, NOW);
    const [item] = compose([c], { fmt: PT, now: NOW }).items;
    expect(item).toBeDefined();
    const why = norm((item as StoredBriefingItem).why.join(' | '));
    expect(breakdown.weight).toBe(1.25);
    expect(why).toContain('R$');
    expect(why).toContain('31.400');
    expect(why).toContain('4 negócios');
    expect(why).toContain('9 dias');
    expect(why).toContain('×1,25');
    expect((item as StoredBriefingItem)._meta.score).toBe(breakdown.score);
    expect((item as StoredBriefingItem).value_at_risk).toBe(31_400);
  });

  it('texto em pt-BR: moeda, separador e plural do locale do workspace', () => {
    const [item] = compose([idle({ stage: '7', value: 31_400, count: 4 })], {
      fmt: PT,
      now: NOW,
    }).items;
    expect(norm(item?.title)).toBe('4 negócios sem resposta há 3+ dias · R$ 31.400 em Estágio 7');
    const [one] = compose([idle({ stage: '8', value: 900, count: 1 })], { fmt: PT, now: NOW }).items;
    expect(one?.title).toContain('1 negócio sem resposta');
  });

  it('texto em en-US: dólar, ponto e vírgula, frases em inglês', () => {
    const [item] = compose([idle({ stage: '7', value: 31_400, count: 4 })], {
      fmt: EN,
      now: NOW,
    }).items;
    expect(norm(item?.title)).toBe('4 deals with no reply for 3+ days · $31,400 in Estágio 7');
    expect(item?.why.join(' ')).toContain('across 4 deals');
    expect(item?.why.join(' ')).toContain('weight ×1');
    const [one] = compose([idle({ stage: '8', value: 900, count: 1 })], { fmt: EN, now: NOW }).items;
    expect(one?.title).toContain('1 deal with no reply');
  });

  it('push da manhã: "Briefing do dia: 3 itens" (pt-BR) e "Daily briefing: 3 items" (en-US)', () => {
    expect(pushTitle(makeTextKit(PT), 3)).toBe('Briefing do dia: 3 itens');
    expect(pushTitle(makeTextKit(PT), 1)).toBe('Briefing do dia: 1 item');
    expect(pushTitle(makeTextKit(EN), 3)).toBe('Daily briefing: 3 items');
  });

  it('locale inválido no banco não derruba a composição (cai no padrão)', () => {
    const [item] = compose([idle({ stage: '1', value: 1_000 })], {
      fmt: { currency: 'BRL', locale: 'xx-INVALID-zz', timezone: 'UTC' },
      now: NOW,
    }).items;
    expect(item?.title).toBeTruthy();
  });

  it('ação: `ask` com o pedido pronto quando há estágio de reativação; senão `navigate`', () => {
    const [withTarget] = compose([idle({ stage: '1', value: 1_000, reactivation: 'Reativação' })], {
      fmt: PT,
      now: NOW,
    }).items;
    expect(withTarget?.action.kind).toBe('ask');
    expect(withTarget?.action.value).toBe(
      'Mover os negócios parados há 3 dias ou mais em Estágio 1 para Reativação',
    );
    expect(withTarget?.action).toMatchObject({ label: 'Mover para Reativação' });

    const [nav] = compose([idle({ stage: '2', value: 1_000 })], { fmt: PT, now: NOW }).items;
    expect(nav?.action.kind).toBe('navigate');
    expect(nav?.action.value).toBe('/pipeline?stage=00000000-0000-4000-8000-000000000002');
  });

  it('todo item respeita o contrato público (BriefingItemSchema) e o briefing inteiro (BriefingSchema)', () => {
    const c = [
      idle({ stage: '1', value: 12_000, days: 15, reactivation: 'Reativação' }),
      leads(5, 2_100, 33),
      idle({ stage: '2', value: 4_000 }),
      idle({ stage: '3', value: 1_000 }),
    ];
    const out = compose(c, { fmt: PT, now: NOW });
    for (const item of out.items) {
      expect(() => BriefingItemSchema.parse(toPublicItem(item))).not.toThrow();
    }
    expect(() =>
      BriefingSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        for_date: '2026-10-17',
        generated_at: NOW.toISOString(),
        data_as_of: NOW.toISOString(),
        status: 'ready',
        currency: 'BRL',
        items: out.items.map(toPublicItem),
        overflow_count: out.overflowCount,
        resolved_count: 0,
        seen_at: null,
      }),
    ).not.toThrow();
  });

  it('lead esperando: conversa/conversas e a conta do ticket no `why`', () => {
    const [item] = compose([leads(3, 2_100, 42)], { fmt: PT, now: NOW }).items;
    expect(item?.title).toBe('3 conversas esperando resposta, a mais antiga há 42 min');
    expect(norm(item?.why[0])).toContain('3 × ticket médio de R$ 2.100');
    expect(item?.why[1]).toContain('×1,5');
    expect(item?.value_at_risk).toBe(6_300);
  });
});
