import { describe, expect, it } from 'vitest';
import {
  addWindow,
  applyHoursPreset,
  copyDayToActiveDays,
  describeDuration,
  describeHours,
  detectHoursPreset,
  effectiveRate,
  emptyDeliveryStep,
  forecastDelivery,
  fromStoredDelivery,
  nextOptionIndex,
  quickSchedules,
  toDeliveryPayload,
  toggleDay,
  updateWindow,
  validateDelivery,
  windowsForDay,
  type DeliveryContext,
  type DeliveryStepValue,
} from './model';

// Quarta, 07/10/2026, 10:00 em Brasília.
const NOW = new Date('2026-10-07T13:00:00Z');

const CONTEXT: DeliveryContext = {
  audience: 1_200,
  quality: 'GREEN',
  providerDailyLimit: 10_000,
  mode: 'single',
};

function value(patch: Partial<DeliveryStepValue> = {}): DeliveryStepValue {
  return { ...emptyDeliveryStep('America/Sao_Paulo'), ...patch };
}

describe('padrões', () => {
  it('começa com Enviar agora, horário comercial e ritmo recomendado', () => {
    const v = value();
    expect(v.start).toBe('now');
    expect(detectHoursPreset(v)).toBe('business');
    expect(v.pace).toBe('recommended');
    expect(validateDelivery(v, NOW)).toEqual([]);
  });
});

describe('agendar', () => {
  it('exige data, recusa passado e aceita futuro', () => {
    expect(validateDelivery(value({ start: 'scheduled' }), NOW).map((i) => i.code)).toEqual([
      'schedule_missing',
    ]);
    expect(
      validateDelivery(
        value({ start: 'scheduled', scheduleDate: '2026-10-07', scheduleTime: '09:00' }),
        NOW,
      ).map((i) => i.code),
    ).toEqual(['schedule_past']);
    expect(
      validateDelivery(
        value({ start: 'scheduled', scheduleDate: '2026-10-08', scheduleTime: '09:00' }),
        NOW,
      ),
    ).toEqual([]);
  });

  it('o payload grava o instante do fuso escolhido, não o do navegador', () => {
    const p = toDeliveryPayload(
      value({
        start: 'scheduled',
        scheduleDate: '2026-10-08',
        scheduleTime: '09:00',
        timezone: 'America/Manaus',
      }),
      NOW,
    );
    expect(p?.startAt).toBe('2026-10-08T13:00:00.000Z');
    expect(p?.timezone).toBe('America/Manaus');
    expect(p?.sendWindows.timezone).toBe('America/Manaus');
  });

  it('atalhos "amanhã" e "próxima segunda" são no fuso da campanha', () => {
    const quick = quickSchedules(NOW, 'America/Sao_Paulo');
    expect(quick.map((q) => q.date)).toEqual(['2026-10-08', '2026-10-12']);
  });

  it('DST: horário inexistente vira aviso (não erro) e o payload usa o instante empurrado', () => {
    const v = value({
      start: 'scheduled',
      scheduleDate: '2027-03-14',
      scheduleTime: '02:30',
      timezone: 'America/New_York',
    });
    expect(validateDelivery(v, NOW)).toEqual([]);
    expect(toDeliveryPayload(v, NOW)?.startAt).toBe('2027-03-14T07:30:00.000Z');
    const f = forecastDelivery(v, CONTEXT, NOW);
    expect(f.notices.map((n) => n.code)).toContain('schedule_gap');
  });

  it('DST: horário repetido avisa que vale a primeira vez', () => {
    const v = value({
      start: 'scheduled',
      scheduleDate: '2026-11-01',
      scheduleTime: '01:30',
      timezone: 'America/New_York',
    });
    expect(toDeliveryPayload(v, NOW)?.startAt).toBe('2026-11-01T05:30:00.000Z');
    expect(forecastDelivery(v, CONTEXT, NOW).notices.map((n) => n.code)).toContain(
      'schedule_ambiguous',
    );
  });
});

describe('fuso inválido', () => {
  it('bloqueia o avanço, não gera payload e não estima', () => {
    const v = value({ timezone: 'Mars/Olympus_Mons' });
    expect(validateDelivery(v, NOW).map((i) => i.code)).toEqual(['timezone_invalid']);
    expect(toDeliveryPayload(v, NOW)).toBeNull();
    expect(forecastDelivery(v, CONTEXT, NOW).estimate).toBeNull();
  });

  it('com agendamento, aponta só o fuso (não "data inválida" de tabela)', () => {
    const v = value({
      timezone: 'Nope/Nope',
      start: 'scheduled',
      scheduleDate: '2026-10-08',
      scheduleTime: '09:00',
    });
    expect(validateDelivery(v, NOW).map((i) => i.code)).toEqual(['timezone_invalid']);
  });

  it('vindo do rascunho é preservado (não troca em silêncio)', () => {
    const v = fromStoredDelivery({
      timezone: 'Nope/Nope',
      startAt: null,
      endAt: null,
      sendWindows: { enabled: false },
      rateLimitPerMinute: 30,
      dailyLimit: null,
    });
    expect(v.timezone).toBe('Nope/Nope');
  });
});

describe('horários', () => {
  it('presets ida e volta; editar uma faixa vira personalizado', () => {
    const v = applyHoursPreset(value(), 'business_saturday');
    expect(detectHoursPreset(v)).toBe('business_saturday');
    const sat = windowsForDay(v, 6)[0];
    expect(sat).toBeDefined();
    if (!sat) return;
    const edited = updateWindow(v, sat.key, { end: '12:00' });
    expect(detectHoursPreset(edited)).toBe('custom');
    expect(describeHours(edited)).toBe('Seg a sex, 9h às 18h · Sáb, 9h às 12h');
  });

  it('"Qualquer horário" desliga sem apagar a grade e avisa sobre madrugada', () => {
    const v = applyHoursPreset(value(), 'anytime');
    expect(v.hoursEnabled).toBe(false);
    expect(v.windows.length).toBeGreaterThan(0);
    expect(toDeliveryPayload(v, NOW)?.sendWindows).toEqual({
      enabled: false,
      timezone: 'America/Sao_Paulo',
      windows: [],
    });
    expect(forecastDelivery(v, CONTEXT, NOW).notices.map((n) => n.code)).toContain('anytime_hours');
  });

  it('faixa invertida e sobreposição são apontadas na faixa certa', () => {
    let v = toggleDay(applyHoursPreset(value(), 'business'), 6, true);
    v = addWindow(v, 1);
    const monday = windowsForDay(v, 1);
    const second = monday[1];
    expect(second).toBeDefined();
    if (!second) return;
    const overlapping = updateWindow(v, second.key, { start: '17:00', end: '20:00' });
    const overlap = validateDelivery(overlapping, NOW);
    expect(overlap.map((i) => i.code)).toEqual(['window_overlap']);
    expect(overlap[0]?.windowKey).toBe(second.key);

    const inverted = updateWindow(v, second.key, { start: '22:00', end: '02:00' });
    expect(validateDelivery(inverted, NOW).map((i) => i.code)).toEqual(['window_invalid']);
  });

  it('nenhum dia marcado bloqueia', () => {
    let v = value();
    for (const day of [1, 2, 3, 4, 5]) v = toggleDay(v, day, false);
    expect(validateDelivery(v, NOW).map((i) => i.code)).toEqual(['hours_empty']);
  });

  it('copiar um dia para os outros dias ativos', () => {
    const v = applyHoursPreset(value(), 'business_saturday');
    const sat = windowsForDay(v, 6);
    const copied = copyDayToActiveDays(v, 6);
    expect(windowsForDay(copied, 1).map((w) => [w.start, w.end])).toEqual(
      sat.map((w) => [w.start, w.end]),
    );
    expect(windowsForDay(copied, 0)).toEqual([]);
  });
});

describe('ritmo e qualidade', () => {
  it('alerta corta pela metade, crítico zera (espelha o worker)', () => {
    expect(effectiveRate(30, 'GREEN')).toBe(30);
    expect(effectiveRate(30, 'YELLOW')).toBe(15);
    expect(effectiveRate(1, 'YELLOW')).toBe(1);
    expect(effectiveRate(30, 'RED')).toBe(0);
  });

  it('ritmo personalizado fora de 1–600 bloqueia; acima de 60 avisa', () => {
    expect(
      validateDelivery(value({ pace: 'custom', customRate: 601 }), NOW).map((i) => i.code),
    ).toEqual(['rate_invalid']);
    expect(
      validateDelivery(value({ pace: 'custom', customRate: 0 }), NOW).map((i) => i.code),
    ).toEqual(['rate_invalid']);
    const f = forecastDelivery(value({ pace: 'custom', customRate: 120 }), CONTEXT, NOW);
    expect(f.notices.map((n) => n.code)).toContain('rate_aggressive');
  });

  it('o resumo reage à qualidade: em alerta a duração dobra', () => {
    const anytime = applyHoursPreset(value(), 'anytime');
    const green = forecastDelivery(anytime, CONTEXT, NOW);
    const yellow = forecastDelivery(anytime, { ...CONTEXT, quality: 'YELLOW' }, NOW);
    expect(green.estimate?.kind).toBe('ok');
    expect(yellow.estimate?.kind).toBe('ok');
    if (green.estimate?.kind !== 'ok' || yellow.estimate?.kind !== 'ok') return;
    const g = green.estimate.finishesAt.getTime() - NOW.getTime();
    const y = yellow.estimate.finishesAt.getTime() - NOW.getTime();
    expect(y).toBeGreaterThan(g * 1.9);
    expect(yellow.notices.map((n) => n.code)).toContain('quality_yellow');
  });

  it('qualidade crítica: aviso de perigo e nenhuma estimativa', () => {
    const f = forecastDelivery(value(), { ...CONTEXT, quality: 'RED' }, NOW);
    expect(f.effectiveRate).toBe(0);
    expect(f.estimate).toBeNull();
    expect(f.notices[0]?.code).toBe('quality_red');
  });
});

describe('limite por dia e capacidade do número', () => {
  it('limite próprio menor que o público avisa a divisão em dias', () => {
    const v = applyHoursPreset(value({ dailyLimitEnabled: true, dailyLimit: 500 }), 'anytime');
    const f = forecastDelivery(v, CONTEXT, NOW);
    expect(f.dailyCap).toBe(500);
    expect(f.dailyCapSource).toBe('own');
    const split = f.notices.find((n) => n.code === 'split_days');
    expect(split?.title).toBe('O envio vai ser dividido em 3 dias');
    expect(split?.text).toContain('limite é de 500 mensagens por dia');
  });

  it('capacidade do número menor que o limite próprio vence', () => {
    const v = value({ dailyLimitEnabled: true, dailyLimit: 5_000 });
    const f = forecastDelivery(v, { ...CONTEXT, providerDailyLimit: 1_000 }, NOW);
    expect(f.dailyCap).toBe(1_000);
    expect(f.dailyCapSource).toBe('provider');
    expect(f.notices.map((n) => n.code)).toContain('audience_over_capacity');
  });

  it('o resumo reage ao público: mais contatos, mais tempo', () => {
    const v = applyHoursPreset(value(), 'anytime');
    const small = forecastDelivery(v, { ...CONTEXT, audience: 100 }, NOW).estimate;
    const big = forecastDelivery(v, { ...CONTEXT, audience: 5_000 }, NOW).estimate;
    if (small?.kind !== 'ok' || big?.kind !== 'ok') throw new Error('esperava estimativa');
    expect(big.finishesAt.getTime()).toBeGreaterThan(small.finishesAt.getTime());
  });

  it('o resumo reage ao horário: começar fora do horário avisa a espera', () => {
    const v = value({ start: 'scheduled', scheduleDate: '2026-10-10', scheduleTime: '10:00' }); // sábado
    expect(forecastDelivery(v, CONTEXT, NOW).notices.map((n) => n.code)).toContain(
      'waits_for_hours',
    );
  });

  it('limite inválido bloqueia; desligado manda null', () => {
    expect(
      validateDelivery(value({ dailyLimitEnabled: true, dailyLimit: 0 }), NOW).map((i) => i.code),
    ).toEqual(['daily_limit_invalid']);
    expect(toDeliveryPayload(value(), NOW)?.dailyLimit).toBeNull();
  });
});

describe('prazo final', () => {
  it('precisa ser depois do início (a API recusa endAt <= startAt)', () => {
    const v = value({
      start: 'scheduled',
      scheduleDate: '2026-10-09',
      scheduleTime: '09:00',
      deadlineEnabled: true,
      deadlineDate: '2026-10-09',
      deadlineTime: '09:00',
    });
    expect(validateDelivery(v, NOW).map((i) => i.code)).toEqual(['deadline_before_start']);
  });

  it('prazo que corta o público vira aviso com a quantidade', () => {
    const v = value({ deadlineEnabled: true, deadlineDate: '2026-10-07', deadlineTime: '10:10' });
    const f = forecastDelivery(v, CONTEXT, NOW);
    const cut = f.notices.find((n) => n.code === 'deadline_cuts');
    expect(cut?.text).toContain('900 contatos ficam sem receber');
    expect(toDeliveryPayload(v, NOW)?.endAt).toBe('2026-10-07T13:10:00.000Z');
  });
});

describe('hidratação', () => {
  it('rascunho salvo volta ao mesmo valor de tela', () => {
    const v = fromStoredDelivery({
      timezone: 'America/Sao_Paulo',
      startAt: '2026-10-08T12:00:00.000Z',
      endAt: null,
      sendWindows: {
        enabled: true,
        timezone: 'America/Sao_Paulo',
        windows: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '18:00' })),
      },
      rateLimitPerMinute: 45,
      dailyLimit: 1_000,
    });
    expect(v.start).toBe('scheduled');
    expect(v.scheduleDate).toBe('2026-10-08');
    expect(v.scheduleTime).toBe('09:00');
    expect(detectHoursPreset(v)).toBe('business');
    expect(v.pace).toBe('custom');
    expect(v.customRate).toBe(45);
    expect(v.dailyLimitEnabled).toBe(true);
    const payload = toDeliveryPayload(v, NOW);
    expect(payload?.startAt).toBe('2026-10-08T12:00:00.000Z');
    expect(payload?.rateLimitPerMinute).toBe(45);
  });
});

describe('textos', () => {
  it('duração legível', () => {
    expect(describeDuration(20_000)).toBe('menos de 1 minuto');
    expect(describeDuration(35 * 60_000)).toBe('cerca de 35 minutos');
    expect(describeDuration(80 * 60_000)).toBe('cerca de 1 h 20 min');
    expect(describeDuration(200 * 60_000)).toBe('cerca de 3 h 20 min');
    expect(describeDuration(3 * 24 * 60 * 60_000)).toBe('cerca de 3 dias');
  });
});

describe('teclado (UX §2.10)', () => {
  it('setas circulam, Home/End vão às pontas, outras teclas não navegam', () => {
    expect(nextOptionIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextOptionIndex('ArrowDown', 2, 3)).toBe(0);
    expect(nextOptionIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextOptionIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextOptionIndex('Home', 2, 3)).toBe(0);
    expect(nextOptionIndex('End', 0, 3)).toBe(2);
    expect(nextOptionIndex('Enter', 0, 3)).toBeNull();
    expect(nextOptionIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
