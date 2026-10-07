/**
 * F58-S11 — nucleo puro do ritmo: compasso (GCRA) e portao por mensagem.
 * Relogio deterministico: todo `now` e explicito.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACING_WINDOW_MS,
  decideDispatchGate,
  effectiveRatePerMinute,
  pacingBurst,
  pacingIntervalMs,
  planPace,
  type DispatchGateState,
} from './rate';

const NOW = new Date('2026-07-13T15:00:00Z'); // 12:00 em Sao Paulo
const ms = (n: number): Date => new Date(NOW.getTime() + n);

function state(over: Partial<DispatchGateState> = {}): DispatchGateState {
  return {
    status: 'running',
    endAt: null,
    nextTickAt: NOW,
    dailyLimit: null,
    messagesSentToday: 0,
    lastDailyResetAt: NOW,
    timezone: 'America/Sao_Paulo',
    ...over,
  };
}

describe('effectiveRatePerMinute (quality)', () => {
  it('YELLOW reduz para metade; RED zera (sinal de pausa)', () => {
    expect(effectiveRatePerMinute({ baseRatePerMinute: 80, qualityRating: 'YELLOW' })).toBe(40);
    expect(effectiveRatePerMinute({ baseRatePerMinute: 80, qualityRating: 'RED' })).toBe(0);
    expect(effectiveRatePerMinute({ baseRatePerMinute: 80, qualityRating: 'UNKNOWN' })).toBe(80);
  });
});

describe('pacingIntervalMs / pacingBurst', () => {
  it('intervalo arredonda para cima (nunca excede o ritmo)', () => {
    expect(pacingIntervalMs(60)).toBe(1000);
    expect(pacingIntervalMs(7)).toBe(8572);
    expect(60_000 / pacingIntervalMs(7)).toBeLessThanOrEqual(7);
    expect(pacingIntervalMs(0)).toBe(60_000); // piso defensivo de 1/min
  });

  it('balde = janela de ritmo + 1', () => {
    expect(pacingBurst(60, 5000)).toBe(6);
    expect(pacingBurst(600, 5000)).toBe(51);
    expect(pacingBurst(7, 5000)).toBe(1);
    expect(pacingBurst(60, 0)).toBe(1);
  });
});

describe('planPace', () => {
  const base = { ratePerMinute: 60, windowMs: DEFAULT_PACING_WINDOW_MS, now: NOW };

  it('cursor nulo = balde cheio (sem historico)', () => {
    expect(planPace({ ...base, cursor: null }).credits).toBe(6);
  });

  it('cursor == now => 1 credito (acordou agora: sem rajada)', () => {
    expect(planPace({ ...base, cursor: NOW }).credits).toBe(1);
  });

  it('cursor no futuro => 0 creditos e o cursor efetivo e o proprio cursor', () => {
    const p = planPace({ ...base, cursor: ms(500) });
    expect(p.credits).toBe(0);
    expect(p.effectiveCursor).toEqual(ms(500));
  });

  it('ociosidade nao acumula alem da janela', () => {
    expect(planPace({ ...base, cursor: ms(-3_600_000) }).credits).toBe(6);
    expect(planPace({ ...base, cursor: ms(-2500) }).credits).toBe(3);
  });
});

describe('decideDispatchGate', () => {
  const params = { now: NOW, ratePerMinute: 60, windowMs: 5000 };

  it('reserva: empurra o cursor em 1 intervalo e conta o envio no dia', () => {
    const d = decideDispatchGate(state({ messagesSentToday: 4 }), params);
    expect(d).toEqual({
      kind: 'reserve',
      patch: { nextTickAt: ms(1000), messagesSentToday: 5, lastDailyResetAt: NOW },
    });
  });

  it('campanha que saiu de running (pausada no meio do lote) fecha o portao', () => {
    for (const status of ['paused', 'completed', 'cancelled', 'scheduled', 'draft']) {
      expect(decideDispatchGate(state({ status }), params)).toMatchObject({
        kind: 'closed',
        reason: 'not_running',
      });
    }
  });

  it('prazo final: end_at <= now fecha (inclusive o instante exato)', () => {
    expect(decideDispatchGate(state({ endAt: NOW }), params)).toMatchObject({ reason: 'ended' });
    expect(decideDispatchGate(state({ endAt: ms(-1) }), params)).toMatchObject({ reason: 'ended' });
    expect(decideDispatchGate(state({ endAt: ms(1) }), params).kind).toBe('reserve');
  });

  it('teto diario: no limite fecha com retryAt = proxima meia-noite local', () => {
    const d = decideDispatchGate(state({ dailyLimit: 3, messagesSentToday: 3 }), params);
    expect(d).toEqual({
      kind: 'closed',
      reason: 'daily_quota',
      retryAt: new Date('2026-07-14T03:00:00.000Z'),
    });
  });

  it('teto diario de ontem nao vale hoje: reseta para 1 NA MESMA reserva', () => {
    const d = decideDispatchGate(
      state({
        dailyLimit: 3,
        messagesSentToday: 3,
        lastDailyResetAt: new Date('2026-07-12T20:00:00Z'),
      }),
      params,
    );
    expect(d).toMatchObject({
      kind: 'reserve',
      patch: { messagesSentToday: 1, lastDailyResetAt: NOW },
    });
  });

  it('DST (America/New_York, 08/03/2026): o dia de 23h vira na meia-noite local certa', () => {
    const tz = 'America/New_York';
    // 23:30 EDT do dia 8 = 03:30Z do dia 9 — ainda e dia 8 local: nao reseta.
    const lateSameDay = decideDispatchGate(
      state({
        timezone: tz,
        dailyLimit: 2,
        messagesSentToday: 2,
        lastDailyResetAt: new Date('2026-03-08T06:00:00Z'), // 01:00 EST do dia 8
        nextTickAt: null,
      }),
      { ...params, now: new Date('2026-03-09T03:30:00Z') },
    );
    expect(lateSameDay).toEqual({
      kind: 'closed',
      reason: 'daily_quota',
      retryAt: new Date('2026-03-09T04:00:00.000Z'),
    });
    // 00:00 EDT do dia 9 = 04:00Z: novo dia.
    const nextDay = decideDispatchGate(
      state({
        timezone: tz,
        dailyLimit: 2,
        messagesSentToday: 2,
        lastDailyResetAt: new Date('2026-03-08T06:00:00Z'),
        nextTickAt: null,
      }),
      { ...params, now: new Date('2026-03-09T04:00:00Z') },
    );
    expect(nextDay).toMatchObject({ kind: 'reserve', patch: { messagesSentToday: 1 } });
  });

  it('compasso: sem credito fecha com retryAt = cursor', () => {
    expect(decideDispatchGate(state({ nextTickAt: ms(400) }), params)).toEqual({
      kind: 'closed',
      reason: 'pace',
      retryAt: ms(400),
    });
  });

  it('ordem dos portoes: not_running > ended > daily_quota > pace', () => {
    const all = state({
      status: 'paused',
      endAt: ms(-1),
      dailyLimit: 1,
      messagesSentToday: 1,
      nextTickAt: ms(9999),
    });
    expect(decideDispatchGate(all, params)).toMatchObject({ reason: 'not_running' });
    expect(decideDispatchGate({ ...all, status: 'running' }, params)).toMatchObject({
      reason: 'ended',
    });
    expect(decideDispatchGate({ ...all, status: 'running', endAt: null }, params)).toMatchObject({
      reason: 'daily_quota',
    });
  });
});

describe('concorrencia (reservas serializadas pela linha)', () => {
  /** Aplica reservas em sequencia sobre o mesmo estado — o que o FOR NO KEY UPDATE garante. */
  function drain(initial: DispatchGateState, attempts: number, now: Date, rate: number) {
    let s = initial;
    let reserved = 0;
    for (let i = 0; i < attempts; i++) {
      const d = decideDispatchGate(s, { now, ratePerMinute: rate, windowMs: 5000 });
      if (d.kind === 'closed') continue;
      reserved += 1;
      s = {
        ...s,
        nextTickAt: d.patch.nextTickAt,
        messagesSentToday: d.patch.messagesSentToday,
        lastDailyResetAt: d.patch.lastDailyResetAt,
      };
    }
    return { reserved, final: s };
  }

  it('duas instancias disputando 100 tentativas nao passam do teto diario', () => {
    // Taxa alta para o compasso nao ser o limite: so o teto decide.
    const { reserved, final } = drain(
      state({ dailyLimit: 7, messagesSentToday: 0, nextTickAt: null }),
      100,
      NOW,
      600,
    );
    expect(reserved).toBe(7);
    expect(final.messagesSentToday).toBe(7);
  });

  it('e nao passam do balde do compasso no mesmo instante', () => {
    const { reserved } = drain(state({ nextTickAt: null }), 100, NOW, 60);
    expect(reserved).toBe(pacingBurst(60, 5000));
  });
});
