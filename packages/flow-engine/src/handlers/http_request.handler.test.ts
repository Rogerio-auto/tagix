/**
 * F75-S16 — no `http_request` com o port real guardado: destino interno vira FALHA do no
 * (`ssrf_blocked`) com mensagem legivel, sem retry e sem vazar IP. Sem rede externa.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DnsLookupAll } from '@hm/shared/net';
import type { FlowExecutionContext, FlowHttpRequest, FlowNode } from '../types';
import {
  createFlowHttpPort,
  FLOW_HTTP_ERROR_MESSAGES,
  FlowHttpBlockedError,
  FlowHttpError,
  SSRF_BLOCKED_CODE,
  SSRF_BLOCKED_MESSAGE,
  SSRF_PORT_BLOCKED_MESSAGE,
} from '../ports/http.port';
import { httpRequestHandler } from './http_request.handler';

const NETWORK_MESSAGE = FLOW_HTTP_ERROR_MESSAGES.network_error;

const PRIVATE_IP = '10.9.8.7';
const dnsToPrivate: DnsLookupAll = (hostname, _o, cb) => {
  if (hostname === 'crm.cliente.com') cb(null, [{ address: PRIVATE_IP, family: 4 }]);
  else cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
};

function makeCtx(over: Partial<FlowExecutionContext> = {}): FlowExecutionContext {
  return {
    workspaceId: 'ws',
    executionId: 'ex',
    flowId: 'f',
    conversationId: 'c1',
    contactId: 'ct1',
    variables: {},
    sendMessage: vi.fn(async () => {}),
    sendPresence: vi.fn(async () => {}),
    setConversationAi: vi.fn(async () => ({ applied: true as const })),
    setConversationStatus: vi.fn(async () => {}),
    httpRequest: vi.fn(async () => ({ status: 200, ok: true, body: null, headers: {} })),
    log: vi.fn(),
    now: () => new Date('2026-10-16T00:00:00.000Z'),
    sleep: vi.fn(async () => {}),
    ...over,
  };
}

const node = (data: unknown): FlowNode<never> => ({
  id: 'n1',
  type: 'http_request',
  data: data as never,
});
const noDelay = { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 };

function expectSsrfFailure(r: Awaited<ReturnType<typeof httpRequestHandler.execute>>): string {
  expect(r.status).toBe('ERROR');
  if (r.status !== 'ERROR') throw new Error('unreachable');
  expect(r.error).toContain(SSRF_BLOCKED_MESSAGE);
  expect(r.error).toContain(SSRF_BLOCKED_CODE);
  return r.error;
}

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redir') {
      res.writeHead(302, { location: 'http://crm.cliente.com/interno' }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"id":"42"}}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('http_request handler — guarda SSRF (port real)', () => {
  const guarded = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: dnsToPrivate });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://127.0.0.1:5432',
    'http://10.0.0.5',
    'http://[::1]',
  ])('%s ⇒ falha do no ssrf_blocked, sem retry', async (url) => {
    const httpRequest = vi.fn((req: FlowHttpRequest) => guarded.request(req));
    const ctx = makeCtx({ httpRequest });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url, retryPolicy: noDelay }),
      ctx,
    );
    expectSsrfFailure(r);
    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(ctx.sleep).not.toHaveBeenCalled();
  });

  it('DNS resolvendo para IP privado: mensagem legivel, IP nao aparece no erro nem no log', async () => {
    const ctx = makeCtx({
      httpRequest: (req) => guarded.request(req),
      variables: { host: 'crm.cliente.com' },
    });
    const r = await httpRequestHandler.execute(
      node({ method: 'POST', url: 'https://{{host}}/api', body: '{"a":1}', bodyMode: 'json' }),
      ctx,
    );
    const error = expectSsrfFailure(r);
    expect(error).toBe(`${SSRF_BLOCKED_MESSAGE} [${SSRF_BLOCKED_CODE}]`);
    expect(error).not.toContain(PRIVATE_IP);
    const logged = JSON.stringify(vi.mocked(ctx.log).mock.calls);
    expect(logged).not.toContain(PRIVATE_IP);
    expect(logged).toContain(SSRF_BLOCKED_CODE);
  });

  it('redirect 302 para host interno ⇒ ssrf_blocked', async () => {
    const port = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], lookupImpl: dnsToPrivate });
    const ctx = makeCtx({ httpRequest: (req) => port.request(req) });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: `${base}/redir`, retryPolicy: noDelay }),
      ctx,
    );
    const error = expectSsrfFailure(r);
    expect(error).not.toContain(PRIVATE_IP);
  });

  it('destino permitido (allowlist de dev) segue funcionando com mapeamento', async () => {
    const port = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const ctx = makeCtx({ httpRequest: (req) => port.request(req) });
    const r = await httpRequestHandler.execute(
      node({
        method: 'GET',
        url: `${base}/ok`,
        responseMapping: [{ path: '$.data.id', variable: 'pedido_id' }],
      }),
      ctx,
    );
    expect(r).toMatchObject({
      status: 'SUCCESS',
      edgeHandle: 'success',
      variables: { pedido_id: '42', webhook_response: { status: 200, ok: true } },
    });
  });

  it('port injetado que lanca erro com code ssrf_blocked tambem e reconhecido', async () => {
    const httpRequest = vi.fn(async () => {
      throw new FlowHttpBlockedError();
    });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://x.com', retryPolicy: noDelay }),
      makeCtx({ httpRequest }),
    );
    expectSsrfFailure(r);
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  it('erro de rede comum mantem retry e aresta error; webhook_error generico', async () => {
    const httpRequest = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const ctx = makeCtx({ httpRequest });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://x.com', retryPolicy: noDelay }),
      ctx,
    );
    expect(r).toEqual({
      status: 'SUCCESS',
      edgeHandle: 'error',
      variables: { webhook_error: NETWORK_MESSAGE },
    });
    expect(httpRequest).toHaveBeenCalledTimes(3);
    // O detalhe cru vai so para o log interno.
    expect(JSON.stringify(vi.mocked(ctx.log).mock.calls)).toContain('ECONNRESET');
  });

  it('porta proibida ⇒ falha do no ssrf_blocked com mensagem de porta', async () => {
    const httpRequest = vi.fn((req: FlowHttpRequest) => guarded.request(req));
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'http://exemplo.com:22/', retryPolicy: noDelay }),
      makeCtx({ httpRequest }),
    );
    expect(r).toEqual({
      status: 'ERROR',
      error: `${SSRF_PORT_BLOCKED_MESSAGE} [${SSRF_BLOCKED_CODE}]`,
    });
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });
});

describe('http_request handler — erros sem vazamento (L3/L4)', () => {
  it('ENOTFOUND real do port: webhook_error generico, detalhe so no log', async () => {
    const port = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: dnsToPrivate });
    const ctx = makeCtx({ httpRequest: (req) => port.request(req) });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://nao-existe.exemplo/x', retryPolicy: noDelay }),
      ctx,
    );
    expect(r).toEqual({
      status: 'SUCCESS',
      edgeHandle: 'error',
      variables: { webhook_error: 'Falha de rede ao chamar o endereço' },
    });
    expect(JSON.stringify(vi.mocked(ctx.log).mock.calls)).toContain('ENOTFOUND');
  });

  it('mensagem crua de port injetado nunca chega a webhook_error', async () => {
    const httpRequest = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND crm.interno.local 10.1.2.3');
    });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://x.com', retryPolicy: noDelay }),
      makeCtx({ httpRequest }),
    );
    if (r.status !== 'SUCCESS') throw new Error('esperava SUCCESS/error');
    expect(r.variables?.['webhook_error']).toBe(NETWORK_MESSAGE);
    expect(JSON.stringify(r)).not.toContain('crm.interno.local');
    expect(JSON.stringify(r)).not.toContain('10.1.2.3');
  });

  it('falha com codigo conhecido do port preserva a mensagem fixa do codigo', async () => {
    const httpRequest = vi.fn(async () => {
      throw new FlowHttpError('timeout', new Error('aborted'));
    });
    const r = await httpRequestHandler.execute(
      node({ method: 'GET', url: 'https://x.com', retryPolicy: noDelay }),
      makeCtx({ httpRequest }),
    );
    if (r.status !== 'SUCCESS') throw new Error('esperava SUCCESS/error');
    expect(r.variables?.['webhook_error']).toBe(FLOW_HTTP_ERROR_MESSAGES.timeout);
  });

  it('log de falha leva so o host: sem caminho, query nem credenciais', async () => {
    const httpRequest = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const ctx = makeCtx({ httpRequest, variables: { token: 'segredo-123' } });
    await httpRequestHandler.execute(
      node({
        method: 'GET',
        url: 'https://api.exemplo.com:8443/v1/pedidos?token={{token}}#frag',
        retryPolicy: noDelay,
      }),
      ctx,
    );
    const calls = vi.mocked(ctx.log).mock.calls;
    const failure = calls.find(([, msg]) => msg.includes('falhou'));
    expect(failure?.[2]).toMatchObject({ host: 'api.exemplo.com' });
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain('segredo-123');
    expect(logged).not.toContain('/v1/pedidos');
    expect(logged).not.toContain('token=');
    expect(failure?.[2]).not.toHaveProperty('url');
  });
});
