/**
 * F56-S07 — guarda anti-SSRF de webhooks outbound.
 *
 * Cobre as três camadas: classificação de IP (puro), sintaxe (boundary Zod),
 * DNS no boundary (assert) e o connect-time guardado do `ssrfSafeFetch`
 * (anti-rebinding + integração real contra um servidor local allowlisted).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertSafeWebhookUrl,
  checkWebhookUrlSyntax,
  createGuardedLookup,
  isBlockedIpAddress,
  SsrfBlockedError,
  ssrfSafeFetch,
  type DnsLookupAll,
} from './ssrf-guard';

/** Resolver fake: devolve sempre os endereços dados (simula DNS controlado). */
function fakeLookup(addresses: readonly string[]): DnsLookupAll {
  return (_hostname, _options, callback) => {
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
}

describe('isBlockedIpAddress', () => {
  it('bloqueia metadata, RFC1918, loopback, link-local, CGNAT', () => {
    for (const ip of [
      '169.254.169.254', // metadata AWS/GCP
      '169.254.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '127.255.255.254',
      '100.64.0.1',
      '0.0.0.0',
      '255.255.255.255',
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it('bloqueia IPv6 loopback/ULA/link-local/mapeados', () => {
    for (const ip of [
      '::1',
      '::',
      'fd12:3456::1', // fd00::/8 (ULA)
      'fc00::1', // fc00::/7
      'fe80::1', // link-local
      '::ffff:127.0.0.1', // v4-mapped loopback
      '::ffff:10.0.0.1', // v4-mapped RFC1918
      '64:ff9b::a00:1', // NAT64 embutindo 10.0.0.1
    ]) {
      expect(isBlockedIpAddress(ip), ip).toBe(true);
    }
  });

  it('permite IPs públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2001:4860:4860::8888']) {
      expect(isBlockedIpAddress(ip), ip).toBe(false);
    }
  });

  it('fail-closed: o que não parseia é bloqueado', () => {
    expect(isBlockedIpAddress('not-an-ip')).toBe(true);
    expect(isBlockedIpAddress('999.1.1.1')).toBe(true);
    expect(isBlockedIpAddress('')).toBe(true);
  });
});

describe('checkWebhookUrlSyntax (camada 1 — boundary Zod)', () => {
  it('aceita https público', () => {
    expect(checkWebhookUrlSyntax('https://hooks.example.com/wh', { allowHttpHosts: [] }).ok).toBe(true);
  });

  it('rejeita http fora da allowlist e aceita quando allowlisted', () => {
    expect(checkWebhookUrlSyntax('http://hooks.example.com/wh', { allowHttpHosts: [] })).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(
      checkWebhookUrlSyntax('http://hooks.example.com/wh', { allowHttpHosts: ['hooks.example.com'] })
        .ok,
    ).toBe(true);
  });

  it('rejeita IP literal privado/metadata/loopback', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.8/x',
      'https://192.168.0.10/x',
      'https://127.0.0.1:8080/x',
      'https://[::1]/x',
      'https://[fd00::1]/x',
    ]) {
      const res = checkWebhookUrlSyntax(url, { allowHttpHosts: [] });
      expect(res.ok, url).toBe(false);
      if (!res.ok) expect(res.reason).toBe('blocked_ip');
    }
  });

  it('rejeita localhost, credenciais embutidas e esquemas exóticos', () => {
    expect(checkWebhookUrlSyntax('https://localhost/x', { allowHttpHosts: [] })).toEqual({
      ok: false,
      reason: 'blocked_host',
    });
    expect(checkWebhookUrlSyntax('https://user:pass@x.example.com/', { allowHttpHosts: [] })).toEqual(
      { ok: false, reason: 'credentials' },
    );
    expect(checkWebhookUrlSyntax('ftp://x.example.com/', { allowHttpHosts: [] })).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(checkWebhookUrlSyntax('nada disso', { allowHttpHosts: [] })).toEqual({
      ok: false,
      reason: 'invalid_url',
    });
  });

  it('aceita IP literal público', () => {
    expect(checkWebhookUrlSyntax('https://93.184.216.34/x', { allowHttpHosts: [] }).ok).toBe(true);
  });
});

describe('assertSafeWebhookUrl (camada 2 — DNS no boundary)', () => {
  it('rejeita hostname que resolve para IP privado', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example.com/wh', {
        allowHttpHosts: [],
        lookupImpl: fakeLookup(['10.0.0.5']),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejeita se QUALQUER endereço resolvido for interno (multi-A)', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example.com/wh', {
        allowHttpHosts: [],
        lookupImpl: fakeLookup(['93.184.216.34', '169.254.169.254']),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('aceita hostname que resolve só para IPs públicos', async () => {
    const url = await assertSafeWebhookUrl('https://ok.example.com/wh', {
      allowHttpHosts: [],
      lookupImpl: fakeLookup(['93.184.216.34']),
    });
    expect(url.hostname).toBe('ok.example.com');
  });

  it('erro de DNS não bloqueia o boundary (enforcement fica no connect)', async () => {
    const failingLookup: DnsLookupAll = (_h, _o, cb) => {
      cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
    };
    const url = await assertSafeWebhookUrl('https://ainda-nao-propagou.example.com/wh', {
      allowHttpHosts: [],
      lookupImpl: failingLookup,
    });
    expect(url.hostname).toBe('ainda-nao-propagou.example.com');
  });

  it('rejeita IP literal bloqueado sem precisar de DNS', async () => {
    await expect(
      assertSafeWebhookUrl('https://169.254.169.254/latest', { allowHttpHosts: [] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('createGuardedLookup / ssrfSafeFetch (camada 3 — connect-time)', () => {
  it('lookup guardado devolve erro quando a resolução aponta para IP interno', async () => {
    const guarded = createGuardedLookup({ lookupImpl: fakeLookup(['169.254.169.254']) });
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      guarded('rebind.example.com', { all: true }, (e) => resolve(e));
    });
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err?.code).toBe('ERR_SSRF_BLOCKED');
  });

  it('anti-rebinding: boundary viu IP público, connect revê IP privado → bloqueia', async () => {
    // 1) No create, o atacante serve DNS público → passa o boundary.
    await expect(
      assertSafeWebhookUrl('https://rebind.example.com/wh', {
        allowHttpHosts: [],
        lookupImpl: fakeLookup(['93.184.216.34']),
      }),
    ).resolves.toBeInstanceOf(URL);

    // 2) No dispatch, o DNS "rebindou" para o metadata → o connect usa a MESMA
    //    resolução validada e rejeita antes de abrir socket.
    await expect(
      ssrfSafeFetch(
        'https://rebind.example.com/wh',
        { method: 'POST', body: '{}' },
        { allowHttpHosts: [], lookupImpl: fakeLookup(['169.254.169.254']) },
      ),
    ).rejects.toMatchObject({ code: 'ERR_SSRF_BLOCKED' });
  });

  it('rejeita URL bloqueada antes de qualquer conexão', async () => {
    await expect(
      ssrfSafeFetch('https://127.0.0.1:9/x', undefined, { allowHttpHosts: [] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      ssrfSafeFetch('http://intranet.example.com/x', undefined, { allowHttpHosts: [] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('ssrfSafeFetch — integração com servidor local (allowlist do operador)', () => {
  let server: Server;
  let port = 0;
  let lastReq: { method: string; body: string; signature: string | undefined } | null = null;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const sig = req.headers['x-hm-signature-256'];
        lastReq = {
          method: req.method ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
          signature: typeof sig === 'string' ? sig : undefined,
        };
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://127.0.0.1/never-follow' });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('sem porta');
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  });

  it('entrega POST assinado quando o host está na allowlist do operador', async () => {
    const resp = await ssrfSafeFetch(
      `http://127.0.0.1:${port}/hook`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hm-signature-256': 'sha256=abc' },
        body: '{"event":"webhook.test"}',
      },
      { allowHttpHosts: ['127.0.0.1'] },
    );
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('ok');
    expect(lastReq).toEqual({
      method: 'POST',
      body: '{"event":"webhook.test"}',
      signature: 'sha256=abc',
    });
  });

  it('o MESMO destino é bloqueado sem a allowlist (loopback)', async () => {
    await expect(
      ssrfSafeFetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', body: '{}' }, {
        allowHttpHosts: [],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('não segue redirect (3xx volta como resposta não-ok)', async () => {
    const resp = await ssrfSafeFetch(
      `http://127.0.0.1:${port}/redirect`,
      { method: 'POST', body: '{}' },
      { allowHttpHosts: ['127.0.0.1'] },
    );
    expect(resp.status).toBe(302);
    expect(resp.ok).toBe(false);
  });
});
