import { describe, expect, it } from 'vitest';
import {
  alertCopy,
  attentionCopy,
  alertHref,
  comparisonLabel,
  periodFromPreference,
  sampleText,
  buildChartGeometry,
  buildHeadline,
  firstName,
  formatKpiValue,
  formatRevenue,
  formatSpeed,
  greetingForHour,
  isHomeEmpty,
  kpiDelta,
  monotonePath,
} from './home-format';
import type { HomeAttentionItem, HomeKpi, HomePayload } from './types';

const kpi = (over: Partial<HomeKpi>): HomeKpi => ({
  key: 'leads',
  unit: 'count',
  value: 10,
  previous: 8,
  betterWhen: 'higher',
  href: '/contacts',
  sample: null,
  ...over,
});

const item = (over: Partial<HomeAttentionItem>): HomeAttentionItem => ({
  kind: 'waiting_sla',
  severity: 'warning',
  count: 1,
  oldestMinutes: null,
  href: '/x',
  targetId: null,
  ...over,
});

function payload(over: Partial<HomePayload> = {}): HomePayload {
  return {
    scope: 'workspace',
    role: 'OWNER',
    periodDays: 30,
    window: {
      from: '2026-08-16T12:00:00.000Z',
      to: '2026-09-15T12:00:00.000Z',
      previousFrom: '2026-07-17T12:00:00.000Z',
      previousTo: '2026-08-16T12:00:00.000Z',
    },
    thresholds: { slaMinutes: 15, slaSource: 'default', stalledDays: 7, mediaFailedDays: 7 },
    kpis: [],
    attention: [],
    journey: null,
    revenueSeries: null,
    serverTime: '2026-09-15T12:00:00.000Z',
    ...over,
  };
}

describe('formatSpeed', () => {
  it.each([
    [41, '00:41'],
    [0, '00:00'],
    [605, '10:05'],
    [3900, '1h 05m'],
  ])('%is -> %s', (s, text) => {
    expect(formatSpeed(s)).toBe(text);
  });
  it('sem amostra vira travessão, nunca 00:00', () => {
    expect(formatSpeed(null)).toBe('—');
  });
});

describe('formatKpiValue', () => {
  it('null é travessão (receita desconhecida não é zero)', () => {
    expect(formatKpiValue({ unit: 'cents', value: null })).toBe('—');
  });
  it('receita em reais inteiros, sem centavos', () => {
    const text = formatRevenue(18_420_000);
    expect(text).toContain('184.200');
    expect(text).not.toMatch(/,00$/);
  });
  it('contagem e velocidade', () => {
    expect(formatKpiValue({ unit: 'count', value: 1234 })).toBe('1.234');
    expect(formatKpiValue({ unit: 'seconds', value: 41 })).toBe('00:41');
  });
});

describe('kpiDelta', () => {
  it('subir é bom quando mais é melhor', () => {
    const d = kpiDelta(kpi({ value: 12, previous: 10 }));
    expect(d.direction).toBe('up');
    expect(d.tone).toBe('good');
    expect(d.text).toContain('20');
  });
  it('subir é ruim quando menos é melhor', () => {
    const d = kpiDelta(kpi({ unit: 'seconds', value: 90, previous: 60, betterWhen: 'lower' }));
    expect(d.tone).toBe('bad');
    expect(d.text).toBe('30s mais lento');
  });
  it('speed-to-lead caindo é melhora ("18s mais rápido")', () => {
    const d = kpiDelta(kpi({ unit: 'seconds', value: 41, previous: 59, betterWhen: 'lower' }));
    expect(d).toMatchObject({ direction: 'down', tone: 'good', text: '18s mais rápido' });
  });
  it('sem base de comparação não inventa porcentagem', () => {
    expect(kpiDelta(kpi({ previous: null })).direction).toBe('none');
    expect(kpiDelta(kpi({ value: null })).direction).toBe('none');
    const novo = kpiDelta(kpi({ value: 5, previous: 0 }));
    expect(novo.text).toBe('Sem base anterior');
    expect(novo.tone).toBe('neutral');
  });
  it('variação menor que 0,1% é "igual"', () => {
    expect(kpiDelta(kpi({ value: 10_000, previous: 10_001 })).direction).toBe('flat');
  });
});

describe('buildHeadline', () => {
  it('diz que a receita caiu quando caiu', () => {
    const h = buildHeadline(
      payload({
        kpis: [
          kpi({ key: 'revenue', unit: 'cents', value: 8_000, previous: 10_000 }),
          kpi({ key: 'leads', value: 3 }),
        ],
      }),
    );
    expect(h).toContain('caiu 20%');
    expect(h).toContain('3 leads novos entraram');
  });
  it('diz que subiu quando subiu', () => {
    const h = buildHeadline(
      payload({ kpis: [kpi({ key: 'revenue', unit: 'cents', value: 12_000, previous: 10_000 })] }),
    );
    expect(h).toContain('subiu 20%');
  });
  it('sem receita comparável, compara os leads', () => {
    const h = buildHeadline(
      payload({
        kpis: [
          kpi({ key: 'revenue', unit: 'cents', value: null, previous: null }),
          kpi({ key: 'leads', value: 12, previous: 10 }),
        ],
      }),
    );
    expect(h).toBe('12 leads novos em 30\u00a0dias, 20% a mais que no período anterior.');
  });
  it('sem comparação, fala do volume', () => {
    const h = buildHeadline(
      payload({
        kpis: [
          kpi({ key: 'revenue', unit: 'cents', value: null, previous: null }),
          kpi({ key: 'leads', value: 1, previous: null }),
        ],
      }),
    );
    expect(h).toBe('1 lead novo em 30\u00a0dias.');
  });
  it('empresa nova não ganha manchete inventada', () => {
    expect(buildHeadline(payload({ kpis: [kpi({ value: 0 })] }))).toContain(
      'assim que houver atividade',
    );
  });
  it('escopo pessoal fala da fila do atendente', () => {
    const p = payload({
      scope: 'personal',
      kpis: [kpi({ key: 'waiting_mine', value: 3, previous: null, betterWhen: 'lower' })],
    });
    expect(buildHeadline(p)).toBe('3 conversas esperam por você.');
  });
});

describe('isHomeEmpty', () => {
  it('vazio quando nada aconteceu', () => {
    expect(
      isHomeEmpty(payload({ kpis: [kpi({ value: 0 }), kpi({ key: 'revenue', value: null })] })),
    ).toBe(true);
  });
  it('não é vazio com um item de atenção ou um número', () => {
    expect(
      isHomeEmpty(
        payload({
          kpis: [kpi({ value: 0 })],
          attention: [item({ kind: 'media_failed', severity: 'info', href: '/' })],
        }),
      ),
    ).toBe(false);
    expect(isHomeEmpty(payload({ kpis: [kpi({ value: 4 })] }))).toBe(false);
  });
});

describe('attentionCopy', () => {
  const t = {
    slaMinutes: 15,
    slaSource: 'default',
    stalledDays: 7,
    mediaFailedDays: 7,
  } as const;
  it('cita a régua usada pelo servidor e o mais antigo', () => {
    const c = attentionCopy(item({ count: 3, oldestMinutes: 125 }), t);
    expect(c.title).toBe('3 conversas esperando há mais de 15\u00a0min');
    expect(c.time).toBe('2\u00a0h');
    expect(c.action).toBe('Abrir fila');
  });
  it('uma conversa só: a ação é responder (o servidor já manda a conversa)', () => {
    expect(attentionCopy(item({ count: 1, oldestMinutes: 20 }), t).action).toBe('Responder');
  });
  it('diz quando a régua é a regra de SLA da empresa', () => {
    const c = attentionCopy(item({ count: 2 }), {
      ...t,
      slaSource: 'workspace_rule',
      slaMinutes: 5,
    });
    expect(c.title).toContain('há mais de 5\u00a0min');
    expect(c.context).toContain('SLA');
  });
  it('mídia que falhou cita a janela do servidor', () => {
    const c = attentionCopy(item({ kind: 'media_failed', severity: 'info', count: 2 }), {
      ...t,
      mediaFailedDays: 3,
    });
    expect(c.context).toBe('Inbox · últimos 3\u00a0dias');
  });
  it('login da Meta vencido tem texto próprio', () => {
    const c = attentionCopy(
      item({ kind: 'channel_down', severity: 'critical', count: 1, href: '/settings/meta' }),
      t,
    );
    expect(c.title).toBe('O acesso à Meta expirou');
    expect(c.action).toBe('Reconectar');
  });
  it('singular e plural', () => {
    const one = attentionCopy(item({ kind: 'deals_stalled', href: '/pipeline' }), t);
    expect(one.title).toBe('1 negócio parado há mais de 7\u00a0dias');
    const many = attentionCopy(
      item({ kind: 'channel_down', severity: 'critical', count: 2, href: '/settings/channels' }),
      t,
    );
    expect(many.title).toBe('2 conexões de canal caíram');
  });
});

describe('alertHref', () => {
  it('leva cada alerta ao lugar onde se age', () => {
    expect(alertHref({ metricKey: 'cap_mensal_consumido_pct' })).toBe('/settings/usage');
    expect(alertHref({ metricKey: 'sla_violado_hoje' })).toBe('/conversations?status=open');
  });
  it('alerta desconhecido leva ao painel completo, não recarrega a Home', () => {
    expect(alertHref({ metricKey: 'novo_alerta' })).toBe('#home-painel');
    expect(alertCopy({ metricKey: 'novo_alerta' }).action).toBe('Ver');
    expect(alertCopy({ metricKey: 'sla_violado_hoje' }).context).toContain('SLA');
  });
});

describe('saudação', () => {
  it('muda ao longo do dia', () => {
    expect(greetingForHour(8)).toBe('Bom dia');
    expect(greetingForHour(14)).toBe('Boa tarde');
    expect(greetingForHour(21)).toBe('Boa noite');
    expect(greetingForHour(2)).toBe('Boa madrugada');
  });
  it('primeiro nome', () => {
    expect(firstName('Ana Paula QA')).toBe('Ana');
    expect(firstName('')).toBe('');
    expect(firstName(undefined)).toBe('');
  });
});

describe('geometria do gráfico', () => {
  const series = [0, 100, 50, 200].map((valueCents, i) => ({
    day: `2026-09-0${i + 1}`,
    valueCents,
  }));

  it('inverte o eixo y: o maior valor fica no topo', () => {
    const g = buildChartGeometry(series, 300, 100, 10);
    const ys = g.points.map((p) => p.y);
    expect(Math.min(...ys)).toBe(10);
    expect(Math.max(...ys)).toBe(90);
    expect(g.points[3]?.y).toBe(10);
    expect(g.max).toBe(200);
    expect(g.total).toBe(350);
  });
  it('a área fecha na base', () => {
    const g = buildChartGeometry(series, 300, 100, 10);
    expect(g.line.startsWith('M0.00')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
    expect(g.area).toContain('L300.00 100.00');
  });
  it('série zerada é uma reta na base', () => {
    const g = buildChartGeometry(
      [
        { day: 'a', valueCents: 0 },
        { day: 'b', valueCents: 0 },
      ],
      100,
      50,
      5,
    );
    expect(g.points.every((p) => p.y === 45)).toBe(true);
  });
  it('monotonePath não passa de um ponto nem quebra sem pontos', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1.00 2.00');
  });
  it('curva monótona não ultrapassa os extremos da série', () => {
    const g = buildChartGeometry(series, 300, 100, 10);
    const nums = (g.line.match(/-?\d+\.\d+/g) ?? []).map(Number);
    // Pares x,y: todos os y ficam dentro do viewBox útil.
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10 - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(90 + 0.01);
  });
});

describe('janela e amostra', () => {
  it('o período padrão salvo (F8) escolhe a janela inicial', () => {
    expect(periodFromPreference('7d')).toBe(7);
    expect(periodFromPreference('90d')).toBe(90);
    // Janelas que a Home não tem (mês/ano corrente) e nada salvo: 30 dias.
    expect(periodFromPreference('mtd')).toBe(30);
    expect(periodFromPreference('14d')).toBe(30);
    expect(periodFromPreference(null)).toBe(30);
  });
  it('rótulo da comparação traz as duas pontas da janela anterior', () => {
    const label = comparisonLabel(payload().window);
    expect(label.startsWith('vs. ')).toBe(true);
    expect(label).toContain('–');
    expect(label).toContain('17');
    expect(label).toContain('16');
  });
  it('amostra do speed-to-lead: respondidas e sem resposta', () => {
    expect(sampleText(null)).toBeNull();
    expect(sampleText({ answered: 42, unanswered: 3 })).toBe('42 respondidas · 3 sem resposta');
    expect(sampleText({ answered: 1, unanswered: 0 })).toBe('1 respondida');
    expect(sampleText({ answered: 0, unanswered: 2 })).toBe('Nenhuma respondida · 2 sem resposta');
    expect(sampleText({ answered: 0, unanswered: 0 })).toBe('Nenhuma conversa nova no período');
  });
});
