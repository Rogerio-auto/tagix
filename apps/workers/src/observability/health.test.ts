import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHealthProbes,
  clearSchedulerHeartbeats,
  getHealthReport,
  getSchedulerHeartbeat,
  recordSchedulerHeartbeat,
  registerHealthProbe,
  schedulerFreshnessProbe,
} from './health';

afterEach(() => {
  clearHealthProbes();
  clearSchedulerHeartbeats();
});

describe('getHealthReport', () => {
  it('é ok quando não há probes (vacuamente saudável)', () => {
    expect(getHealthReport()).toEqual({ status: 'ok', checks: {} });
  });

  it('é ok quando todas as probes estão healthy', () => {
    registerHealthProbe('a', () => ({ healthy: true }));
    registerHealthProbe('b', () => ({ healthy: true, detail: { x: 1 } }));
    const report = getHealthReport();
    expect(report.status).toBe('ok');
    expect(report.checks['b']?.detail).toEqual({ x: 1 });
  });

  it('é unhealthy se QUALQUER probe reprovar', () => {
    registerHealthProbe('amqp', () => ({ healthy: true }));
    registerHealthProbe('sched', () => ({ healthy: false, detail: { ageMs: 999 } }));
    const report = getHealthReport();
    expect(report.status).toBe('unhealthy');
    expect(report.checks['sched']?.healthy).toBe(false);
  });

  it('trata probe que lança como unhealthy (nunca derruba o /healthz)', () => {
    registerHealthProbe('boom', () => {
      throw new Error('kaboom');
    });
    const report = getHealthReport();
    expect(report.status).toBe('unhealthy');
    expect(report.checks['boom']).toEqual({ healthy: false, detail: { error: 'kaboom' } });
  });

  it('o deregistrador remove a probe', () => {
    const off = registerHealthProbe('temp', () => ({ healthy: false }));
    expect(getHealthReport().status).toBe('unhealthy');
    off();
    expect(getHealthReport().status).toBe('ok');
  });
});

describe('schedulerFreshnessProbe', () => {
  it('é healthy sem heartbeat ainda (1º tick não rodou)', () => {
    const probe = schedulerFreshnessProbe('flow-wakeup', 1000, () => 100_000);
    expect(probe().healthy).toBe(true);
    expect(probe().detail).toMatchObject({ state: 'no-heartbeat-yet' });
  });

  it('é healthy enquanto o heartbeat é mais novo que maxAge', () => {
    recordSchedulerHeartbeat('flow-wakeup', 100_000);
    const probe = schedulerFreshnessProbe('flow-wakeup', 5000, () => 103_000);
    expect(probe().healthy).toBe(true);
    expect(probe().detail).toMatchObject({ ageMs: 3000 });
  });

  it('é unhealthy quando o heartbeat expira (tick travado)', () => {
    recordSchedulerHeartbeat('flow-wakeup', 100_000);
    const probe = schedulerFreshnessProbe('flow-wakeup', 5000, () => 110_000);
    expect(probe().healthy).toBe(false);
  });

  it('recordSchedulerHeartbeat atualiza o timestamp lido', () => {
    recordSchedulerHeartbeat('x', 42);
    expect(getSchedulerHeartbeat('x')).toBe(42);
  });
});
