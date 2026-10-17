/**
 * F73-S03 — `COPILOT_GRANT_SECRET` na configuração (ADR-003 §2): o boot de produção falha
 * sem ela; valor curto falha em qualquer ambiente; dev sem a variável gera um segredo por
 * processo (estável dentro do processo).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COPILOT_GRANT_SECRET_ENV,
  COPILOT_GRANT_SECRET_MIN_BYTES,
  copilotGrantSecret,
  loadConfig,
} from '../../../config';

const STRONG = 'k'.repeat(COPILOT_GRANT_SECRET_MIN_BYTES);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('copilotGrantSecret', () => {
  it('produção sem a variável → loadConfig lança (o boot falha)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(COPILOT_GRANT_SECRET_ENV, '');
    expect(() => loadConfig()).toThrow(COPILOT_GRANT_SECRET_ENV);
  });

  it('produção com segredo forte → sobe', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(COPILOT_GRANT_SECRET_ENV, STRONG);
    expect(() => loadConfig()).not.toThrow();
    expect(copilotGrantSecret().equals(Buffer.from(STRONG, 'utf8'))).toBe(true);
  });

  it('segredo com menos de 32 bytes → lança em qualquer ambiente', () => {
    for (const env of ['production', 'development', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv(COPILOT_GRANT_SECRET_ENV, 'k'.repeat(COPILOT_GRANT_SECRET_MIN_BYTES - 1));
      expect(() => copilotGrantSecret()).toThrow(/32 bytes/);
    }
  });

  it('o tamanho é medido em bytes (UTF-8), não em caracteres', () => {
    vi.stubEnv('NODE_ENV', 'development');
    // 16 caracteres "é" = 32 bytes: aceito.
    vi.stubEnv(COPILOT_GRANT_SECRET_ENV, 'é'.repeat(16));
    expect(copilotGrantSecret().length).toBe(32);
  });

  it('dev sem a variável → segredo efêmero de 32 bytes, o mesmo em todo o processo', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(COPILOT_GRANT_SECRET_ENV, '');
    const a = copilotGrantSecret();
    const b = copilotGrantSecret();
    expect(a.length).toBe(COPILOT_GRANT_SECRET_MIN_BYTES);
    expect(a.equals(b)).toBe(true);
    expect(() => loadConfig()).not.toThrow();
  });
});
