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

describe('sentry — segredos de convite nunca saem (F71-S05, B3)', () => {
  const TOKEN = 'Q2xhcm9RdWVOYW9FdW1Ub2tlblJlYWxNYXNQYXJlY2UxMjM';
  const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

  it('initSentry liga beforeSend, beforeSendTransaction e beforeBreadcrumb', async () => {
    process.env['SENTRY_DSN_API'] = 'https://public@example.ingest.sentry.io/42';
    const mod = await freshModule();
    mod.initSentry();
    const opts = initSdk.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof opts['beforeSend']).toBe('function');
    expect(typeof opts['beforeSendTransaction']).toBe('function');
    expect(typeof opts['beforeBreadcrumb']).toBe('function');
  });

  it('scrubInviteSecrets mascara token no caminho e token_hash/redirect_to na query', async () => {
    const { scrubInviteSecrets } = await freshModule();
    expect(scrubInviteSecrets(`https://app.x/convite/${TOKEN}?token_hash=${HASH}&type=invite`)).toBe(
      'https://app.x/convite/[redacted]?token_hash=[redacted]&type=invite',
    );
    // Fragmento (formato do link do email, runbook §4.3/§4.4).
    expect(scrubInviteSecrets(`https://app.x/convite/${TOKEN}#token_hash=${HASH}&type=invite`)).toBe(
      'https://app.x/convite/[redacted]#token_hash=[redacted]&type=invite',
    );
    expect(scrubInviteSecrets(`GET /auth/invite/${TOKEN}`)).toBe('GET /auth/invite/[redacted]');
    expect(
      scrubInviteSecrets(`/auth/v1/invite?redirect_to=https%3A%2F%2Fapp.x%2Fconvite%2F${TOKEN}`),
    ).toBe('/auth/v1/invite?redirect_to=[redacted]');
    expect(scrubInviteSecrets(`x=%2Fconvite%2F${TOKEN}`)).toBe('x=%2Fconvite%2F[redacted]');
    // Rotas literais da API continuam legíveis.
    expect(scrubInviteSecrets('POST /auth/invite/accept')).toBe('POST /auth/invite/accept');
    expect(scrubInviteSecrets('/auth/invite/preview?x=1')).toBe('/auth/invite/preview?x=1');
    expect(scrubInviteSecrets('/auth/invite/send-email')).toBe('/auth/invite/send-email');
  });

  it('scrubSentryEvent cobre url, query, headers, corpo, mensagem, exceção e breadcrumbs', async () => {
    const { scrubSentryEvent } = await freshModule();
    const event = scrubSentryEvent({
      transaction: `GET /convite/${TOKEN}`,
      message: `falhou em /auth/invite/${TOKEN}`,
      exception: { values: [{ type: 'Error', value: `token_hash=${HASH}` }] },
      request: {
        url: `https://api.x/auth/invite/${TOKEN}`,
        query_string: `token_hash=${HASH}&type=magiclink`,
        headers: {
          referer: `https://app.x/convite/${TOKEN}?token_hash=${HASH}`,
          authorization: 'Bearer abc',
          'user-agent': 'vitest',
        },
        data: JSON.stringify({
          token: TOKEN,
          password: 'Senha-forte-123',
          emailProof: { tokenHash: HASH, type: 'invite' },
          name: 'Ana',
        }),
      },
      breadcrumbs: [
        { category: 'http', data: { url: `https://app.x/convite/${TOKEN}`, method: 'GET' } },
      ],
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain('Senha-forte-123');
    expect(text).not.toContain('Bearer abc');
    expect(event.request?.headers?.['user-agent']).toBe('vitest');
    expect(JSON.parse(String(event.request?.data))).toMatchObject({ name: 'Ana' });
    expect(event.request?.query_string).toBe('token_hash=[redacted]&type=magiclink');
  });

  it('corpo como objeto e breadcrumb isolado também são mascarados', async () => {
    const { scrubSentryEvent, scrubBreadcrumb } = await freshModule();
    const event = scrubSentryEvent({ request: { data: { token: TOKEN, nested: { password: 'x' } } } });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(JSON.stringify(event)).not.toContain('"x"');
    const crumb = scrubBreadcrumb({ message: `nav /convite/${TOKEN}`, data: { to: `/convite/${TOKEN}` } });
    expect(JSON.stringify(crumb)).not.toContain(TOKEN);
  });

  it('cookies do request são zerados (defesa em profundidade, L5) — também na transação', async () => {
    const { scrubSentryEvent } = await freshModule();
    const cookies = { hm_session: 'sessao-secreta', sb_refresh: 'refresh-secreto' };
    const event = scrubSentryEvent({ request: { url: 'https://api.x/api/me', cookies: { ...cookies } } });
    expect(event.request?.cookies).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('sessao-secreta');
    expect(event.request?.url).toBe('https://api.x/api/me');

    const tx = scrubSentryEvent({
      type: 'transaction',
      transaction: 'GET /api/me',
      request: { cookies: { ...cookies } },
    });
    expect(tx.request?.cookies).toBeUndefined();
    expect(JSON.stringify(tx)).not.toContain('refresh-secreto');
  });

  it('beforeSend e beforeSendTransaction ligados no init zeram cookies', async () => {
    process.env['SENTRY_DSN_API'] = 'https://public@example.ingest.sentry.io/42';
    const mod = await freshModule();
    mod.initSentry();
    const opts = initSdk.mock.calls[0]?.[0] as Record<string, (e: unknown) => unknown>;
    for (const hook of ['beforeSend', 'beforeSendTransaction'] as const) {
      const fn = opts[hook];
      expect(typeof fn).toBe('function');
      const out = fn?.({ request: { cookies: { hm_session: 'sessao-secreta' } } });
      expect(JSON.stringify(out)).not.toContain('sessao-secreta');
    }
  });
});
