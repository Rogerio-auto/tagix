/**
 * Testes do connect IG (F15-S06): listagem de contas (rejeita Personal),
 * subscribe webhook e test message — GraphClient mockado (sem rede).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  IgConnectError,
  listInstagramAccounts,
  subscribeInstagramWebhook,
  sendInstagramTestMessage,
} from './instagram-connect';
import type { GraphClient } from '@hm/channels';

function mockGraph(over: Partial<GraphClient>): GraphClient {
  return {
    get: vi.fn(async () => ({ data: [] })),
    post: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    downloadBinary: vi.fn(async () => Buffer.alloc(0)),
    ...over,
  } as unknown as GraphClient;
}

describe('listInstagramAccounts', () => {
  it('retorna candidatas Business/Creator com IGBA vinculada', async () => {
    const graph = mockGraph({
      get: vi.fn(async () => ({
        data: [
          {
            id: 'PAGE_1',
            name: 'Loja',
            access_token: 'PAGE_TOKEN',
            instagram_business_account: { id: 'IGUSER_1', username: 'loja', account_type: 'BUSINESS' },
          },
        ],
      })),
    });
    const accounts = await listInstagramAccounts(graph, 'USER_TOKEN');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      pageId: 'PAGE_1',
      igUserId: 'IGUSER_1',
      igUsername: 'loja',
      igAccountType: 'business',
      pageAccessToken: 'PAGE_TOKEN',
    });
  });

  it('rejeita quando nenhuma Pagina tem IGBA (Personal)', async () => {
    const graph = mockGraph({
      get: vi.fn(async () => ({ data: [{ id: 'PAGE_1', name: 'Sem IG', access_token: 'T' }] })),
    });
    await expect(listInstagramAccounts(graph, 'USER_TOKEN')).rejects.toBeInstanceOf(IgConnectError);
  });
});

describe('subscribeInstagramWebhook', () => {
  it('faz POST em /{pageId}/subscribed_apps com os campos IG', async () => {
    const post = vi.fn(
      async (_path: string, _body: Record<string, unknown>, _token: string) => ({ success: true }),
    );
    const graph = mockGraph({ post: post as unknown as GraphClient['post'] });
    await subscribeInstagramWebhook(graph, 'PAGE_1', 'PAGE_TOKEN');
    expect(post).toHaveBeenCalledOnce();
    const call = post.mock.calls[0];
    expect(call?.[0]).toBe('PAGE_1/subscribed_apps');
    const body = call?.[1] as { subscribed_fields: string } | undefined;
    expect(String(body?.subscribed_fields)).toContain('comments');
  });
});

describe('sendInstagramTestMessage', () => {
  it('retorna true quando a Graph devolve message_id', async () => {
    const graph = mockGraph({ post: vi.fn(async () => ({ message_id: 'mid.1', recipient_id: 'IGSID' })) });
    const ok = await sendInstagramTestMessage(graph, 'IGUSER_1', 'IGSID', 'PAGE_TOKEN');
    expect(ok).toBe(true);
  });
});
