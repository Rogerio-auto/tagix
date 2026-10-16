/**
 * F75-S16 — guarda anti-SSRF do port HTTP do flow-engine. Sem rede externa: servidores
 * locais em 127.0.0.1 (liberados so pela allowlist de dev) e DNS injetado.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DnsLookupAll } from '@hm/shared/net';
import {
  createFlowHttpPort,
  FLOW_HTTP_ALLOWLIST_ENV,
  FLOW_HTTP_ERROR_MESSAGES,
  flowHttpErrorCode,
  flowHttpPort,
  FlowHttpBlockedError,
  isFlowHttpBlockedError,
  isMetadataOrLinkLocalAddress,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  SSRF_BLOCKED_CODE,
  SSRF_BLOCKED_MESSAGE,
  SSRF_PORT_BLOCKED_MESSAGE,
} from './http.port';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

interface TestServer {
  readonly base: string;
  readonly port: number;
  setHandler(h: Handler): void;
  readonly requests: Array<{
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: string;
  }>;
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  let handler: Handler = (_req, res) => res.end('ok');
  const requests: TestServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    requests,
    setHandler(h) {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** DNS falso: hostname → lista de IPs. Host desconhecido = ENOTFOUND. Nunca toca rede. */
function fakeDns(table: Record<string, readonly string[]>): DnsLookupAll & { calls: string[] } {
  const calls: string[] = [];
  const impl: DnsLookupAll = (hostname, _options, callback) => {
    calls.push(hostname);
    const ips = table[hostname];
    if (!ips) {
      const err: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      err.code = 'ENOTFOUND';
      callback(err, []);
      return;
    }
    callback(
      null,
      ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
  return Object.assign(impl, { calls });
}

async function captureError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('esperava rejeicao');
}

function expectBlocked(err: unknown, ...mustNotContain: string[]): void {
  expectBlockedWith(SSRF_BLOCKED_MESSAGE, err, ...mustNotContain);
}

function expectBlockedWith(message: string, err: unknown, ...mustNotContain: string[]): void {
  expect(isFlowHttpBlockedError(err)).toBe(true);
  expect(err).toBeInstanceOf(FlowHttpBlockedError);
  const e = err as FlowHttpBlockedError;
  expect(e.code).toBe(SSRF_BLOCKED_CODE);
  expect(e.message).toBe(message);
  for (const s of mustNotContain) {
    expect(e.message).not.toContain(s);
    expect(String(e.stack ?? '')).not.toContain(s);
  }
}

let a: TestServer;
let b: TestServer;
beforeAll(async () => {
  a = await startServer();
  b = await startServer();
});
afterAll(async () => {
  await a.close();
  await b.close();
});
afterEach(() => {
  a.setHandler((_req, res) => res.end('ok'));
  b.setHandler((_req, res) => res.end('ok'));
  a.requests.length = 0;
  b.requests.length = 0;
  vi.unstubAllEnvs();
});

describe('flowHttpPort — destinos internos bloqueados (ssrf_blocked)', () => {
  const dns = fakeDns({});
  const port = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: dns });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://127.0.0.1:5432',
    'http://10.0.0.5',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/latest/meta-data',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://2130706433/', // 127.0.0.1 em decimal — o URL canonicaliza
    'http://0x7f.1/',
    'http://192.168.0.10/',
    'http://172.16.3.4/',
    'http://0.0.0.0/',
    'http://localhost:3000/',
    'http://api.localhost/',
    'https://user:senha@exemplo.com/',
    'ftp://exemplo.com/arquivo',
    'file:///etc/passwd',
  ])('%s ⇒ ssrf_blocked', async (url) => {
    const err = await captureError(port.request({ method: 'GET', url }));
    expectBlocked(err);
  });

  it('IP literal e recusado antes de qualquer DNS/conexao', async () => {
    await captureError(port.request({ method: 'GET', url: 'http://10.0.0.5' }));
    expect(dns.calls).toEqual([]);
  });

  it('host cujo DNS resolve para IP privado ⇒ ssrf_blocked, sem vazar o IP', async () => {
    const rebind = fakeDns({ 'interno.exemplo.com': ['10.20.30.40'] });
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: rebind });
    const err = await captureError(
      p.request({ method: 'GET', url: 'http://interno.exemplo.com/x' }),
    );
    expectBlocked(err, '10.20.30.40', 'interno.exemplo.com');
    expect(rebind.calls).toEqual(['interno.exemplo.com']);
  });

  it('DNS com UM endereco interno entre publicos ⇒ ssrf_blocked (fail-closed)', async () => {
    const mixed = fakeDns({ 'misto.exemplo.com': ['93.184.216.34', '169.254.169.254'] });
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: mixed });
    const err = await captureError(p.request({ method: 'GET', url: 'https://misto.exemplo.com/' }));
    expectBlocked(err, '169.254.169.254');
  });

  it('DNS para IPv6 loopback / IPv4-mapped ⇒ ssrf_blocked', async () => {
    const v6 = fakeDns({ 'v6.exemplo.com': ['::1'], 'mapped.exemplo.com': ['::ffff:10.0.0.1'] });
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: v6 });
    expectBlocked(await captureError(p.request({ method: 'GET', url: 'http://v6.exemplo.com/' })));
    expectBlocked(
      await captureError(p.request({ method: 'GET', url: 'http://mapped.exemplo.com/' })),
    );
  });

  it('erro de DNS comum NAO e confundido com bloqueio', async () => {
    const err = await captureError(
      port.request({ method: 'GET', url: 'http://nao-existe.exemplo/' }),
    );
    expect(isFlowHttpBlockedError(err)).toBe(false);
  });

  it('URL invalida vira erro comum (nao ecoa a URL)', async () => {
    const err = await captureError(port.request({ method: 'GET', url: 'nao e url {{x}}' }));
    expect(isFlowHttpBlockedError(err)).toBe(false);
    expect(flowHttpErrorCode(err)).toBe('invalid_url');
    expect((err as Error).message).not.toContain('{{x}}');
  });
});

describe('flowHttpPort — redirect revalidado a cada salto', () => {
  it('302 para IP privado ⇒ ssrf_blocked', async () => {
    a.setHandler((_req, res) => {
      res.writeHead(302, { location: 'http://10.0.0.5/admin' }).end();
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], lookupImpl: fakeDns({}) });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/start` }));
    expectBlocked(err, '10.0.0.5');
  });

  it('302 para metadados via IPv4-mapped ⇒ ssrf_blocked', async () => {
    a.setHandler((_req, res) => {
      res.writeHead(302, { location: 'http://[::ffff:169.254.169.254]/latest/meta-data' }).end();
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], lookupImpl: fakeDns({}) });
    expectBlocked(await captureError(p.request({ method: 'GET', url: `${a.base}/` })));
  });

  it('302 para host cujo DNS resolve para IP privado ⇒ ssrf_blocked no connect', async () => {
    const dns = fakeDns({ 'rebind.exemplo.com': ['192.168.1.1'] });
    a.setHandler((_req, res) => {
      res.writeHead(302, { location: 'http://rebind.exemplo.com/' }).end();
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], lookupImpl: dns });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/` }));
    expectBlocked(err, '192.168.1.1');
    expect(dns.calls).toEqual(['rebind.exemplo.com']);
  });

  it('redirect para destino permitido e seguido', async () => {
    a.setHandler((_req, res) => {
      res.writeHead(301, { location: `${b.base}/final` }).end();
    });
    b.setHandler((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const r = await p.request({ method: 'GET', url: `${a.base}/` });
    expect(r).toMatchObject({ status: 200, ok: true, body: { ok: true } });
    expect(b.requests[0]?.url).toBe('/final');
  });

  it('303 vira GET sem corpo; cross-origin derruba Authorization/Cookie/customizados', async () => {
    a.setHandler((_req, res) => {
      res.writeHead(303, { location: `${b.base}/depois` }).end();
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({
      method: 'POST',
      url: `${a.base}/`,
      headers: { authorization: 'Bearer segredo', cookie: 's=1', 'x-trace': 't1' },
      body: { a: 1 },
    });
    const hop2 = b.requests[0];
    expect(hop2?.method).toBe('GET');
    expect(hop2?.body).toBe('');
    expect(hop2?.headers['authorization']).toBeUndefined();
    expect(hop2?.headers['cookie']).toBeUndefined();
    expect(hop2?.headers['content-type']).toBeUndefined();
    expect(hop2?.headers['x-trace']).toBeUndefined();
  });

  it('307 preserva metodo e corpo', async () => {
    a.setHandler((req, res) => {
      if (req.url === '/') res.writeHead(307, { location: '/de-novo' }).end();
      else res.end('ok');
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({ method: 'PUT', url: `${a.base}/`, body: { x: 2 } });
    expect(a.requests[1]).toMatchObject({ method: 'PUT', url: '/de-novo', body: '{"x":2}' });
  });

  it(`mais de ${MAX_REDIRECTS} redirects ⇒ erro`, async () => {
    a.setHandler((req, res) => {
      const n = Number((req.url ?? '/0').slice(1)) || 0;
      res.writeHead(302, { location: `/${n + 1}` }).end();
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/0` }));
    expect(isFlowHttpBlockedError(err)).toBe(false);
    expect(flowHttpErrorCode(err)).toBe('too_many_redirects');
    expect((err as Error).message).toMatch(/Redirecionamentos demais/);
    expect(a.requests).toHaveLength(MAX_REDIRECTS + 1);
  });
});

describe('flowHttpPort — destino permitido continua funcionando', () => {
  it('allowlist de dev pelo ambiente (port default): POST JSON, resposta JSON', async () => {
    vi.stubEnv(FLOW_HTTP_ALLOWLIST_ENV, '127.0.0.1');
    a.setHandler((_req, res, body) => {
      res
        .writeHead(201, { 'content-type': 'application/json', 'x-id': 'abc' })
        .end(JSON.stringify({ recebido: JSON.parse(body) as unknown }));
    });
    const r = await flowHttpPort.request({
      method: 'POST',
      url: `${a.base}/hook?q=1`,
      headers: { 'x-custom': 'v' },
      body: { nome: 'Ana' },
    });
    expect(r.status).toBe(201);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ recebido: { nome: 'Ana' } });
    expect(r.headers['x-id']).toBe('abc');
    const req = a.requests[0];
    expect(req?.url).toBe('/hook?q=1');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(req?.headers['x-custom']).toBe('v');
  });

  it('sem allowlist, o mesmo servidor local e bloqueado (allowlist e o unico opt-in)', async () => {
    vi.stubEnv(FLOW_HTTP_ALLOWLIST_ENV, '');
    expectBlocked(await captureError(flowHttpPort.request({ method: 'GET', url: `${a.base}/` })));
    expect(a.requests).toHaveLength(0);
  });

  it('corpo texto, vazio e status nao-2xx preservados', async () => {
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    a.setHandler((req, res) => {
      if (req.url === '/texto') res.end('ola mundo');
      else if (req.url === '/vazio') res.writeHead(204).end();
      else res.writeHead(503).end('{"erro":"x"}');
    });
    expect((await p.request({ method: 'GET', url: `${a.base}/texto` })).body).toBe('ola mundo');
    expect(await p.request({ method: 'GET', url: `${a.base}/vazio` })).toMatchObject({
      status: 204,
      ok: true,
      body: null,
    });
    expect(await p.request({ method: 'GET', url: `${a.base}/erro` })).toMatchObject({
      status: 503,
      ok: false,
      body: { erro: 'x' },
    });
  });

  it('descomprime gzip como o fetch fazia', async () => {
    a.setHandler((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'gzip' }).end(gzipSync('{"z":1}'));
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    expect((await p.request({ method: 'GET', url: `${a.base}/` })).body).toEqual({ z: 1 });
  });
});

describe('flowHttpPort — tetos de corpo e tempo', () => {
  it('corpo ate 1 MiB e lido inteiro', async () => {
    const payload = 'a'.repeat(MAX_RESPONSE_BYTES);
    a.setHandler((_req, res) => res.end(payload));
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const r = await p.request({ method: 'GET', url: `${a.base}/` });
    expect((r.body as string).length).toBe(MAX_RESPONSE_BYTES);
  });

  it('corpo acima de 1 MiB ⇒ erro explicito (nunca truncamento)', async () => {
    a.setHandler((_req, res) => res.end('a'.repeat(MAX_RESPONSE_BYTES + 1)));
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/` }));
    expect((err as Error).message).toMatch(/limite de 1 MiB/);
  });

  it('gzip bomb: teto conta bytes descomprimidos', async () => {
    const bomb = gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES * 4));
    a.setHandler((_req, res) => res.writeHead(200, { 'content-encoding': 'gzip' }).end(bomb));
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/` }));
    expect((err as Error).message).toMatch(/limite de 1 MiB/);
  });

  it('timeout preservado: servidor que nao responde aborta no prazo', async () => {
    a.setHandler(() => {
      /* nunca responde */
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const started = Date.now();
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/`, timeoutMs: 150 }));
    expect(flowHttpErrorCode(err)).toBe('timeout');
    expect((err as Error).message).toMatch(/Tempo limite/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('flowHttpPort — cabecalhos do usuario (M1)', () => {
  it('Host/transporte/proxy/forwarded forjados sao descartados; Host vem da URL', async () => {
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({
      method: 'POST',
      url: `${a.base}/h`,
      body: { ok: 1 },
      headers: {
        Host: 'admin.interno',
        Connection: 'x-forjado',
        'Keep-Alive': 'timeout=999',
        'Transfer-Encoding': 'chunked',
        TE: 'trailers',
        Trailer: 'x-forjado',
        Upgrade: 'websocket',
        'Content-Length': '999',
        Expect: '100-continue',
        'Proxy-Authorization': 'Basic forjado',
        'Proxy-Connection': 'keep-alive',
        Forwarded: 'for=10.0.0.1',
        'X-Forwarded-For': '10.0.0.1',
        'X-Forwarded-Host': 'admin.interno',
        'x-forwarded-proto': 'https',
        'X-Real-IP': '10.0.0.1',
        'X-Custom': 'mantido',
      },
    });
    const h = a.requests[0]?.headers;
    expect(h?.['host']).toBe(`127.0.0.1:${a.port}`);
    expect(h?.['connection']).not.toContain('x-forjado');
    expect(h?.['content-length']).toBe(String(Buffer.byteLength('{"ok":1}')));
    expect(a.requests[0]?.body).toBe('{"ok":1}');
    for (const name of [
      'keep-alive',
      'transfer-encoding',
      'te',
      'trailer',
      'upgrade',
      'expect',
      'proxy-authorization',
      'proxy-connection',
      'forwarded',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-real-ip',
    ]) {
      expect(h?.[name], name).toBeUndefined();
    }
    expect(h?.['x-custom']).toBe('mantido');
  });

  it('o salto seguinte tambem nao carrega cabecalho forjado', async () => {
    a.setHandler((req, res) => {
      if (req.url === '/') res.writeHead(307, { location: '/2' }).end();
      else res.end('ok');
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({
      method: 'GET',
      url: `${a.base}/`,
      headers: { host: 'admin.interno', 'x-forwarded-for': '10.0.0.1' },
    });
    expect(a.requests).toHaveLength(2);
    for (const r of a.requests) {
      expect(r.headers['host']).toBe(`127.0.0.1:${a.port}`);
      expect(r.headers['x-forwarded-for']).toBeUndefined();
    }
  });
});

describe('flowHttpPort — allowlist propria do flow (M2)', () => {
  const quiet = { warn: (): void => {} };

  it('allowlist dos webhooks NAO libera o no de flow', async () => {
    vi.stubEnv('HM_WEBHOOK_HTTP_ALLOWLIST', '127.0.0.1');
    vi.stubEnv(FLOW_HTTP_ALLOWLIST_ENV, '');
    expectBlocked(await captureError(flowHttpPort.request({ method: 'GET', url: `${a.base}/` })));
    expect(a.requests).toHaveLength(0);
  });

  it.each([
    ['169.254.169.254', 'http://169.254.169.254/latest/meta-data'],
    ['2852039166', 'http://169.254.169.254/'],
    ['169.254.1.1', 'http://169.254.1.1/'],
    ['[fe80::1]', 'http://[fe80::1]/'],
    ['FE80::1', 'http://[fe80::1]/'],
    ['febf::abcd', 'http://[febf::abcd]/'],
    ['fd00:ec2::254', 'http://[fd00:ec2::254]/latest/meta-data'],
    ['::ffff:169.254.169.254', 'http://[::ffff:169.254.169.254]/'],
    ['64:ff9b::a9fe:a9fe', 'http://[64:ff9b::a9fe:a9fe]/'],
    ['metadata.google.internal', 'http://metadata.google.internal/computeMetadata/v1/'],
  ])('entrada de metadados %s na allowlist e ignorada', async (entry, url) => {
    const dns = fakeDns({ 'metadata.google.internal': ['169.254.169.254'] });
    const p = createFlowHttpPort({ allowHttpHosts: [entry], lookupImpl: dns, logger: quiet });
    expectBlocked(await captureError(p.request({ method: 'GET', url })));
  });

  it('host liberado com DNS para metadados ⇒ ssrf_blocked; para rede privada ⇒ ok', async () => {
    const dns = fakeDns({ 'dev.interno': ['127.0.0.1'], 'imds.interno': ['169.254.169.254'] });
    const p = createFlowHttpPort({
      allowHttpHosts: ['dev.interno', 'imds.interno'],
      lookupImpl: dns,
      logger: quiet,
    });
    expectBlocked(
      await captureError(p.request({ method: 'GET', url: 'http://imds.interno/latest' })),
      '169.254.169.254',
    );
    const ok = await p.request({ method: 'GET', url: `http://dev.interno:${a.port}/x` });
    expect(ok.status).toBe(200);
    expect(a.requests[0]?.headers['host']).toBe(`dev.interno:${a.port}`);
  });

  it('isMetadataOrLinkLocalAddress cobre v4, v6, mapped/compat/NAT64 e poupa os demais', () => {
    for (const ip of [
      '169.254.169.254',
      'fe80::1',
      'fe80::1%eth0',
      '[fe80::1]',
      'fd00:ec2::254',
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '::169.254.169.254',
      '64:ff9b::169.254.169.254',
    ]) {
      expect(isMetadataOrLinkLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '93.184.216.34',
      'fd00:ec2::253',
      '2001:db8::1',
      'fec0::1',
    ]) {
      expect(isMetadataOrLinkLocalAddress(ip), ip).toBe(false);
    }
  });

  it('aviso de allowlist ativa sai uma unica vez por processo, com entradas ignoradas', async () => {
    vi.resetModules();
    const mod = await import('./http.port');
    const warn = vi.fn();
    const p = mod.createFlowHttpPort({
      allowHttpHosts: ['127.0.0.1', '169.254.169.254'],
      logger: { warn },
    });
    await p.request({ method: 'GET', url: `${a.base}/1` });
    await p.request({ method: 'GET', url: `${a.base}/2` });
    await mod
      .createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], logger: { warn } })
      .request({ method: 'GET', url: `${a.base}/3` });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({
      env: FLOW_HTTP_ALLOWLIST_ENV,
      allowedHosts: ['127.0.0.1'],
      ignoredEntries: ['169.254.169.254'],
    });
  });

  it('allowlist vazia nao emite aviso', async () => {
    vi.resetModules();
    const mod = await import('./http.port');
    const warn = vi.fn();
    const p = mod.createFlowHttpPort({
      allowHttpHosts: [],
      lookupImpl: fakeDns({}),
      logger: { warn },
    });
    await captureError(p.request({ method: 'GET', url: 'http://nao-existe.exemplo/' }));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('flowHttpPort — redirect cross-origin e status seguidos (L1/L2)', () => {
  const userHeaders = {
    authorization: 'Bearer s',
    cookie: 'c=1',
    'x-api-key': 'k',
    'api-key': 'k2',
    'x-auth-token': 't',
    'x-custom': 'v',
    accept: 'application/json',
    'accept-language': 'pt-BR',
    'user-agent': 'tagix-flow',
  };

  it('307 cross-origin: so accept/accept-language/user-agent/content-type', async () => {
    a.setHandler((_req, res) => res.writeHead(307, { location: `${b.base}/novo` }).end());
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({ method: 'POST', url: `${a.base}/`, headers: userHeaders, body: { a: 1 } });
    const h = b.requests[0]?.headers;
    expect(b.requests[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(h?.['accept']).toBe('application/json');
    expect(h?.['accept-language']).toBe('pt-BR');
    expect(h?.['user-agent']).toBe('tagix-flow');
    expect(h?.['content-type']).toBe('application/json');
    for (const name of [
      'authorization',
      'cookie',
      'x-api-key',
      'api-key',
      'x-auth-token',
      'x-custom',
    ]) {
      expect(h?.[name], name).toBeUndefined();
    }
  });

  it('redirect na MESMA origem preserva os cabecalhos do usuario', async () => {
    a.setHandler((req, res) => {
      if (req.url === '/') res.writeHead(302, { location: '/mesma' }).end();
      else res.end('ok');
    });
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    await p.request({ method: 'GET', url: `${a.base}/`, headers: userHeaders });
    expect(a.requests[1]?.headers['x-api-key']).toBe('k');
    expect(a.requests[1]?.headers['authorization']).toBe('Bearer s');
  });

  it.each([300, 304, 305])('%i com Location e resposta final (nao seguido)', async (status) => {
    a.setHandler((_req, res) => res.writeHead(status, { location: `${b.base}/nao` }).end());
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const r = await p.request({ method: 'GET', url: `${a.base}/` });
    expect(r.status).toBe(status);
    expect(r.ok).toBe(false);
    expect(b.requests).toHaveLength(0);
  });

  it('308 e seguido', async () => {
    a.setHandler((_req, res) => res.writeHead(308, { location: `${b.base}/ok` }).end());
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    expect((await p.request({ method: 'GET', url: `${a.base}/` })).status).toBe(200);
    expect(b.requests).toHaveLength(1);
  });
});

describe('flowHttpPort — erros de rede com mensagem fixa (L3)', () => {
  it('ENOTFOUND vira network_error sem host nem texto cru; cru fica em cause', async () => {
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: fakeDns({}) });
    const err = await captureError(p.request({ method: 'GET', url: 'http://nao-existe.exemplo/' }));
    expect(flowHttpErrorCode(err)).toBe('network_error');
    expect((err as Error).message).toBe(FLOW_HTTP_ERROR_MESSAGES.network_error);
    expect((err as Error).message).not.toContain('nao-existe');
    expect(String((err as Error).cause)).toContain('ENOTFOUND');
  });

  it('ECONNREFUSED vira network_error', async () => {
    const closed = await startServer();
    const url = `${closed.base}/`;
    await closed.close();
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], logger: { warn: () => {} } });
    const err = await captureError(p.request({ method: 'GET', url }));
    expect(flowHttpErrorCode(err)).toBe('network_error');
    expect((err as Error).message).toBe('Falha de rede ao chamar o endereço');
    const cause: unknown = (err as Error).cause;
    expect(typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : null).toBe(
      'ECONNREFUSED',
    );
  });

  it('corpo acima do teto mantem codigo proprio', async () => {
    a.setHandler((_req, res) => res.end('a'.repeat(MAX_RESPONSE_BYTES + 1)));
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'] });
    const err = await captureError(p.request({ method: 'GET', url: `${a.base}/` }));
    expect(flowHttpErrorCode(err)).toBe('response_too_large');
  });
});

describe('flowHttpPort — portas (L6)', () => {
  it.each([
    'http://exemplo.com:22/',
    'http://exemplo.com:25/',
    'https://exemplo.com:1023/',
    'http://exemplo.com:0/',
  ])('%s ⇒ ssrf_blocked (porta), antes de DNS', async (url) => {
    const dns = fakeDns({});
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: dns });
    expectBlockedWith(
      SSRF_PORT_BLOCKED_MESSAGE,
      await captureError(p.request({ method: 'GET', url })),
    );
    expect(dns.calls).toEqual([]);
  });

  it.each([
    'http://exemplo.com/',
    'https://exemplo.com:80/',
    'http://exemplo.com:443/',
    'http://exemplo.com:1024/',
    'http://exemplo.com:65535/',
  ])('%s passa da checagem de porta', async (url) => {
    const p = createFlowHttpPort({ allowHttpHosts: [], lookupImpl: fakeDns({}) });
    const err = await captureError(p.request({ method: 'GET', url }));
    expect(isFlowHttpBlockedError(err)).toBe(false);
    expect(flowHttpErrorCode(err)).toBe('network_error');
  });

  it('host da allowlist de dev pode usar porta baixa', async () => {
    const p = createFlowHttpPort({
      allowHttpHosts: ['dev.interno'],
      lookupImpl: fakeDns({}),
      logger: { warn: () => {} },
    });
    const err = await captureError(p.request({ method: 'GET', url: 'http://dev.interno:25/' }));
    expect(isFlowHttpBlockedError(err)).toBe(false);
    expect(flowHttpErrorCode(err)).toBe('network_error');
  });

  it('redirect para porta proibida ⇒ ssrf_blocked (porta)', async () => {
    a.setHandler((_req, res) => res.writeHead(302, { location: 'http://exemplo.com:22/' }).end());
    const p = createFlowHttpPort({ allowHttpHosts: ['127.0.0.1'], lookupImpl: fakeDns({}) });
    expectBlockedWith(
      SSRF_PORT_BLOCKED_MESSAGE,
      await captureError(p.request({ method: 'GET', url: `${a.base}/` })),
    );
  });
});
