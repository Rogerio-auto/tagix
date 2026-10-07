/**
 * F60-S10 — busca de anexo por URL com guarda anti-SSRF.
 *
 * Os casos de bloqueio NÃO abrem conexão (a recusa vem antes ou no `lookup`).
 * Os casos de transporte (teto, redirect, timeout) usam um servidor local em
 * 127.0.0.1 — liberado só via `allowHttpHosts`, que é opção de teste: o default
 * de produção é lista vazia e não lê o ambiente.
 */
import { Buffer } from 'node:buffer';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DnsLookupAll } from '@hm/shared/net';
import { fetchEmailAttachment } from './email-attachment-fetch';

const OPCOES = { maxBytes: 1024, timeoutMs: 2_000 } as const;

/** Resolver falso: o domínio "público" resolve para o IP escolhido pelo atacante. */
function resolveTo(address: string, family = 4): DnsLookupAll {
  return (_host, _opts, cb) => {
    cb(null, [{ address, family }]);
  };
}

describe('URL interna, loopback ou de metadados é recusada sem conexão', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/a.pdf',
    'https://[::1]/a.pdf',
    'https://[::ffff:127.0.0.1]/a.pdf',
    'https://10.0.0.8/a.pdf',
    'https://192.168.1.1/a.pdf',
    'https://localhost/a.pdf',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://intranet/a.pdf',
    'https://nas.local/a.pdf',
    'https://user:pw@files.provedor.com/a.pdf',
    'http://files.provedor.com/a.pdf',
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/_FLUSHALL',
  ])('%s', async (url) => {
    const r = await fetchEmailAttachment(url, OPCOES);
    expect(r).toEqual({ ok: false, reason: 'unsafe_url' });
  });

  it('a allowlist de operador do ambiente NÃO vale para e-mail', async () => {
    const antes = process.env['HM_WEBHOOK_HTTP_ALLOWLIST'];
    process.env['HM_WEBHOOK_HTTP_ALLOWLIST'] = '127.0.0.1,localhost';
    try {
      const r = await fetchEmailAttachment('http://127.0.0.1:1/a.pdf', OPCOES);
      expect(r).toEqual({ ok: false, reason: 'unsafe_url' });
    } finally {
      if (antes === undefined) delete process.env['HM_WEBHOOK_HTTP_ALLOWLIST'];
      else process.env['HM_WEBHOOK_HTTP_ALLOWLIST'] = antes;
    }
  });
});

describe('DNS-rebinding: nome público que resolve para dentro', () => {
  it.each([
    ['169.254.169.254', 4, 'metadados'],
    ['127.0.0.1', 4, 'loopback'],
    ['10.20.30.40', 4, 'RFC1918'],
    ['::1', 6, 'loopback v6'],
    ['fd00:ec2::254', 6, 'metadados AWS v6'],
  ])('files.provedor.com → %s (%s, %s) é recusado no connect', async (ip, family) => {
    const r = await fetchEmailAttachment('https://files.provedor.com/a.pdf', {
      ...OPCOES,
      lookupImpl: resolveTo(ip, family),
    });
    expect(r).toEqual({ ok: false, reason: 'unsafe_url' });
  });
});

describe('transporte (servidor local liberado só para o teste)', () => {
  let server: Server;
  let base = '';
  let hitsNoAlvoDoRedirect = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case '/ok':
          res.writeHead(200, { 'content-type': 'application/pdf' });
          res.end(Buffer.from('%PDF-1.4 ok'));
          return;
        case '/grande-anunciado':
          res.writeHead(200, { 'content-length': String(OPCOES.maxBytes + 1) });
          res.end(Buffer.alloc(OPCOES.maxBytes + 1));
          return;
        case '/grande-sem-tamanho':
          // Chunked, sem Content-Length: o teto precisa valer no streaming.
          res.writeHead(200);
          res.write(Buffer.alloc(OPCOES.maxBytes));
          res.end(Buffer.alloc(OPCOES.maxBytes));
          return;
        case '/redirect':
          res.writeHead(302, { location: `${base}/alvo-interno` });
          res.end();
          return;
        case '/alvo-interno':
          hitsNoAlvoDoRedirect += 1;
          res.writeHead(200);
          res.end('segredo');
          return;
        case '/lento':
          // Nunca responde: o timeout tem que encerrar.
          return;
        default:
          res.writeHead(500);
          res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const liberado = { ...OPCOES, allowHttpHosts: ['127.0.0.1'] };

  it('baixa o binário inteiro', async () => {
    const r = await fetchEmailAttachment(`${base}/ok`, liberado);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.toString()).toBe('%PDF-1.4 ok');
      expect(r.contentType).toBe('application/pdf');
    }
  });

  it('Content-Length acima do teto é recusado — nunca truncado', async () => {
    expect(await fetchEmailAttachment(`${base}/grande-anunciado`, liberado)).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('corpo acima do teto sem Content-Length é cortado no streaming', async () => {
    expect(await fetchEmailAttachment(`${base}/grande-sem-tamanho`, liberado)).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('redirect NÃO é seguido (é o bypass clássico da guarda)', async () => {
    const r = await fetchEmailAttachment(`${base}/redirect`, liberado);
    expect(r).toEqual({ ok: false, reason: 'redirect', status: 302 });
    expect(hitsNoAlvoDoRedirect).toBe(0);
  });

  it('erro HTTP vira recusa com o status', async () => {
    expect(await fetchEmailAttachment(`${base}/x`, liberado)).toEqual({
      ok: false,
      reason: 'http_error',
      status: 500,
    });
  });

  it('servidor que não responde estoura o timeout', async () => {
    const r = await fetchEmailAttachment(`${base}/lento`, { ...liberado, timeoutMs: 200 });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});
