/**
 * Testes do loop de métricas de campanha (F56-S02, CAMP-01/CAMP-02).
 *
 * Sem DB/Redis reais: o núcleo (`computeCampaignMetrics`, `healthStatusOf`,
 * `campaignDeliveryAdvance`) é puro; o job e o scheduler são testados com
 * portas/redis fake.
 *
 * Nota de fronteira: os testes de `campaignDeliveryAdvance` (o plano puro da
 * propagação CAMP-02 em `inbound/status.ts`) vivem AQUI porque
 * `inbound/status.test.ts` está fora do `files_allowed` deste slot.
 */
import { describe, it, expect, vi } from 'vitest';
import { campaignDeliveryAdvance } from '../../inbound/status';
import {
  computeCampaignMetrics,
  healthStatusOf,
  runCampaignMetricsRecompute,
  type CampaignDeliveryAggregate,
  type CampaignRecomputePorts,
} from './job';
import {
  campaignRecomputeMsFromEnv,
  runScheduledRecompute,
  DEFAULT_CAMPAIGN_RECOMPUTE_MS,
  CAMPAIGN_RECOMPUTE_LOCK_KEY,
} from './scheduler';
import type { RedisLike } from '../scheduler';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function agg(over: Partial<CampaignDeliveryAggregate> = {}): CampaignDeliveryAggregate {
  return {
    totalRecipients: 0,
    replied: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    blocked: 0,
    ...over,
  };
}

describe('campaignDeliveryAdvance — plano puro da propagação (CAMP-02)', () => {
  it('sent: só sai de queued, carimba sentAt, sem backfill', () => {
    const plan = campaignDeliveryAdvance('sent');
    expect(plan.allowedFrom).toEqual(['queued']);
    expect(plan.stamp).toBe('sentAt');
    expect(plan.backfill).toEqual([]);
  });

  it('delivered: sai de queued/sent, carimba deliveredAt e backfilla sentAt', () => {
    const plan = campaignDeliveryAdvance('delivered');
    expect(plan.allowedFrom).toEqual(['queued', 'sent']);
    expect(plan.stamp).toBe('deliveredAt');
    expect(plan.backfill).toEqual(['sentAt']);
  });

  it('read: sai de qualquer não-terminal, backfilla sentAt+deliveredAt (acks pulados)', () => {
    const plan = campaignDeliveryAdvance('read');
    expect(plan.allowedFrom).toEqual(['queued', 'sent', 'delivered']);
    expect(plan.stamp).toBe('readAt');
    expect(plan.backfill).toEqual(['sentAt', 'deliveredAt']);
  });

  it('failed: vence tudo exceto terminais (failed/blocked ausentes do allowedFrom)', () => {
    const plan = campaignDeliveryAdvance('failed');
    expect(plan.allowedFrom).toEqual(['queued', 'sent', 'delivered', 'read']);
    expect(plan.allowedFrom).not.toContain('failed');
    expect(plan.allowedFrom).not.toContain('blocked');
    expect(plan.stamp).toBe('failedAt');
    expect(plan.errorMessage).toBe('channel_status_failed');
  });

  it('nunca permite regressão: nenhum plano aceita sair de um status de rank maior', () => {
    // delivered não pode ser aplicado sobre read (monotônico).
    expect(campaignDeliveryAdvance('delivered').allowedFrom).not.toContain('read');
    expect(campaignDeliveryAdvance('sent').allowedFrom).not.toContain('delivered');
  });
});

describe('computeCampaignMetrics — cumulatividade e rates (CAMPAIGNS.md §11)', () => {
  it('deriva contagens cumulativas: read conta como sent+delivered+read', () => {
    const m = computeCampaignMetrics(agg({ sent: 10, delivered: 5, read: 3 }));
    expect(m.messagesSent).toBe(18);
    expect(m.messagesDelivered).toBe(8);
    expect(m.messagesRead).toBe(3);
  });

  it('rates em fração 0–1 com 2 casas (unidade que rate.ts consome)', () => {
    const m = computeCampaignMetrics(
      agg({ totalRecipients: 100, replied: 9, sent: 10, delivered: 50, read: 40, blocked: 2 }),
    );
    // sent=100, delivered=90, read=40
    expect(m.deliveryRate).toBe('0.90');
    expect(m.readRate).toBe('0.44');
    expect(m.responseRate).toBe('0.09');
    expect(m.blockRate).toBe('0.02');
    expect(Number(m.deliveryRate)).toBeLessThanOrEqual(1);
  });

  it('sem denominador → rate null (rate adaptativo trata null como "sem dados")', () => {
    const m = computeCampaignMetrics(agg({ queued: 50 }));
    expect(m.deliveryRate).toBeNull();
    expect(m.readRate).toBeNull();
    expect(m.responseRate).toBeNull();
    expect(m.blockRate).toBeNull();
    expect(m.healthStatus).toBe('healthy');
    expect(m.messagesQueued).toBe(50);
  });

  it('delivered sem read → readRate calculado sobre delivered', () => {
    const m = computeCampaignMetrics(agg({ delivered: 4, read: 1 }));
    // delivered=5, read=1
    expect(m.readRate).toBe('0.20');
  });

  it('propaga failed/blocked/replied/totalRecipients sem transformação', () => {
    const m = computeCampaignMetrics(
      agg({ totalRecipients: 200, replied: 7, failed: 3, blocked: 1, queued: 2 }),
    );
    expect(m.totalRecipients).toBe(200);
    expect(m.messagesReplied).toBe(7);
    expect(m.messagesFailed).toBe(3);
    expect(m.messagesBlocked).toBe(1);
  });
});

describe('healthStatusOf — limiares do doc', () => {
  it('healthy: dr >= 0.85 e br < 0.02', () => {
    expect(healthStatusOf(0.9, 0.01)).toBe('healthy');
    expect(healthStatusOf(0.85, null)).toBe('healthy');
  });

  it('warning: dr < 0.85 (mas >= 0.70) ou br >= 0.02 (mas < 0.05)', () => {
    expect(healthStatusOf(0.8, 0)).toBe('warning');
    expect(healthStatusOf(0.95, 0.03)).toBe('warning');
  });

  it('critical: dr < 0.70 ou br >= 0.05', () => {
    expect(healthStatusOf(0.6, 0)).toBe('critical');
    expect(healthStatusOf(0.95, 0.05)).toBe('critical');
  });

  it('sem dados (dr null) → healthy (não alarma campanha que não enviou)', () => {
    expect(healthStatusOf(null, null)).toBe('healthy');
  });
});

function fakePorts(over: Partial<CampaignRecomputePorts> = {}): CampaignRecomputePorts {
  return {
    listRecomputableCampaigns: vi.fn(async () => [
      { id: 'c1', workspaceId: 'ws1' },
      { id: 'c2', workspaceId: 'ws2' },
    ]),
    aggregateDeliveries: vi.fn(async () => agg({ sent: 1, delivered: 8, read: 1, replied: 2 })),
    saveMetrics: vi.fn(async () => undefined),
    ...over,
  };
}

describe('runCampaignMetricsRecompute — job', () => {
  it('agrega e grava o snapshot por campanha elegível', async () => {
    const ports = fakePorts();
    const result = await runCampaignMetricsRecompute({ ports, logger });

    expect(result).toEqual({ campaigns: 2, recomputed: 2, failed: 0 });
    expect(ports.saveMetrics).toHaveBeenCalledTimes(2);
    expect(ports.saveMetrics).toHaveBeenCalledWith(
      { id: 'c1', workspaceId: 'ws1' },
      expect.objectContaining({
        messagesSent: 10,
        messagesDelivered: 9,
        messagesRead: 1,
        messagesReplied: 2,
        deliveryRate: '0.90',
        healthStatus: 'healthy',
      }),
      expect.any(Date),
    );
  });

  it('falha em uma campanha NÃO derruba as demais (loga e segue)', async () => {
    const ports = fakePorts({
      aggregateDeliveries: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(agg({ delivered: 1 })),
    });

    const result = await runCampaignMetricsRecompute({ ports, logger });

    expect(result).toEqual({ campaigns: 2, recomputed: 1, failed: 1 });
    expect(ports.saveMetrics).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'campaigns/recompute: falha ao recomputar campanha',
      expect.objectContaining({ campaignId: 'c1', error: 'boom' }),
    );
  });

  it('zero campanhas elegíveis → no-op', async () => {
    const ports = fakePorts({ listRecomputableCampaigns: vi.fn(async () => []) });
    const result = await runCampaignMetricsRecompute({ ports, logger });
    expect(result).toEqual({ campaigns: 0, recomputed: 0, failed: 0 });
    expect(ports.saveMetrics).not.toHaveBeenCalled();
  });
});

function fakeRedis(acquires: boolean): RedisLike & { eval: ReturnType<typeof vi.fn> } {
  return {
    set: vi.fn(async () => (acquires ? ('OK' as const) : null)),
    eval: vi.fn(async () => 1),
  };
}

describe('runScheduledRecompute — singleton via lock Redis', () => {
  it('roda o recompute e libera o lock quando adquire', async () => {
    const redis = fakeRedis(true);
    const ports = fakePorts();

    const ran = await runScheduledRecompute({ ports, redis, logger });

    expect(ran).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      CAMPAIGN_RECOMPUTE_LOCK_KEY,
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );
    expect(ports.saveMetrics).toHaveBeenCalled();
    expect(redis.eval).toHaveBeenCalledOnce(); // unlock
  });

  it('lock detido por outra instância → pula sem tocar nas ports', async () => {
    const redis = fakeRedis(false);
    const ports = fakePorts();

    const ran = await runScheduledRecompute({ ports, redis, logger });

    expect(ran).toBe(false);
    expect(ports.listRecomputableCampaigns).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('erro no job propaga MAS o lock é liberado (finally)', async () => {
    const redis = fakeRedis(true);
    const ports = fakePorts({
      listRecomputableCampaigns: vi.fn(async () => {
        throw new Error('db down');
      }),
    });

    await expect(runScheduledRecompute({ ports, redis, logger })).rejects.toThrow('db down');
    expect(redis.eval).toHaveBeenCalledOnce();
  });
});

describe('campaignRecomputeMsFromEnv', () => {
  it('default 45s quando ausente/ inválido; respeita override válido', () => {
    expect(campaignRecomputeMsFromEnv({})).toBe(DEFAULT_CAMPAIGN_RECOMPUTE_MS);
    expect(campaignRecomputeMsFromEnv({ CAMPAIGN_RECOMPUTE_MS: '' })).toBe(
      DEFAULT_CAMPAIGN_RECOMPUTE_MS,
    );
    expect(campaignRecomputeMsFromEnv({ CAMPAIGN_RECOMPUTE_MS: 'abc' })).toBe(
      DEFAULT_CAMPAIGN_RECOMPUTE_MS,
    );
    expect(campaignRecomputeMsFromEnv({ CAMPAIGN_RECOMPUTE_MS: '-5' })).toBe(
      DEFAULT_CAMPAIGN_RECOMPUTE_MS,
    );
    expect(campaignRecomputeMsFromEnv({ CAMPAIGN_RECOMPUTE_MS: '30000' })).toBe(30_000);
  });
});
