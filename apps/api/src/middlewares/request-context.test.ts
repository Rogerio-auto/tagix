import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createLogger, getLogContext, type LogContext } from '@hm/logger';
import { requestContext } from './request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stub mínimo de Request/Response com headers e (opcionalmente) sessão. */
function makeReqRes(opts: {
  headers?: Record<string, string | string[]>;
  workspaceId?: string;
}): { req: Request; res: Response; setHeaders: Record<string, unknown> } {
  const setHeaders: Record<string, unknown> = {};
  const req = {
    headers: opts.headers ?? {},
    auth: opts.workspaceId ? { workspace: { id: opts.workspaceId } } : undefined,
  } as unknown as Request;
  const res = {
    setHeader(name: string, value: unknown) {
      setHeaders[name.toLowerCase()] = value;
      return this;
    },
  } as unknown as Response;
  return { req, res, setHeaders };
}

/** Captura as linhas JSON emitidas por um logger criado com destino em memória. */
function captureLogger(): { logger: ReturnType<typeof createLogger>; lines: () => unknown[] } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger('debug', {}, { destination: dest });
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as unknown),
  };
}

describe('requestContext middleware', () => {
  it('gera um requestId (UUID) e o ecoa no header x-request-id', () => {
    const { req, res, setHeaders } = makeReqRes({});
    let nexted = false;
    const next: NextFunction = () => {
      nexted = true;
    };
    requestContext(req, res, next);
    expect(nexted).toBe(true);
    expect(req.requestId).toMatch(UUID_RE);
    expect(setHeaders['x-request-id']).toBe(req.requestId);
  });

  it('respeita um x-request-id seguro fornecido pelo proxy/cliente', () => {
    const { req, res, setHeaders } = makeReqRes({ headers: { 'x-request-id': 'req-abc.123' } });
    requestContext(req, res, () => {});
    expect(req.requestId).toBe('req-abc.123');
    expect(setHeaders['x-request-id']).toBe('req-abc.123');
  });

  it('descarta um x-request-id hostil (header/log forging) e gera um novo', () => {
    const { req } = makeReqRes({
      headers: { 'x-request-id': 'evil\n{"injected":true}' },
    });
    requestContext(req, makeReqRes({}).res, () => {});
    expect(req.requestId).toMatch(UUID_RE);
  });

  it('abre o contexto AsyncLocalStorage durante o downstream', () => {
    const { req, res } = makeReqRes({ workspaceId: 'ws-1' });
    let seen: LogContext | undefined;
    requestContext(req, res, () => {
      seen = getLogContext();
    });
    expect(seen).toBeDefined();
    expect(seen?.requestId).toBe(req.requestId);
    // workspaceId é um getter resolvido tarde — lê req.auth no momento do log.
    expect(seen?.workspaceId).toBe('ws-1');
  });

  it('propaga o contexto por continuações async (await)', async () => {
    const { req, res } = makeReqRes({ workspaceId: 'ws-async' });
    let seenId: string | undefined;
    await new Promise<void>((resolve) => {
      requestContext(req, res, () => {
        void (async () => {
          await Promise.resolve();
          seenId = getLogContext()?.requestId;
          resolve();
        })();
      });
    });
    expect(seenId).toBe(req.requestId);
  });
});

describe('correlação de log (requestId + workspaceId)', () => {
  it('injeta requestId e workspaceId em toda linha de log dentro da request', () => {
    const { logger, lines } = captureLogger();
    const { req, res } = makeReqRes({ workspaceId: 'ws-42' });
    requestContext(req, res, () => {
      logger.info('handler executando', { deal: 'd-1' });
    });
    // Fora da request: sem contexto.
    logger.info('fora da request');

    const parsed = lines() as Array<Record<string, unknown>>;
    const inside = parsed.find((l) => l['msg'] === 'handler executando');
    const outside = parsed.find((l) => l['msg'] === 'fora da request');
    expect(inside?.['requestId']).toBe(req.requestId);
    expect(inside?.['workspaceId']).toBe('ws-42');
    expect(inside?.['deal']).toBe('d-1');
    expect(outside?.['requestId']).toBeUndefined();
    expect(outside?.['workspaceId']).toBeUndefined();
  });

  it('omite workspaceId quando ainda não há sessão (getter → undefined)', () => {
    const { logger, lines } = captureLogger();
    const { req, res } = makeReqRes({});
    requestContext(req, res, () => {
      logger.info('pré-auth');
    });
    const parsed = lines() as Array<Record<string, unknown>>;
    const line = parsed.find((l) => l['msg'] === 'pré-auth');
    expect(line?.['requestId']).toBe(req.requestId);
    expect(line?.['workspaceId']).toBeUndefined();
  });
});

describe('redação de PII no @hm/logger', () => {
  it('redige identificadores de canal e documentos pessoais', () => {
    const { logger, lines } = captureLogger();
    logger.info('inbound', {
      msisdn: '5511999998888',
      wa_id: '5511999998888',
      waId: '5511999998888',
      document: '12345678900',
      cpf: '123.456.789-00',
      cnpj: '11.222.333/0001-44',
      address: 'Rua Foo, 123',
      to: '5511988887777',
      from: '5511977776666',
      phone: '+5511900000000',
      email: 'a@b.com',
      contact: {
        msisdn: '5511999998888',
        cpf: '123.456.789-00',
        address: 'Rua Bar, 9',
      },
      // Campo benigno permanece visível.
      channel: 'whatsapp',
    });
    const [line] = lines() as Array<Record<string, unknown>>;
    for (const key of [
      'msisdn',
      'wa_id',
      'waId',
      'document',
      'cpf',
      'cnpj',
      'address',
      'to',
      'from',
      'phone',
      'email',
    ]) {
      expect(line?.[key], key).toBe('[REDACTED]');
    }
    const contact = line?.['contact'] as Record<string, unknown>;
    expect(contact['msisdn']).toBe('[REDACTED]');
    expect(contact['cpf']).toBe('[REDACTED]');
    expect(contact['address']).toBe('[REDACTED]');
    expect(line?.['channel']).toBe('whatsapp');
  });

  it('continua redigindo segredos e credenciais (regressão)', () => {
    const { logger, lines } = captureLogger();
    logger.info('auth', { password: 'x', token: 'y', apiKey: 'z', authorization: 'Bearer w' });
    const [line] = lines() as Array<Record<string, unknown>>;
    expect(line?.['password']).toBe('[REDACTED]');
    expect(line?.['token']).toBe('[REDACTED]');
    expect(line?.['apiKey']).toBe('[REDACTED]');
    expect(line?.['authorization']).toBe('[REDACTED]');
  });
});
