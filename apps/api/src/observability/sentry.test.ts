import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock do SDK do Sentry: capturamos as chamadas sem abrir conexão real. O
 * `withScope` executa o callback com um scope-espião para observar as tags.
 */
const setTag = vi.fn<(key: string, value: string) => void>();
const captureExceptionSdk = vi.fn();
const initSdk = vi.fn();
const withScope = vi.fn((cb: (scope: { setTag: typeof setTag }) => void) => {
  cb({ setTag });
});

vi.mock('@sentry/node', () => ({
  init: initSdk,
  captureException: captureExceptionSdk,
  withScope,
  expressErrorHandler: vi.fn(() => vi.fn()),
}));

/** Reimporta o módulo com estado fresco (`initialized` volta a false). */
async function freshModule() {
  vi.resetModules();
  return import('./sentry');
}

describe('sentry (opt-in por DSN)', () => {
  beforeEach(() => {
    setTag.mockClear();
    captureExceptionSdk.mockClear();
    initSdk.mockClear();
    withScope.mockClear();
    delete process.env['SENTRY_DSN_API'];
  });

  afterEach(() => {
    delete process.env['SENTRY_DSN_API'];
  });

  it('é no-op sem DSN: initSentry=false, isSentryEnabled=false, captura ignorada', async () => {
    const mod = await freshModule();
    expect(mod.initSentry()).toBe(false);
    expect(mod.isSentryEnabled()).toBe(false);
    expect(initSdk).not.toHaveBeenCalled();

    mod.captureException(new Error('boom'), { tags: { ref: 'hm_err_1' } });
    expect(captureExceptionSdk).not.toHaveBeenCalled();
    expect(withScope).not.toHaveBeenCalled();
  });

  it('com DSN: inicializa uma vez (idempotente) e reporta com PII desligado', async () => {
    process.env['SENTRY_DSN_API'] = 'https://public@example.ingest.sentry.io/42';
    const mod = await freshModule();

    expect(mod.initSentry()).toBe(true);
    expect(mod.initSentry()).toBe(true); // idempotente
    expect(initSdk).toHaveBeenCalledTimes(1);
    expect(initSdk.mock.calls[0]?.[0]).toMatchObject({ sendDefaultPii: false });
    expect(mod.isSentryEnabled()).toBe(true);
  });

  it('captura com tags via withScope, ignorando valores vazios/undefined', async () => {
    process.env['SENTRY_DSN_API'] = 'https://public@example.ingest.sentry.io/42';
    const mod = await freshModule();
    mod.initSentry();

    const err = new Error('kaboom');
    mod.captureException(err, { tags: { ref: 'hm_err_ab12', workspaceId: undefined } });

    expect(withScope).toHaveBeenCalledTimes(1);
    expect(setTag).toHaveBeenCalledWith('ref', 'hm_err_ab12');
    expect(setTag).not.toHaveBeenCalledWith('workspaceId', expect.anything());
    expect(captureExceptionSdk).toHaveBeenCalledWith(err);
  });

  it('captura sem tags não abre scope', async () => {
    process.env['SENTRY_DSN_API'] = 'https://public@example.ingest.sentry.io/42';
    const mod = await freshModule();
    mod.initSentry();

    mod.captureException(new Error('plain'));
    expect(withScope).not.toHaveBeenCalled();
    expect(captureExceptionSdk).toHaveBeenCalledTimes(1);
  });
});
