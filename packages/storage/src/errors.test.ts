/**
 * F70-S27 — classificação das falhas de storage e sonda do R2.
 *
 * A sonda e o `put` rodam contra um servidor S3 FALSO local (HTTP em 127.0.0.1): o
 * AWS SDK de verdade fala com ele, então o teste prova a classificação sobre os erros
 * reais do SDK (inclusive o `HEAD` 403 sem corpo do incidente de 25/09), sem tocar o R2.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyStorageError, isStorageProbe, StorageError } from './errors';
import { LocalDriver } from './local-driver';
import { R2Driver } from './r2-driver';

const SECRET = 'segredo-que-nao-pode-vazar-0123456789';
const ACCESS_KEY = 'AKIA_CHAVE_QUE_NAO_PODE_VAZAR';

type Mode = 'denied' | 'ok' | 'error500' | 'hang';
let mode: Mode = 'denied';
let server: Server;
let endpoint = '';

function reply(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  if (mode === 'hang') return; // nunca responde
  if (mode === 'ok') {
    res.writeHead(200, { 'content-length': '0' });
    res.end();
    return;
  }
  const status = mode === 'denied' ? 403 : 500;
  if (req.method === 'HEAD') {
    // HEAD não tem corpo — o SDK só vê o status. Foi assim no incidente.
    res.writeHead(status);
    res.end();
    return;
  }
  const code = mode === 'denied' ? 'AccessDenied' : 'InternalError';
  // Corpo com a chave ecoada: o `StorageError` não pode repassá-lo.
  const body = `<?xml version="1.0"?><Error><Code>${code}</Code><Message>Denied for ${ACCESS_KEY}</Message></Error>`;
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(body);
}

beforeAll(async () => {
  server = createServer(reply);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function driver(): R2Driver {
  return new R2Driver({
    accountId: 'conta',
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET,
    bucket: 'leadium-test',
    endpoint,
  });
}

describe('classifyStorageError', () => {
  it('AccessDenied / InvalidAccessKeyId / SignatureDoesNotMatch / NoSuchBucket são configuração', () => {
    for (const name of ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket']) {
      const err = Object.assign(new Error('x'), { name, $metadata: { httpStatusCode: 403 } });
      expect(classifyStorageError(err)).toMatchObject({ kind: 'config', code: name });
    }
  });

  it('HEAD 403 sem corpo (nome genérico) vira AccessDenied de configuração', () => {
    const err = Object.assign(new Error('UnknownError'), {
      name: 'Forbidden',
      $metadata: { httpStatusCode: 403 },
    });
    expect(classifyStorageError(err).kind).toBe('config');
    const generic = Object.assign(new Error(''), { name: '403', $metadata: { httpStatusCode: 403 } });
    expect(classifyStorageError(generic)).toMatchObject({ kind: 'config', code: 'AccessDenied' });
  });

  it('rede, timeout e 5xx são transitórios', () => {
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).kind).toBe(
      'transient',
    );
    expect(
      classifyStorageError(Object.assign(new Error('x'), { name: 'TimeoutError' })).kind,
    ).toBe('transient');
    const e503 = Object.assign(new Error('x'), { name: 'Error', $metadata: { httpStatusCode: 503 } });
    expect(classifyStorageError(e503)).toMatchObject({ kind: 'transient', code: 'Http503' });
  });

  it('o resto é unknown, e não-objetos não quebram', () => {
    expect(classifyStorageError(new Error('boom')).kind).toBe('unknown');
    expect(classifyStorageError('texto').kind).toBe('unknown');
    expect(classifyStorageError(null).kind).toBe('unknown');
  });

  it('o código é saneado (sem espaço nem conteúdo arbitrário)', () => {
    const err = Object.assign(new Error('x'), { name: 'Access Denied <script>' });
    expect(classifyStorageError(err).code).toBe('AccessDeniedscript');
  });
});

describe('R2Driver contra S3 falso', () => {
  it('sonda: credencial recusada (HEAD 403) → denied', async () => {
    mode = 'denied';
    const result = await driver().probe(5_000);
    expect(result.state).toBe('denied');
    expect(result.code).toBe('AccessDenied');
  });

  it('sonda: bucket acessível → ok', async () => {
    mode = 'ok';
    expect((await driver().probe(5_000)).state).toBe('ok');
  });

  it('sonda: storage que não responde → unreachable pelo teto de tempo', async () => {
    mode = 'hang';
    const result = await driver().probe(200);
    expect(result).toMatchObject({ state: 'unreachable', code: 'TimeoutError' });
  });

  it('put recusado → StorageError de configuração, sem chave nem corpo na mensagem', async () => {
    mode = 'denied';
    const err: unknown = await driver()
      .put({ key: 'ws/a.jpg', body: new Uint8Array([1]), contentType: 'image/jpeg' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    const se = err as StorageError;
    expect(se).toMatchObject({ kind: 'config', code: 'AccessDenied', operation: 'put', bucket: 'leadium-test' });
    const serialized = `${se.message} ${JSON.stringify(se.toLogFields())}`;
    expect(serialized).not.toContain(ACCESS_KEY);
    expect(serialized).not.toContain(SECRET);
  });

  it('put com 500 → StorageError transitório', async () => {
    mode = 'error500';
    const err: unknown = await driver()
      .put({ key: 'ws/a.jpg', body: new Uint8Array([1]), contentType: 'image/jpeg' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).kind).toBe('transient');
  });
});

describe('LocalDriver.probe', () => {
  it('diretório gravável → ok, e o driver é reconhecido como sondável', async () => {
    const local = new LocalDriver({ basePath: path.join(tmpdir(), 'hm-storage-probe-test') });
    expect(isStorageProbe(local)).toBe(true);
    expect((await local.probe(1_000)).state).toBe('ok');
  });
});
