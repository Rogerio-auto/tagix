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
} from './tick';
import { effectiveRatePerMinute, batchSizeForTick } from './rate';
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
};

function green(): ChannelHealth {
  return { qualityRating: 'GREEN', tierLimit: 1000 };
}

function makePorts(over: Partial<CampaignTickPorts> = {}): CampaignTickPorts {
  return {
    listDueCampaigns: vi.fn(async () => [CAMP]),
    fetchQuality: vi.fn(async () => green()),
    pendingRecipients: vi.fn(async () => []),
    enqueueDelivery: vi.fn(async (): Promise<DispatchOutcome> => ({ kind: 'enqueued' })),
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
      fetchQuality: vi.fn(async () => ({ qualityRating: 'RED' as const, tierLimit: 1000 })),
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
  it('batchSizeForTick = max(1, rate/4)', () => {
    expect(batchSizeForTick(60)).toBe(15);
    expect(batchSizeForTick(2)).toBe(1);
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
