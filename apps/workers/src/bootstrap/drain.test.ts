import { describe, expect, it } from 'vitest';
import { createDrainController, drainDeadlineFromEnv } from './drain';

describe('createDrainController', () => {
  it('contabiliza in-flight durante o track e zera ao concluir', async () => {
    const drain = createDrainController();
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const p = drain.track(() => gate);
    expect(drain.inFlight).toBe(1);
    resolve();
    await p;
    expect(drain.inFlight).toBe(0);
  });

  it('decrementa in-flight mesmo se o handler lançar', async () => {
    const drain = createDrainController();
    await expect(
      drain.track(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(drain.inFlight).toBe(0);
  });

  it('drain resolve true quando o in-flight zera dentro do prazo', async () => {
    const drain = createDrainController();
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const work = drain.track(() => gate);
    const draining = drain.drain(1000, 5);
    expect(drain.draining).toBe(true);
    setTimeout(resolve, 10);
    await expect(draining).resolves.toBe(true);
    await work;
  });

  it('drain resolve false quando o deadline estoura com in-flight preso', async () => {
    const drain = createDrainController();
    // trabalho que nunca resolve
    void drain.track(() => new Promise<void>(() => undefined));
    const drained = await drain.drain(30, 5);
    expect(drained).toBe(false);
    expect(drain.inFlight).toBe(1);
  });

  it('drain retorna true imediatamente sem in-flight', async () => {
    const drain = createDrainController();
    await expect(drain.drain(1000)).resolves.toBe(true);
  });
});

describe('drainDeadlineFromEnv', () => {
  it('default 10s sem env', () => {
    expect(drainDeadlineFromEnv({})).toBe(10_000);
  });
  it('respeita valor válido', () => {
    expect(drainDeadlineFromEnv({ WORKERS_DRAIN_DEADLINE_MS: '5000' })).toBe(5000);
  });
  it('cai no default com valor inválido', () => {
    expect(drainDeadlineFromEnv({ WORKERS_DRAIN_DEADLINE_MS: 'abc' })).toBe(10_000);
    expect(drainDeadlineFromEnv({ WORKERS_DRAIN_DEADLINE_MS: '-3' })).toBe(10_000);
  });
});
