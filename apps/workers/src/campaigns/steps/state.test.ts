import { describe, it, expect } from 'vitest';
import {
  advanceAfterDispatch,
  afterDispatchFailure,
  campaignIsExhausted,
  dispatchBackoffMs,
  evaluateDailyQuota,
  isExhausted,
  nextStepFor,
  nextDayStartInTz,
  startOfDayInTz,
  DISPATCH_BACKOFF_MAX_MS,
  MAX_DISPATCH_ATTEMPTS,
  type CampaignStepRef,
} from './state';

const STEPS: CampaignStepRef[] = [
  { id: 's0', position: 0, delaySeconds: 0 },
  { id: 's1', position: 1, delaySeconds: 3600 },
  { id: 's2', position: 2, delaySeconds: 86400 },
];

const NOW = new Date('2026-07-13T12:00:00Z');

describe('nextStepFor / isExhausted', () => {
  it('recipient novo (lastStepIndex null) aponta para o passo 0', () => {
    expect(nextStepFor(STEPS, null)).toEqual({ step: STEPS[0], index: 0 });
    expect(nextStepFor(STEPS, -1)).toEqual({ step: STEPS[0], index: 0 });
  });

  it('avanca na ordem e esgota no ultimo', () => {
    expect(nextStepFor(STEPS, 0)?.index).toBe(1);
    expect(nextStepFor(STEPS, 1)?.index).toBe(2);
    expect(nextStepFor(STEPS, 2)).toBeNull();
    expect(isExhausted(STEPS, 2)).toBe(true);
    expect(isExhausted(STEPS, 1)).toBe(false);
  });

  it('campanha sem steps esta esgotada de saida', () => {
    expect(isExhausted([], null)).toBe(true);
  });
});

describe('advanceAfterDispatch (CAMP-03: drip)', () => {
  it('agenda o proximo step em now + delaySeconds DO PROXIMO', () => {
    const t = advanceAfterDispatch(STEPS, 0, NOW);
    expect(t.status).toBe('pending');
    expect(t.lastStepIndex).toBe(0);
    expect(t.lastStepAt).toEqual(NOW);
    // step 1 tem delay de 1h
    expect(t.nextStepAt?.toISOString()).toBe('2026-07-13T13:00:00.000Z');
    expect(t.completedAt).toBeNull();
    expect(t.attempts).toBe(0);
  });

  it('delay 0 no proximo step => devido imediatamente (broadcast encadeado)', () => {
    const steps: CampaignStepRef[] = [
      { id: 'a', position: 0, delaySeconds: 0 },
      { id: 'b', position: 1, delaySeconds: 0 },
    ];
    const t = advanceAfterDispatch(steps, 0, NOW);
    expect(t.nextStepAt?.getTime()).toBe(NOW.getTime());
  });

  it('delay negativo (dado sujo) nao anda para tras', () => {
    const steps: CampaignStepRef[] = [
      { id: 'a', position: 0, delaySeconds: 0 },
      { id: 'b', position: 1, delaySeconds: -500 },
    ];
    expect(advanceAfterDispatch(steps, 0, NOW).nextStepAt?.getTime()).toBe(NOW.getTime());
  });

  it('CAMP-04: ultimo step despachado => recipient completed (terminal)', () => {
    const t = advanceAfterDispatch(STEPS, 2, NOW);
    expect(t.status).toBe('completed');
    expect(t.completedAt).toEqual(NOW);
    expect(t.nextStepAt).toBeNull();
  });
});

describe('afterDispatchFailure (backoff)', () => {
  it('backoff exponencial com teto', () => {
    expect(dispatchBackoffMs(1)).toBe(60_000);
    expect(dispatchBackoffMs(2)).toBe(120_000);
    expect(dispatchBackoffMs(3)).toBe(240_000);
    expect(dispatchBackoffMs(99)).toBe(DISPATCH_BACKOFF_MAX_MS);
  });

  it('reagenda o mesmo step enquanto ha tentativas', () => {
    const t = afterDispatchFailure(1, NOW, 'boom');
    expect(t.status).toBe('pending');
    expect(t.nextStepAt?.getTime()).toBe(NOW.getTime() + 60_000);
    expect(t.failedReason).toBeNull();
  });

  it('esgotadas as tentativas o recipient falha (nao fica preso em sending)', () => {
    const t = afterDispatchFailure(MAX_DISPATCH_ATTEMPTS, NOW, 'boom');
    expect(t.status).toBe('failed');
    expect(t.failedReason).toBe('boom');
    expect(t.nextStepAt).toBeNull();
  });
});

describe('campaignIsExhausted (CAMP-04)', () => {
  it('sem ativos e com recipients => terminal', () => {
    expect(campaignIsExhausted({ total: 10, active: 0 })).toBe(true);
  });
  it('com ativos => segue running', () => {
    expect(campaignIsExhausted({ total: 10, active: 1 })).toBe(false);
  });
  it('campanha sem recipient nenhum NAO e dada por concluida (import em voo)', () => {
    expect(campaignIsExhausted({ total: 0, active: 0 })).toBe(false);
  });
});

describe('evaluateDailyQuota (CAMP-06)', () => {
  const tz = 'America/Sao_Paulo';

  it('sem dailyLimit => ilimitado', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: null, messagesSentToday: 999, lastDailyResetAt: NOW, timezone: tz },
      NOW,
    );
    expect(q.remaining).toBeNull();
  });

  it('saldo = limite - enviados hoje', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: 100, messagesSentToday: 30, lastDailyResetAt: NOW, timezone: tz },
      NOW,
    );
    expect(q.remaining).toBe(70);
    expect(q.needsReset).toBe(false);
  });

  it('teto atingido => remaining 0 (batch nao roda)', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: 100, messagesSentToday: 100, lastDailyResetAt: NOW, timezone: tz },
      NOW,
    );
    expect(q.remaining).toBe(0);
  });

  it('virou o dia no fuso da campanha => reset (contador gravado e ignorado)', () => {
    const yesterday = new Date('2026-07-12T20:00:00Z'); // 17:00 BRT do dia 12
    const q = evaluateDailyQuota(
      { dailyLimit: 100, messagesSentToday: 100, lastDailyResetAt: yesterday, timezone: tz },
      NOW,
    );
    expect(q.needsReset).toBe(true);
    expect(q.remaining).toBe(100);
  });

  it('reset nulo (campanha nunca enviou) => precisa resetar e tem saldo cheio', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: 50, messagesSentToday: 0, lastDailyResetAt: null, timezone: tz },
      NOW,
    );
    expect(q.needsReset).toBe(true);
    expect(q.remaining).toBe(50);
  });

  it('teto explicito 0 bloqueia o envio (nao vira "ilimitado")', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: 0, messagesSentToday: 0, lastDailyResetAt: NOW, timezone: tz },
      NOW,
    );
    expect(q.remaining).toBe(0);
  });

  it('resetsAt = proxima meia-noite no fuso da campanha', () => {
    const q = evaluateDailyQuota(
      { dailyLimit: 10, messagesSentToday: 10, lastDailyResetAt: NOW, timezone: tz },
      NOW,
    );
    // 13/07 12:00Z = 09:00 BRT -> proxima meia-noite BRT = 14/07 03:00Z
    expect(q.resetsAt.toISOString()).toBe('2026-07-14T03:00:00.000Z');
    expect(q.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('mesma virada logo antes da meia-noite local', () => {
    const late = new Date('2026-07-14T02:30:00Z'); // 23:30 BRT do dia 13
    const q = evaluateDailyQuota(
      { dailyLimit: 10, messagesSentToday: 1, lastDailyResetAt: late, timezone: tz },
      late,
    );
    expect(q.needsReset).toBe(false);
    expect(q.resetsAt.toISOString()).toBe('2026-07-14T03:00:00.000Z');
  });
});

describe('fronteiras de dia por fuso', () => {
  it('startOfDayInTz respeita o fuso (nao usa o do host)', () => {
    expect(startOfDayInTz(NOW, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-07-13T03:00:00.000Z',
    );
    expect(startOfDayInTz(NOW, 'UTC').toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(startOfDayInTz(NOW, 'Asia/Tokyo').toISOString()).toBe('2026-07-12T15:00:00.000Z');
  });

  it('fuso invalido cai em UTC em vez de explodir', () => {
    expect(startOfDayInTz(NOW, 'Marte/Olympus').toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('nextDayStartInTz sempre avanca', () => {
    const next = nextDayStartInTz(NOW, 'America/Sao_Paulo');
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime() - startOfDayInTz(NOW, 'America/Sao_Paulo').getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('atravessa DST do hemisferio norte sem duplicar/pular dia', () => {
    // 2026-03-08: EUA adiantam o relogio (dia local de 23h).
    const beforeDst = new Date('2026-03-08T10:00:00Z'); // 05:00 EST
    const start = startOfDayInTz(beforeDst, 'America/New_York');
    const next = nextDayStartInTz(beforeDst, 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(next.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // ja em EDT
    expect(next.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
