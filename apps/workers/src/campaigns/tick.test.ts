import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import type { ChannelHealth } from '@hm/channels';
import {
  runCampaignTick,
  processCampaign,
  deliveryIdempotencyKey,
  type CampaignTickPorts,
  type RunningCampaign,
  type PendingDispatch,
  type DispatchOutcome,
  type ChannelInspection,
  type DispatchPacing,
  describeStopReason,
  CAMPAIGN_TICK_INTERVAL_MS,
  CHANNEL_UNAVAILABLE_RETRY_MS,
} from './tick';
import { effectiveRatePerMinute } from './rate';
import { isInSendWindow, nextWindowStart } from './windows';

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

const CAMP: RunningCampaign = {
  id: 'camp1',
  workspaceId: 'ws1',
  channelId: 'ch1',
  sendWindows: null,
  rateLimitPerMinute: 60,
  deliveryRate: null,
  endAt: null,
  nextTickAt: null,
};

function green(): ChannelHealth {
  return { qualityRating: 'GREEN', tierLimit: 1000 };
}

/**
 * Ports default do tick. As capacidades da maquina de estados (F56-S03) entram
 * aqui como no-ops seguros — o comportamento delas e coberto em steps/drip.test.ts
 * (drip/terminal/teto diario com DB em memoria) e em steps/state.test.ts (puro).
 */
function makePorts(over: Partial<CampaignTickPorts> = {}): CampaignTickPorts {
  return {
    // F59-S05: o portao roda antes de cada enqueue. Default permissivo aqui —
    // a conformidade tem testes proprios; estes cobrem ritmo, cota e estado.
    checkConsent: vi.fn(async () => ({
      allowed: true as const,
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    })),
    denyRecipient: vi.fn(async () => undefined),
    // F71-S06: assinatura ativa por padrao; o caso inativo tem teste proprio.
    checkSubscription: vi.fn(async () => ({ active: true as const, status: 'active' })),
    promoteScheduledCampaigns: vi.fn(async () => []),
    listDueCampaigns: vi.fn(async () => [CAMP]),
    inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({
      kind: 'ready',
      health: green(),
    })),
    deferRecipient: vi.fn(async () => undefined),
    closeCampaign: vi.fn(async () => ({ closed: true, notReached: 0 })),
    reapRecipients: vi.fn(async () => ({ recovered: 0, finalized: 0 })),
    ensureDailyQuota: vi.fn(async (_c: RunningCampaign, now: Date) => ({
      remaining: null,
      resetsAt: new Date(now.getTime() + 86400000),
    })),
    pendingRecipients: vi.fn(async () => []),
    enqueueDelivery: vi.fn(async (): Promise<DispatchOutcome> => ({ kind: 'enqueued' })),
    settleCampaign: vi.fn(async () => false),
    pauseCampaign: vi.fn(async () => undefined),
    scheduleNextTick: vi.fn(async () => undefined),
    applyErrorAction: vi.fn(async () => undefined),
    ...over,
  };
}

const D: PendingDispatch = { recipientId: 'r1', contactId: 'c1', stepId: 's1', stepIndex: 0 };

describe('deliveryIdempotencyKey', () => {
  it('e deterministico = sha256(campaign:recipient:step)', () => {
    const k1 = deliveryIdempotencyKey('camp', 'rec', 'step');
    const k2 = deliveryIdempotencyKey('camp', 'rec', 'step');
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64);
    expect(deliveryIdempotencyKey('camp', 'rec', 'other')).not.toBe(k1);
  });
});

describe('processCampaign', () => {
  it('F71-S06: assinatura inativa → pausa a campanha e nao envia nada (nem consulta a Meta)', async () => {
    const ports = makePorts({
      checkSubscription: vi.fn(async () => ({ active: false as const, status: 'expired' })),
      pendingRecipients: vi.fn(async () => [D]),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(r.subscriptionInactive).toBe(true);
    expect(r.paused).toBe(true);
    expect(r.dispatched).toBe(0);
    expect(ports.checkSubscription).toHaveBeenCalledWith(CAMP);
    expect(ports.pauseCampaign).toHaveBeenCalledWith('camp1', 'skipped_subscription_inactive');
    expect(ports.inspectChannel).not.toHaveBeenCalled();
    expect(ports.pendingRecipients).not.toHaveBeenCalled();
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
    expect(ports.scheduleNextTick).not.toHaveBeenCalled();
  });

  it('F71-S06: runCampaignTick conta a campanha pulada por assinatura', async () => {
    const ports = makePorts({
      checkSubscription: vi.fn(async () => ({ active: false as const, status: 'canceled' })),
    });
    const res = await runCampaignTick({ ports, logger: makeLogger() });
    expect(res.subscriptionInactive).toBe(1);
    expect(res.dispatched).toBe(0);
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('despacha recipients pendentes (caminho feliz)', async () => {
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(r.dispatched).toBe(1);
    expect(r.paused).toBe(false);
    expect(ports.enqueueDelivery).toHaveBeenCalledOnce();
  });

  it('IDEMPOTENCIA: enqueue duplicate NAO conta como dispatched', async () => {
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery: vi.fn(async (): Promise<DispatchOutcome> => ({ kind: 'duplicate' })),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(r.dispatched).toBe(0);
    expect(r.duplicates).toBe(1);
  });

  it('quality RED -> auto-pause e nao despacha', async () => {
    const ports = makePorts({
      inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({
        kind: 'ready',
        health: { qualityRating: 'RED', tierLimit: 1000 },
      })),
      pendingRecipients: vi.fn(async () => [D]),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(r.paused).toBe(true);
    expect(r.dispatched).toBe(0);
    expect(ports.pauseCampaign).toHaveBeenCalledWith('camp1', 'quality_red');
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('fora da send window -> reagenda sem enviar', async () => {
    const sunday2am = new Date('2026-06-07T05:00:00Z'); // 02:00 BRT domingo
    const windows = {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      windows: [{ day: 1, start: '09:00', end: '18:00' }],
    };
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const r = await processCampaign(
      { ...CAMP, sendWindows: windows },
      { ports, logger: makeLogger() },
      sunday2am,
    );
    expect(r.rescheduled).toBe(true);
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
    expect(ports.scheduleNextTick).toHaveBeenCalledOnce();
  });

  it('error code 132001 (template disabled) -> aplica acao + pausa', async () => {
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery: vi.fn(async (): Promise<DispatchOutcome> => ({
        kind: 'error',
        errorCode: '132001',
      })),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(ports.applyErrorAction).toHaveBeenCalledOnce();
    expect(r.paused).toBe(true);
    expect(ports.pauseCampaign).toHaveBeenCalled();
  });
});

describe('processCampaign — portao de consentimento (F59-S05)', () => {
  it('supressao remove o recipient da execucao e NAO enfileira', async () => {
    const enqueueDelivery = vi.fn(async () => ({ kind: 'enqueued' }) as const);
    const denyRecipient = vi.fn(async () => undefined);
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery,
      denyRecipient,
      checkConsent: vi.fn(async () => ({
        allowed: false as const,
        reason: 'suppressed' as const,
        message: 'suprimido',
        usedFallbackTimezone: false,
        timezone: 'America/New_York',
      })),
    });

    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());

    expect(enqueueDelivery).not.toHaveBeenCalled();
    expect(denyRecipient).toHaveBeenCalledOnce();
    expect(r.denied).toBe(1);
    expect(r.dispatched).toBe(0);
  });

  it('falta de consentimento tambem remove — nao se resolve com o tempo', async () => {
    const denyRecipient = vi.fn(async () => undefined);
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      denyRecipient,
      checkConsent: vi.fn(async () => ({
        allowed: false as const,
        reason: 'no_consent' as const,
        message: 'sem consentimento',
        usedFallbackTimezone: false,
        timezone: 'America/New_York',
      })),
    });

    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(r.denied).toBe(1);
    expect(denyRecipient).toHaveBeenCalledWith(CAMP, D, 'no_consent');
  });

  it('janela horaria ADIA sem descartar: recipient nao e removido nem enfileirado', async () => {
    // O recipient continua `pending`; o proximo tick tenta de novo. E o
    // reagendamento, sem inventar mecanismo novo — e o oposto de descartar.
    const enqueueDelivery = vi.fn(async () => ({ kind: 'enqueued' }) as const);
    const denyRecipient = vi.fn(async () => undefined);
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery,
      denyRecipient,
      checkConsent: vi.fn(async () => ({
        allowed: false as const,
        reason: 'quiet_hours' as const,
        message: 'fora da janela',
        retryAt: new Date('2026-07-16T12:00:00Z'),
        usedFallbackTimezone: false,
        timezone: 'America/New_York',
      })),
    });

    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());

    expect(enqueueDelivery).not.toHaveBeenCalled();
    expect(denyRecipient).not.toHaveBeenCalled();
    expect(r.deferred).toBe(1);
    expect(r.denied).toBe(0);
  });

  it('o portao roda ANTES do enqueue, uma vez por recipient', async () => {
    const checkConsent = vi.fn(async () => ({
      allowed: true as const,
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    }));
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]), checkConsent });

    await processCampaign(CAMP, { ports, logger: makeLogger() }, new Date());
    expect(checkConsent).toHaveBeenCalledOnce();
  });
});

describe('runCampaignTick', () => {
  it('processa cada campanha sob lock e agrega contadores', async () => {
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const res = await runCampaignTick({ ports, logger: makeLogger() });
    expect(res.campaigns).toBe(1);
    expect(res.dispatched).toBe(1);
  });
});

describe('effectiveRatePerMinute', () => {
  it('GREEN mantem; YELLOW corta pela metade; RED -> 0', () => {
    expect(effectiveRatePerMinute({ baseRatePerMinute: 60, qualityRating: 'GREEN' })).toBe(60);
    expect(effectiveRatePerMinute({ baseRatePerMinute: 60, qualityRating: 'YELLOW' })).toBe(30);
    expect(effectiveRatePerMinute({ baseRatePerMinute: 60, qualityRating: 'RED' })).toBe(0);
  });
  it('delivery_rate < 0.85 -> throttle 70%', () => {
    expect(
      effectiveRatePerMinute({ baseRatePerMinute: 100, qualityRating: 'GREEN', deliveryRate: 0.5 }),
    ).toBe(70);
  });
  it('piso 1 quando nao-RED arredonda para 0', () => {
    expect(effectiveRatePerMinute({ baseRatePerMinute: 1, qualityRating: 'YELLOW' })).toBe(1);
  });
});

describe('send windows', () => {
  const tz = 'America/Sao_Paulo';
  const windows = { enabled: true, timezone: tz, windows: [{ day: 1, start: '09:00', end: '18:00' }] };

  it('janelas desabilitadas -> sempre dentro', () => {
    expect(isInSendWindow({ enabled: false }, new Date())).toBe(true);
    expect(isInSendWindow(null, new Date())).toBe(true);
  });
  it('segunda 12:00 BRT dentro de 09-18', () => {
    expect(isInSendWindow(windows, new Date('2026-06-08T15:00:00Z'))).toBe(true);
  });
  it('segunda 20:00 BRT fora da janela', () => {
    expect(isInSendWindow(windows, new Date('2026-06-08T23:00:00Z'))).toBe(false);
  });
  it('nextWindowStart avanca para o proximo inicio', () => {
    const now = new Date('2026-06-07T15:00:00Z'); // domingo
    const next = nextWindowStart(windows, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ─── F58-S11: agendamento, prazo, canal e compasso ───────────────────────────

const NOW = new Date('2026-07-13T12:00:00Z');

describe('F58-S11 — agendamento e prazo final', () => {
  it('runCampaignTick promove as agendadas ANTES de listar as devidas', async () => {
    const order: string[] = [];
    const ports = makePorts({
      promoteScheduledCampaigns: vi.fn(async () => {
        order.push('promote');
        return [{ id: 'camp1', workspaceId: 'ws1', startAt: NOW }];
      }),
      listDueCampaigns: vi.fn(async () => {
        order.push('list');
        return [CAMP];
      }),
    });
    const res = await runCampaignTick({ ports, logger: makeLogger() }, { now: NOW });
    expect(order).toEqual(['promote', 'list']);
    expect(res.promoted).toBe(1);
    expect(ports.promoteScheduledCampaigns).toHaveBeenCalledWith(NOW);
  });

  it('prazo vencido fecha com motivo e NAO consulta canal nem envia', async () => {
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const ended = { ...CAMP, endAt: new Date(NOW.getTime() - 1) };
    const r = await processCampaign(ended, { ports, logger: makeLogger() }, NOW);
    expect(r.ended).toBe(true);
    expect(r.completed).toBe(true);
    expect(ports.closeCampaign).toHaveBeenCalledWith(ended, 'end_at_reached', NOW);
    expect(ports.inspectChannel).not.toHaveBeenCalled();
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('prazo exatamente agora (end_at == now) ja conta como vencido', async () => {
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const r = await processCampaign({ ...CAMP, endAt: NOW }, { ports, logger: makeLogger() }, NOW);
    expect(r.ended).toBe(true);
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });

  it('portao `ended` no meio do lote fecha a campanha (outra instancia/relogio)', async () => {
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D, { ...D, recipientId: 'r2' }]),
      enqueueDelivery: vi.fn(
        async (): Promise<DispatchOutcome> => ({ kind: 'gate_closed', reason: 'ended', retryAt: null }),
      ),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(ports.enqueueDelivery).toHaveBeenCalledOnce();
    expect(ports.closeCampaign).toHaveBeenCalledOnce();
    expect(r.ended).toBe(true);
  });
});

describe('F58-S11 — canal desativado/credencial', () => {
  for (const reason of [
    'channel_inactive',
    'channel_not_found',
    'channel_credentials_missing',
    'channel_credentials_invalid',
  ] as const) {
    it(`${reason} pausa com orientacao e nao toca recipients`, async () => {
      const ports = makePorts({
        inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({ kind: 'blocked', reason })),
        pendingRecipients: vi.fn(async () => [D]),
      });
      const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
      expect(r.paused).toBe(true);
      expect(r.channelBlocked).toBe(true);
      expect(ports.pauseCampaign).toHaveBeenCalledWith('camp1', reason);
      // Nada que complete/falhe recipients roda: nem reaper, nem lote, nem settle.
      expect(ports.reapRecipients).not.toHaveBeenCalled();
      expect(ports.pendingRecipients).not.toHaveBeenCalled();
      expect(ports.settleCampaign).not.toHaveBeenCalled();
      expect(ports.enqueueDelivery).not.toHaveBeenCalled();
      expect(describeStopReason(reason)).toMatch(/Canais|canal/);
    });
  }

  it('Meta indisponivel: nao pausa, nao envia, tenta de novo em 60s', async () => {
    const ports = makePorts({
      inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({
        kind: 'unavailable',
        detail: 'timeout',
      })),
      pendingRecipients: vi.fn(async () => [D]),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(r.paused).toBe(false);
    expect(r.rescheduled).toBe(true);
    expect(ports.scheduleNextTick).toHaveBeenCalledWith(
      'camp1',
      new Date(NOW.getTime() + CHANNEL_UNAVAILABLE_RETRY_MS),
    );
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });
});

describe('F58-S11 — quality e ritmo', () => {
  it('YELLOW reduz o ritmo aplicado na reserva (60 -> 30/min)', async () => {
    const enqueueDelivery = vi.fn(
      async (
        _c: RunningCampaign,
        _d: PendingDispatch,
        _k: string,
        _n: Date,
        _p: DispatchPacing,
      ): Promise<DispatchOutcome> => ({ kind: 'enqueued' }),
    );
    const ports = makePorts({
      inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({
        kind: 'ready',
        health: { qualityRating: 'YELLOW', tierLimit: 1000 },
      })),
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery,
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(r.ratePerMinute).toBe(30);
    expect(enqueueDelivery.mock.calls[0]?.[4]).toEqual({ ratePerMinute: 30, windowMs: 5000 });
  });

  it('RED pausa ANTES de buscar recipients', async () => {
    const ports = makePorts({
      inspectChannel: vi.fn(async (): Promise<ChannelInspection> => ({
        kind: 'ready',
        health: { qualityRating: 'RED', tierLimit: 1000 },
      })),
      pendingRecipients: vi.fn(async () => [D]),
    });
    await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(ports.pauseCampaign).toHaveBeenCalledWith('camp1', 'quality_red');
    expect(ports.pendingRecipients).not.toHaveBeenCalled();
  });

  it('lote = creditos do compasso: balde cheio a 60/min com janela 5s = 6 (nao rate/4)', async () => {
    const pendingRecipients = vi.fn(async () => [D]);
    const ports = makePorts({ pendingRecipients });
    await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW, { pacingWindowMs: 5000 });
    expect(pendingRecipients).toHaveBeenCalledWith(CAMP, 6, NOW);
  });

  it('cursor no futuro (sem credito) nao busca recipients e agenda no cursor', async () => {
    const cursor = new Date(NOW.getTime() + 2000);
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const r = await processCampaign(
      { ...CAMP, nextTickAt: cursor },
      { ports, logger: makeLogger() },
      NOW,
    );
    expect(ports.pendingRecipients).not.toHaveBeenCalled();
    expect(ports.scheduleNextTick).toHaveBeenCalledWith('camp1', cursor);
    expect(r.rescheduled).toBe(true);
  });

  it('portao `pace` para o lote e agenda no retryAt', async () => {
    const retryAt = new Date(NOW.getTime() + 1000);
    const enqueueDelivery = vi
      .fn<CampaignTickPorts['enqueueDelivery']>()
      .mockResolvedValueOnce({ kind: 'enqueued' })
      .mockResolvedValueOnce({ kind: 'gate_closed', reason: 'pace', retryAt });
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [
        D,
        { ...D, recipientId: 'r2' },
        { ...D, recipientId: 'r3' },
      ]),
      enqueueDelivery,
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(enqueueDelivery).toHaveBeenCalledTimes(2);
    expect(r.dispatched).toBe(1);
    expect(ports.scheduleNextTick).toHaveBeenCalledWith('camp1', retryAt);
    expect(ports.settleCampaign).not.toHaveBeenCalled();
  });

  it('portao `daily_quota` dorme ate o reset (teto atomico venceu o saldo lido)', async () => {
    const resetsAt = new Date('2026-07-14T03:00:00Z');
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery: vi.fn(
        async (): Promise<DispatchOutcome> => ({
          kind: 'gate_closed',
          reason: 'daily_quota',
          retryAt: resetsAt,
        }),
      ),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(r.quotaExhausted).toBe(true);
    expect(ports.scheduleNextTick).toHaveBeenCalledWith('camp1', resetsAt);
  });

  it('portao `not_running` (pausada no meio do lote) nao reagenda nem fecha', async () => {
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      enqueueDelivery: vi.fn(
        async (): Promise<DispatchOutcome> => ({
          kind: 'gate_closed',
          reason: 'not_running',
          retryAt: null,
        }),
      ),
    });
    await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(ports.scheduleNextTick).not.toHaveBeenCalled();
    expect(ports.settleCampaign).not.toHaveBeenCalled();
  });

  it('lote cheio volta logo (respeitando o cursor); lote parcial espera 60s', async () => {
    const full = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    // janela 0 => burst 1 => limite 1 => lote cheio
    await processCampaign(CAMP, { ports: full, logger: makeLogger() }, NOW, { pacingWindowMs: 0 });
    expect(full.scheduleNextTick).toHaveBeenCalledWith('camp1', NOW);

    const partial = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    await processCampaign(CAMP, { ports: partial, logger: makeLogger() }, NOW);
    expect(partial.scheduleNextTick).toHaveBeenCalledWith(
      'camp1',
      new Date(NOW.getTime() + CAMPAIGN_TICK_INTERVAL_MS),
    );
  });

  it('janela horaria do contato ADIA o recipient ate o retryAt (sai da frente da fila)', async () => {
    const retryAt = new Date('2026-07-13T21:00:00Z');
    const ports = makePorts({
      pendingRecipients: vi.fn(async () => [D]),
      checkConsent: vi.fn(async () => ({
        allowed: false as const,
        reason: 'quiet_hours' as const,
        message: 'fora',
        retryAt,
        usedFallbackTimezone: false,
        timezone: 'America/Sao_Paulo',
      })),
    });
    const r = await processCampaign(CAMP, { ports, logger: makeLogger() }, NOW);
    expect(r.deferred).toBe(1);
    expect(ports.deferRecipient).toHaveBeenCalledWith(CAMP, D, retryAt);
  });

  it('lideranca perdida (signal abortado) nao envia nada', async () => {
    const ac = new AbortController();
    ac.abort();
    const ports = makePorts({ pendingRecipients: vi.fn(async () => [D]) });
    const res = await runCampaignTick(
      { ports, logger: makeLogger() },
      { now: NOW, signal: ac.signal },
    );
    expect(res.dispatched).toBe(0);
    expect(ports.enqueueDelivery).not.toHaveBeenCalled();
  });
});

describe('describeStopReason', () => {
  it('todo motivo tem orientacao; motivo desconhecido cai num texto generico', () => {
    expect(describeStopReason('end_at_reached')).toContain('prazo final');
    expect(describeStopReason('quality_red')).toContain('qualidade');
    expect(describeStopReason('xyz').length).toBeGreaterThan(10);
  });
});
