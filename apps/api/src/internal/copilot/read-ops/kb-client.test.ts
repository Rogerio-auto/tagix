/**
 * F73-S07 · cliente da busca de conhecimento contra um runtime FAKE (servidor HTTP local).
 * Nada sai da máquina; nenhuma chamada paga.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kbClientConfigFromEnv, searchKb, type KbClientConfig } from './kb-client';

const TOKEN = 'kb-test-token';
const WS = '0f0e0d0c-0b0a-4908-8706-050403020100';

interface Received {
  readonly auth: string | undefined;
  readonly body: unknown;
}
const received: Received[] = [];
let server: Server;
let baseUrl = '';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
    });
    req.on('end', () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const raw = await readBody(req);
      const body: unknown = JSON.parse(raw);
      received.push({ auth: req.headers.authorization, body });
      const q = (body as { query?: string }).query ?? '';
      if (q === 'lento') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ results: [] }));
        }, 1_000);
        return;
      }
      if (q === 'erro') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ detail: 'knowledge base unavailable at 10.0.0.5' }));
        return;
      }
      if (q === 'lixo') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [{ title: 1 }] }));
        return;
      }
      if (q === 'html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>oops</html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          results: [
            {
              document_id: 'doc-1',
              title: 'Tabela de preços',
              snippet: 'Clareamento R$ 900',
              score: 0.91,
            },
          ],
        }),
      );
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const cfg = (over: Partial<KbClientConfig> = {}): KbClientConfig => ({
  baseUrl,
  token: TOKEN,
  timeoutMs: 300,
  ...over,
});

describe('searchKb', () => {
  it('feliz: bearer de serviço, corpo fechado com o workspace dado e limite no teto do runtime', async () => {
    received.length = 0;
    const out = await searchKb(cfg(), { workspaceId: WS, query: 'preço', limit: 50 });
    expect(out).toEqual({
      ok: true,
      results: [
        {
          document_id: 'doc-1',
          title: 'Tabela de preços',
          snippet: 'Clareamento R$ 900',
          score: 0.91,
        },
      ],
    });
    expect(received[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(received[0]?.body).toEqual({ workspace_id: WS, query: 'preço', limit: 8 });
  });

  it('timeout → timeout (não espera o runtime)', async () => {
    const started = Date.now();
    const out = await searchKb(cfg(), { workspaceId: WS, query: 'lento', limit: 5 });
    expect(out).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(900);
  });

  it('status de erro, corpo fora do contrato e não-JSON → erro seguro, sem lançar', async () => {
    expect(await searchKb(cfg(), { workspaceId: WS, query: 'erro', limit: 5 })).toEqual({
      ok: false,
      reason: 'http_error',
      status: 503,
    });
    expect(await searchKb(cfg(), { workspaceId: WS, query: 'lixo', limit: 5 })).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
    expect(await searchKb(cfg(), { workspaceId: WS, query: 'html', limit: 5 })).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('rede caída e sem configuração → erro seguro', async () => {
    expect(
      await searchKb(cfg({ baseUrl: 'http://127.0.0.1:1' }), {
        workspaceId: WS,
        query: 'x',
        limit: 1,
      }),
    ).toEqual({ ok: false, reason: 'network_error' });
    expect(await searchKb(null, { workspaceId: WS, query: 'x', limit: 1 })).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('config do ambiente exige URL e token', () => {
    expect(kbClientConfigFromEnv({})).toBeNull();
    expect(kbClientConfigFromEnv({ AGENT_RUNTIME_URL: 'http://x' })).toBeNull();
    expect(
      kbClientConfigFromEnv({ AGENT_RUNTIME_URL: 'http://x', AGENT_RUNTIME_TOKEN: 't' }),
    ).toEqual({
      baseUrl: 'http://x',
      token: 't',
    });
  });
});
