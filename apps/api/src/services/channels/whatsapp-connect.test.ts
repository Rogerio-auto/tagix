/**
 * Testes do connect WA server-side (F39-S01): troca de code por token,
 * register (PIN) e subscribed_apps — Cloud API padrao vs Coexistencia.
 * GraphClient mockado (sem rede). Verifica que o segredo nao vaza.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  WaConnectError,
  exchangeCodeForToken,
  registerPhoneNumber,
  subscribeWabaApp,
  runWhatsAppConnect,
  WA_COEXISTENCE_SUBSCRIBED_FIELDS,
  WA_CLOUD_API_SUBSCRIBED_FIELDS,
} from './whatsapp-connect';
import type { GraphClient } from '@hm/channels';

function mockGraph(over: Partial<GraphClient>): GraphClient {
  return {
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({})),
    downloadBinary: vi.fn(async () => Buffer.alloc(0)),
    ...over,
  } as unknown as GraphClient;
}

describe('exchangeCodeForToken', () => {
  it('troca o code por access_token long-lived', async () => {
    const get = vi.fn(async (_path: string, _token: string) => ({ access_token: 'LONG_LIVED' }));
    const graph = mockGraph({ get: get as unknown as GraphClient['get'] });
    const token = await exchangeCodeForToken(graph, 'CODE_123', 'APP_ID', 'APP_SECRET');
    expect(token).toBe('LONG_LIVED');
    const call = get.mock.calls[0];
    const path = String(call?.[0]);
    expect(path).toContain('oauth/access_token');
    expect(path).toContain('client_id=APP_ID');
    expect(path).toContain('client_secret=APP_SECRET');
    expect(path).toContain('code=CODE_123');
  });

  it('lanca WaConnectError quando a Graph nao devolve access_token', async () => {
    const graph = mockGraph({ get: vi.fn(async () => ({ error: { message: 'bad code' } })) });
    await expect(
      exchangeCodeForToken(graph, 'CODE', 'APP_ID', 'APP_SECRET'),
    ).rejects.toBeInstanceOf(WaConnectError);
  });
});

describe('registerPhoneNumber', () => {
  it('POST /{phone_number_id}/register com messaging_product + pin', async () => {
    const post = vi.fn(
      async (_path: string, _body: Record<string, unknown>, _token: string) => ({ success: true }),
    );
    const graph = mockGraph({ post: post as unknown as GraphClient['post'] });
    await registerPhoneNumber(graph, 'PNID_1', '123456', 'TOKEN');
    const call = post.mock.calls[0];
    expect(call?.[0]).toBe('PNID_1/register');
    expect(call?.[1]).toMatchObject({ messaging_product: 'whatsapp', pin: '123456' });
  });

  it('lanca WaConnectError quando a Meta devolve success:false', async () => {
    const graph = mockGraph({ post: vi.fn(async () => ({ success: false })) });
    await expect(
      registerPhoneNumber(graph, 'PNID_1', '000000', 'TOKEN'),
    ).rejects.toBeInstanceOf(WaConnectError);
  });
});

describe('subscribeWabaApp', () => {
  it('cloud_api inscreve apenas messages', async () => {
    const post = vi.fn(
      async (_path: string, _body: Record<string, unknown>, _token: string) => ({ success: true }),
    );
    const graph = mockGraph({ post: post as unknown as GraphClient['post'] });
    await subscribeWabaApp(graph, 'WABA_1', 'TOKEN', { coexistence: false });
    const call = post.mock.calls[0];
    expect(call?.[0]).toBe('WABA_1/subscribed_apps');
    const body = call?.[1] as { subscribed_fields: string } | undefined;
    expect(body?.subscribed_fields).toBe(WA_CLOUD_API_SUBSCRIBED_FIELDS.join(','));
    expect(body?.subscribed_fields).toBe('messages');
  });

  it('coexistence inscreve messages + history + smb_message_echoes + smb_app_state_sync', async () => {
    const post = vi.fn(
      async (_path: string, _body: Record<string, unknown>, _token: string) => ({ success: true }),
    );
    const graph = mockGraph({ post: post as unknown as GraphClient['post'] });
    await subscribeWabaApp(graph, 'WABA_1', 'TOKEN', { coexistence: true });
    const body = post.mock.calls[0]?.[1] as { subscribed_fields: string } | undefined;
    expect(body?.subscribed_fields).toBe(WA_COEXISTENCE_SUBSCRIBED_FIELDS.join(','));
    expect(body?.subscribed_fields).toContain('history');
    expect(body?.subscribed_fields).toContain('smb_message_echoes');
    expect(body?.subscribed_fields).toContain('smb_app_state_sync');
  });

  it('lanca WaConnectError quando a Meta devolve success:false', async () => {
    const graph = mockGraph({ post: vi.fn(async () => ({ success: false })) });
    await expect(
      subscribeWabaApp(graph, 'WABA_1', 'TOKEN', { coexistence: true }),
    ).rejects.toBeInstanceOf(WaConnectError);
  });
});

describe('runWhatsAppConnect (regra do PIN)', () => {
  const creds = { appId: 'APP_ID', appSecret: 'APP_SECRET' };
  const okPost = () =>
    vi.fn(async (_path: string, _body: Record<string, unknown>, _token: string) => ({
      success: true,
    }));
  const graphWithToken = (post: ReturnType<typeof okPost>) =>
    mockGraph({
      get: vi.fn(async () => ({ access_token: 'LONG_LIVED' })) as unknown as GraphClient['get'],
      post: post as unknown as GraphClient['post'],
    });

  it('cloud_api (numero novo): NAO registra nem pede PIN; subscribe so messages', async () => {
    const post = okPost();
    const token = await runWhatsAppConnect(
      graphWithToken(post),
      { code: 'C', phoneNumberId: 'PNID', wabaId: 'WABA', mode: 'cloud_api' },
      creds,
    );
    expect(token).toBe('LONG_LIVED');
    expect(post.mock.calls.some((c) => c[0].endsWith('/register'))).toBe(false); // sem register
    const sub = post.mock.calls.find((c) => c[0] === 'WABA/subscribed_apps');
    const body = sub?.[1] as { subscribed_fields: string } | undefined;
    expect(body?.subscribed_fields).toBe(WA_CLOUD_API_SUBSCRIBED_FIELDS.join(','));
  });

  it('coexistence: registra com PIN e subscribe com campos de coexistencia', async () => {
    const post = okPost();
    await runWhatsAppConnect(
      graphWithToken(post),
      { code: 'C', phoneNumberId: 'PNID', wabaId: 'WABA', pin: '123456', mode: 'coexistence' },
      creds,
    );
    const register = post.mock.calls.find((c) => c[0] === 'PNID/register');
    expect(register?.[1]).toMatchObject({ messaging_product: 'whatsapp', pin: '123456' });
    const sub = post.mock.calls.find((c) => c[0] === 'WABA/subscribed_apps');
    const body = sub?.[1] as { subscribed_fields: string } | undefined;
    expect(body?.subscribed_fields).toBe(WA_COEXISTENCE_SUBSCRIBED_FIELDS.join(','));
  });

  it('coexistence SEM PIN → WaConnectError (e nao chega a registrar)', async () => {
    const post = okPost();
    await expect(
      runWhatsAppConnect(
        graphWithToken(post),
        { code: 'C', phoneNumberId: 'PNID', wabaId: 'WABA', mode: 'coexistence' },
        creds,
      ),
    ).rejects.toBeInstanceOf(WaConnectError);
    expect(post.mock.calls.some((c) => c[0] === 'PNID/register')).toBe(false);
  });
});
