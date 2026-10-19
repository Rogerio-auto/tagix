/**
 * F73-S17 — chave global do Copiloto (`COPILOT_ENABLED`) nos workers.
 *
 * Mesma regra da API (cópia local, mesmo teste). Desligado: o piloto automático não é
 * registrado e a varredura de retenção do histórico do Copiloto também não.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import {
  COPILOT_AUTOPILOT_WORKER_NAME,
  copilotRetentionOverrides,
  parseCopilotEnabled,
  startCopilotJobs,
  type CopilotJobsDeps,
} from './index';

describe('parseCopilotEnabled (workers)', () => {
  const cases: ReadonlyArray<readonly [string, NodeJS.ProcessEnv, boolean]> = [
    ['produção sem a variável → desligado', { NODE_ENV: 'production' }, false],
    [
      'produção com a variável vazia → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: '' },
      false,
    ],
    [
      'produção com valor inválido → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: 'yes' },
      false,
    ],
    ['produção com "1" → desligado', { NODE_ENV: 'production', COPILOT_ENABLED: '1' }, false],
    ['produção com "true" → ligado', { NODE_ENV: 'production', COPILOT_ENABLED: 'true' }, true],
    ['produção com "TRUE " → ligado', { NODE_ENV: 'production', COPILOT_ENABLED: 'TRUE ' }, true],
    [
      'produção com "false" → desligado',
      { NODE_ENV: 'production', COPILOT_ENABLED: 'false' },
      false,
    ],
    ['desenvolvimento sem a variável → ligado', { NODE_ENV: 'development' }, true],
    ['sem NODE_ENV e sem a variável → ligado (dev)', {}, true],
    ['teste sem a variável → ligado', { NODE_ENV: 'test' }, true],
    ['teste com "false" → desligado', { NODE_ENV: 'test', COPILOT_ENABLED: 'false' }, false],
    [
      'desenvolvimento com valor inválido → desligado',
      { NODE_ENV: 'development', COPILOT_ENABLED: 'flase' },
      false,
    ],
  ];
  it.each(cases)('%s', (_name, env, expected) => {
    expect(parseCopilotEnabled(env)).toBe(expected);
  });
});

function silentLogger(): Logger {
  const logger: unknown = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return logger as Logger;
}

function jobsDeps(enabled: boolean) {
  const stop = vi.fn(async (): Promise<void> => undefined);
  const startAutopilot = vi.fn((): { stop(): Promise<void> } => ({ stop }));
  const redis: unknown = {};
  const channel: unknown = {};
  const deps: CopilotJobsDeps = {
    enabled,
    redis: redis as CopilotJobsDeps['redis'],
    logger: silentLogger(),
    channel: channel as CopilotJobsDeps['channel'],
    startAutopilot,
  };
  return { deps, startAutopilot };
}

describe('startCopilotJobs', () => {
  it('desligado: o copilot-autopilot-scheduler NÃO é registrado', () => {
    const { deps, startAutopilot } = jobsDeps(false);
    const jobs = startCopilotJobs(deps);
    expect(startAutopilot).not.toHaveBeenCalled();
    expect(jobs.autopilot).toBeNull();
    expect(jobs.workerNames).toEqual([]);
  });

  it('ligado: o copilot-autopilot-scheduler é registrado uma vez', () => {
    const { deps, startAutopilot } = jobsDeps(true);
    const jobs = startCopilotJobs(deps);
    expect(startAutopilot).toHaveBeenCalledTimes(1);
    expect(jobs.autopilot).not.toBeNull();
    expect(jobs.workerNames).toEqual([COPILOT_AUTOPILOT_WORKER_NAME]);
    expect(COPILOT_AUTOPILOT_WORKER_NAME).toBe('copilot-autopilot-scheduler');
  });
});

describe('copilotRetentionOverrides', () => {
  it('desligado: desliga a retenção do histórico do Copiloto', () => {
    expect(copilotRetentionOverrides(false)).toEqual({ copilotHistory: false });
  });

  it('ligado: não altera o worker de retenção', () => {
    expect(copilotRetentionOverrides(true)).toEqual({});
  });
});
