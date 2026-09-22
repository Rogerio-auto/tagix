/**
 * F69-S03 — reconciliação recupera lead que o webhook não entregou.
 *
 * Sem Redis nem Meta: trava e portas são fakes. Protege que a conferência enfileira
 * o que achou, só avança a janela quando termina, e não roda em duas réplicas.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ActiveLeadSource } from '@hm/db';
import type { RedisLike } from '../flows/scheduler';
import { runLeadgenReconcile, type ReconcilePorts } from './reconcile';
import type { LeadgenJob } from './ports';

function redisLivre(): RedisLike {
  const chaves = new Map<string, string>();
  return {
    set: async (key, value) => {
      if (chaves.has(key)) return null;
      chaves.set(key, value);
      return 'OK';
    },
    eval: async (_script, _n, key) => {
      chaves.delete(key ?? '');
      return 1;
    },
  };
}

const FONTE: ActiveLeadSource = {
  workspaceId: 'ws1',
  sourceId: 's1',
  connectionId: 'c1',
  pageId: 'pg1',
  lastReconciledAt: new Date('2026-09-15T11:45:00Z'),
};

function portas(over: Partial<ReconcilePorts> = {}) {
  const enfileirados: LeadgenJob[] = [];
  const marcados: string[] = [];
  const p: ReconcilePorts = {
    listActiveSources: async () => [FONTE],
    tokenFor: async () => 'tok',
    listLeadIdsSince: async () => [{ leadgenId: 'perdido', formId: 'f1', adId: 'ad1' }],
    enqueue: async (job) => {
      enfileirados.push(job);
    },
    markReconciled: async (f) => {
      marcados.push(f.sourceId);
    },
    ...over,
  };
  return { p, enfileirados, marcados };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const agora = new Date('2026-09-15T12:00:00Z');

describe('runLeadgenReconcile', () => {
  it('enfileira o lead que o webhook perdeu e avança a janela', async () => {
    const { p, enfileirados, marcados } = portas();
    const listar = vi.spyOn(p, 'listLeadIdsSince');
    const r = await runLeadgenReconcile({ redis: redisLivre(), ports: p, logger }, agora);
    expect(r).toEqual({ ran: true, sources: 1, enqueued: 1, failedSources: 0 });
    expect(enfileirados).toEqual([
      { leadgenId: 'perdido', pageId: 'pg1', formId: 'f1', adId: 'ad1', origin: 'reconciliation' },
    ]);
    expect(marcados).toEqual(['s1']);
    // Volta 10 minutos antes da última conferência.
    expect(listar.mock.calls[0]?.[0].since.toISOString()).toBe('2026-09-15T11:35:00.000Z');
  });

  it('falha na Meta não avança a janela — a próxima rodada repete', async () => {
    const { p, marcados } = portas({
      listLeadIdsSince: async () => {
        throw new Error('Meta fora');
      },
    });
    const r = await runLeadgenReconcile({ redis: redisLivre(), ports: p, logger }, agora);
    expect(r.failedSources).toBe(1);
    expect(marcados).toEqual([]);
  });

  it('conexão sem token conta como falha e não chama a Meta', async () => {
    const listar = vi.fn(async () => []);
    const { p } = portas({ tokenFor: async () => null, listLeadIdsSince: listar });
    const r = await runLeadgenReconcile({ redis: redisLivre(), ports: p, logger }, agora);
    expect(r.failedSources).toBe(1);
    expect(listar).not.toHaveBeenCalled();
  });

  it('outra réplica com a trava: não roda', async () => {
    const redis = redisLivre();
    await redis.set('hm:lock:leadgen-reconcile', 'outra', 'PX', 1000, 'NX');
    const { p, enfileirados } = portas();
    const r = await runLeadgenReconcile({ redis, ports: p, logger }, agora);
    expect(r.ran).toBe(false);
    expect(enfileirados).toEqual([]);
  });
});
