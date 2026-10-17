/**
 * F73-S06 · previsão de receita: casos pequenos CALCULADOS À MÃO + propriedades.
 *
 * Cenário base (um funil P, 3 estágios, 6 negócios abertos, R$ 3.000 já fechados):
 *
 *   estágio  decididos (ganhos/perdidos)  p            abertos
 *   A        6 / 4  = 10 (cumpre o piso)  6/10 = 0,6   1.000 e 2.000
 *   B        3 / 6  =  9 (abaixo do piso) usa o funil  4.000 e 500
 *   C        9 / 1  = 10 (cumpre o piso)  9/10 = 0,9   10.000 e 5.000
 *   funil P  30 / 70 = 100                 0,3
 *
 *   esperado  A = 3.000 × 0,6 = 1.800 · B = 4.500 × 0,3 = 1.350 · C = 15.000 × 0,9 = 13.500
 *   previsto  = 3.000 + 1.800 + 1.350 + 13.500 = 19.650
 *   variância A = (1.000² + 2.000²) × 0,6 × 0,4 = 5.000.000 × 0,24 = 1.200.000
 *             B = (4.000² + 500²) × 0,3 × 0,7  = 16.250.000 × 0,21 = 3.412.500
 *             C = (10.000² + 5.000²) × 0,9 × 0,1 = 125.000.000 × 0,09 = 11.250.000
 *             Σ = 15.862.500 → √ ≈ 3.982,77 → × 1,28 ≈ 5.097,95
 *   intervalo [19.650 − 5.097,95 ; 19.650 + 5.097,95] = [14.552,05 ; 24.747,95]
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateOpenDeals,
  computeForecast,
  explainForecast,
  MIN_DECIDED,
  stageProbability,
  Z_80,
  type DecidedStat,
  type ForecastInput,
} from './forecast';

const P = 'pipeline-p';
const stages = {
  a: { id: 'stage-a', name: 'Qualificação' },
  b: { id: 'stage-b', name: 'Proposta' },
  c: { id: 'stage-c', name: 'Negociação' },
} as const;

function open(values: { a: number[]; b: number[]; c: number[] }) {
  return aggregateOpenDeals(
    (Object.keys(stages) as (keyof typeof stages)[]).flatMap((k) =>
      values[k].map((value) => ({
        stageId: stages[k].id,
        pipelineId: P,
        stageName: stages[k].name,
        value,
      })),
    ),
  );
}

function base(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    closed: 3000,
    open: open({ a: [1000, 2000], b: [4000, 500], c: [10000, 5000] }),
    stageStats: new Map<string, DecidedStat>([
      [stages.a.id, { won: 6, lost: 4 }],
      [stages.b.id, { won: 3, lost: 6 }],
      [stages.c.id, { won: 9, lost: 1 }],
    ]),
    pipelineStats: new Map<string, DecidedStat>([[P, { won: 30, lost: 70 }]]),
    ...over,
  };
}

const fakeFormat = {
  money: (n: number) => `R$${Math.round(n)}`,
  percent: (f: number) => `${Math.round(f * 100)}%`,
  count: (n: number) => String(n),
};

describe('probabilidade do estágio', () => {
  it('usa o estágio com 10 decididos e cai para o funil com 9', () => {
    expect(MIN_DECIDED).toBe(10);
    expect(stageProbability({ won: 6, lost: 4 }, { won: 30, lost: 70 })).toEqual({
      p: 0.6,
      basis: 'stage',
      decided: 10,
    });
    expect(stageProbability({ won: 3, lost: 6 }, { won: 30, lost: 70 })).toEqual({
      p: 0.3,
      basis: 'pipeline',
      decided: 100,
    });
  });

  it('estágio sem histórico usa o funil; funil sem histórico dá p = 0 e diz que não há base', () => {
    expect(stageProbability(undefined, { won: 1, lost: 3 })).toEqual({
      p: 0.25,
      basis: 'pipeline',
      decided: 4,
    });
    expect(stageProbability(undefined, undefined)).toEqual({ p: 0, basis: 'none', decided: 0 });
    expect(stageProbability({ won: 0, lost: 0 }, { won: 0, lost: 0 })).toEqual({
      p: 0,
      basis: 'none',
      decided: 0,
    });
  });

  it('o piso é inclusivo: 10 decididos com 5 ganhos valem 0,5, 9 decididos caem para o funil', () => {
    expect(stageProbability({ won: 5, lost: 5 }, { won: 30, lost: 70 }).p).toBe(0.5);
    expect(stageProbability({ won: 5, lost: 4 }, { won: 30, lost: 70 }).p).toBe(0.3);
  });
});

describe('previsão: cenário calculado à mão (3 estágios, 6 negócios)', () => {
  const f = computeForecast(base());

  it('previsto = fechado + Σ valor × p', () => {
    expect(f.closed).toBe(3000);
    expect(f.openValue).toBe(22_500);
    expect(f.predicted).toBeCloseTo(19_650, 6);
  });

  it('componentes ordenados do maior para o menor, com os esperados calculados à mão', () => {
    expect(f.components.map((c) => c.stageId)).toEqual([stages.c.id, stages.a.id, stages.b.id]);
    expect(f.components.map((c) => c.expected)).toEqual([
      expect.closeTo(13_500, 6),
      expect.closeTo(1_800, 6),
      expect.closeTo(1_350, 6),
    ]);
    expect(f.components.map((c) => c.probability.basis)).toEqual(['stage', 'stage', 'pipeline']);
  });

  it('intervalo de 80% = ± 1,28 × √Σ v²·p·(1−p)', () => {
    expect(f.components.map((c) => c.variance)).toEqual([
      expect.closeTo(11_250_000, 3),
      expect.closeTo(1_200_000, 3),
      expect.closeTo(3_412_500, 3),
    ]);
    const spread = Z_80 * Math.sqrt(15_862_500);
    expect(spread).toBeCloseTo(5_097.95, 1);
    expect(f.low).toBeCloseTo(19_650 - spread, 6);
    expect(f.high).toBeCloseTo(19_650 + spread, 6);
    expect(f.low).toBeCloseTo(14_552.05, 1);
    expect(f.high).toBeCloseTo(24_747.95, 1);
  });

  it('o piso de 10 decididos muda o resultado: B com 10 decididos (5/5) passa a valer 0,5', () => {
    const withFloor = computeForecast(
      base({
        stageStats: new Map<string, DecidedStat>([
          [stages.a.id, { won: 6, lost: 4 }],
          [stages.b.id, { won: 5, lost: 5 }],
          [stages.c.id, { won: 9, lost: 1 }],
        ]),
      }),
    );
    // B: 4.500 × 0,5 = 2.250 em vez de 1.350 → previsto 20.550.
    expect(withFloor.predicted).toBeCloseTo(20_550, 6);
    expect(withFloor.components.find((c) => c.stageId === stages.b.id)?.probability.basis).toBe(
      'stage',
    );
  });

  it('why[]: os 3 maiores componentes, em português, com os números do cálculo', () => {
    const why = explainForecast(f, fakeFormat);
    expect(why).toHaveLength(3);
    expect(why[0]).toBe(
      'Negociação: 2 negócios somam R$15000; 90% de chance (neste estágio, 10 decididos em 180 dias), esperado R$13500',
    );
    expect(why[2]).toBe(
      'Proposta: 2 negócios somam R$4500; 30% de chance (média do funil, 100 decididos em 180 dias), esperado R$1350',
    );
    for (const line of why) expect(line.length).toBeLessThanOrEqual(200);
  });
});

describe('previsão: limites naturais', () => {
  it('o teto é fechado + Σ aberto e o piso é o fechado', () => {
    const f = computeForecast({
      closed: 0,
      open: aggregateOpenDeals([{ stageId: 'x', pipelineId: P, stageName: 'X', value: 1000 }]),
      stageStats: new Map([['x', { won: 99, lost: 1 }]]),
      pipelineStats: new Map(),
    });
    // p = 0,99 · previsto 990 · variância 1.000.000 × 0,99 × 0,01 = 9.900 · ± 1,28 × 99,4987 = 127,36
    expect(f.predicted).toBeCloseTo(990, 6);
    expect(f.high).toBe(1000); // 990 + 127,36 passaria do valor do negócio
    expect(f.low).toBeCloseTo(990 - 1.28 * Math.sqrt(9900), 6);
  });

  it('sem nenhum histórico: previsto = fechado e o componente avisa que não há base', () => {
    const f = computeForecast({
      closed: 500,
      open: aggregateOpenDeals([{ stageId: 'x', pipelineId: P, stageName: 'X', value: 1000 }]),
      stageStats: new Map(),
      pipelineStats: new Map(),
    });
    expect(f.predicted).toBe(500);
    expect(f.low).toBe(500);
    expect(f.high).toBe(500);
    expect(explainForecast(f, fakeFormat)[0]).toContain('sem histórico');
  });

  it('sem negócios abertos: só o fechado, sem componentes', () => {
    const f = computeForecast({ ...base({ open: [] }) });
    expect(f.predicted).toBe(3000);
    expect(f.components).toEqual([]);
    expect(explainForecast(f, fakeFormat)).toEqual([]);
  });
});

describe('previsão: propriedades (casos pseudoaleatórios determinísticos)', () => {
  // mulberry32: gerador fixo, o teste não muda de uma execução para outra.
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('fechado ≤ piso ≤ previsto ≤ teto ≤ fechado + aberto; previsto = fechado + Σ esperado', () => {
    const rand = rng(73_006);
    for (let i = 0; i < 300; i++) {
      const nDeals = 1 + Math.floor(rand() * 12);
      const deals = Array.from({ length: nDeals }, () => ({
        stageId: `s${Math.floor(rand() * 4)}`,
        pipelineId: 'p',
        stageName: 'E',
        value: (Math.round(rand() * 20_000) / 100) * 100,
      }));
      const stageStats = new Map<string, DecidedStat>(
        [0, 1, 2, 3].map((k) => [
          `s${k}`,
          { won: Math.floor(rand() * 15), lost: Math.floor(rand() * 15) },
        ]),
      );
      const pipelineStats = new Map<string, DecidedStat>([
        ['p', { won: Math.floor(rand() * 60), lost: Math.floor(rand() * 60) }],
      ]);
      const closed = Math.round(rand() * 50_000);
      const f = computeForecast({
        closed,
        open: aggregateOpenDeals(deals),
        stageStats,
        pipelineStats,
      });
      const sumExpected = f.components.reduce((s, c) => s + c.expected, 0);
      expect(f.predicted).toBeCloseTo(closed + sumExpected, 6);
      expect(f.low).toBeGreaterThanOrEqual(closed - 1e-9);
      expect(f.low).toBeLessThanOrEqual(f.predicted + 1e-9);
      expect(f.high).toBeGreaterThanOrEqual(f.predicted - 1e-9);
      expect(f.high).toBeLessThanOrEqual(closed + f.openValue + 1e-9);
      for (let k = 1; k < f.components.length; k++) {
        const prev = f.components[k - 1];
        const cur = f.components[k];
        expect((prev?.expected ?? 0) >= (cur?.expected ?? 0)).toBe(true);
      }
      expect(explainForecast(f, fakeFormat).length).toBeLessThanOrEqual(3);
    }
  });

  it('p = 1 não tem variância (intervalo colapsa no previsto) e dobrar os valores dobra o esperado', () => {
    const sure = computeForecast({
      closed: 0,
      open: aggregateOpenDeals([{ stageId: 'x', pipelineId: P, stageName: 'X', value: 700 }]),
      stageStats: new Map([['x', { won: 12, lost: 0 }]]),
      pipelineStats: new Map(),
    });
    expect(sure.predicted).toBe(700);
    expect(sure.low).toBe(700);
    expect(sure.high).toBe(700);

    const single = computeForecast(base());
    const doubled = computeForecast(
      base({
        closed: 0,
        open: open({ a: [2000, 4000], b: [8000, 1000], c: [20_000, 10_000] }),
      }),
    );
    expect(doubled.predicted).toBeCloseTo(2 * (single.predicted - 3000), 6);
  });
});
