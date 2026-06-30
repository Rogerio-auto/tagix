import { describe, expect, it } from 'vitest';
import type { MetricValue } from '../../types';
import { readPlacar } from '../PlacarIaHumanoCard';
import { formatRoi, readRoi } from '../RoiIaCard';
import { readFunil } from '../FunilPipelineCard';

/**
 * F55-S07 — leitores puros dos 3 cards de Negócio. Ambiente `node` (sem DOM): testamos
 * a leitura segura dos shapes de S05 (Placar `{ ia, humano }`, ROI `{ receitaCents,
 * custoUsd, roi|null }`, Funil `{ rows, winRatePct|null, ... }`) e a formatação do
 * múltiplo de ROI. O roteamento do registry por cardType/metric_key é garantido pelo
 * `Record` exaustivo (typecheck) + build do Next — não renderizamos JSX aqui.
 */

describe('readPlacar', () => {
  it('lê o shape { ia, humano } de S05', () => {
    const v: MetricValue = {
      ia: { count: 12, valueCents: 340000 },
      humano: { count: 7, valueCents: 210000 },
    };
    expect(readPlacar(v)).toEqual({
      ia: { count: 12, valueCents: 340000 },
      humano: { count: 7, valueCents: 210000 },
    });
  });

  it('preenche com zero quando lados/campos faltam (sem quebrar)', () => {
    expect(readPlacar({ ia: { count: 3 } })).toEqual({
      ia: { count: 3, valueCents: 0 },
      humano: { count: 0, valueCents: 0 },
    });
    expect(readPlacar(null)).toBeNull();
  });
});

describe('readRoi / formatRoi', () => {
  it('lê receita/custo/roi e formata o múltiplo pt-BR', () => {
    const r = readRoi({ receitaCents: 320000, custoUsd: 10, roi: 3.2 });
    expect(r).toEqual({ receitaCents: 320000, custoUsd: 10, roi: 3.2 });
    expect(formatRoi(r.roi)).toBe('3,2×');
  });

  it('preserva roi null (custo 0) e renderiza estado neutro, sem número enganoso', () => {
    const r = readRoi({ receitaCents: 50000, custoUsd: 0, roi: null });
    expect(r.roi).toBeNull();
    expect(formatRoi(r.roi)).toBe('—');
  });

  it('formata inteiros com 1 casa mínima', () => {
    expect(formatRoi(10)).toBe('10,0×');
  });
});

describe('readFunil', () => {
  it('lê estágios + resumo (win rate / ciclo / fechados / ganhos)', () => {
    const v: MetricValue = {
      columns: [],
      rows: [
        { stageId: 's1', stage: 'Novo', abertos: 5, valor_aberto_cents: 100000 },
        { stageId: 's2', stage: 'Proposta', abertos: 2, valor_aberto_cents: 500000 },
      ],
      winRatePct: 40,
      cicloMedioSegundos: 86400,
      fechadosMes: 10,
      ganhosMes: 4,
    };
    const f = readFunil(v);
    expect(f.stages).toHaveLength(2);
    expect(f.stages[0]).toEqual({
      stageId: 's1',
      stage: 'Novo',
      abertos: 5,
      valorAbertoCents: 100000,
    });
    expect(f.winRatePct).toBe(40);
    expect(f.cicloMedioSegundos).toBe(86400);
    expect(f.ganhosMes).toBe(4);
    expect(f.fechadosMes).toBe(10);
  });

  it('trata null/ausência (winRate/ciclo null preservados, rows vazias)', () => {
    const f = readFunil({ rows: [], winRatePct: null, cicloMedioSegundos: null });
    expect(f.stages).toEqual([]);
    expect(f.winRatePct).toBeNull();
    expect(f.cicloMedioSegundos).toBeNull();
    expect(f.fechadosMes).toBe(0);
  });

  it('descarta linhas malformadas (sem nome de estágio)', () => {
    const f = readFunil({ rows: [{ abertos: 1 }, { stage: 'Ok', abertos: 2, valor_aberto_cents: 1 }] });
    expect(f.stages).toHaveLength(1);
    expect(f.stages[0]?.stage).toBe('Ok');
  });
});
