import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verifica o WIRE do error handler central com o Sentry: só 5xx são reportados,
 * com tags de correlação (ref/workspaceId) e sem PII. O SDK é mockado via o
 * helper `captureException` de `./sentry` para não abrir conexão.
 */
const captureException = vi.fn();
vi.mock('./sentry', () => ({ captureException }));

async function loadHandler() {
  const mod = await import('../middlewares/error');
  return mod.errorHandler;
}

interface FakeRes extends Partial<Response> {
  headersSent: boolean;
  statusCode?: number;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    headersSent: false,
    setHeader: vi.fn(),
    status: vi.fn(function (this: FakeRes, code: number) {
      this.statusCode = code;
      return this as unknown as Response;
    }),
    json: vi.fn(function (this: FakeRes) {
      return this as unknown as Response;
    }),
  };
  return res;
}

describe('errorHandler → Sentry', () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('reporta 5xx com tags ref + workspaceId', async () => {
    const errorHandler = await loadHandler();
    const req = { auth: { workspace: { id: 'ws_123' } } } as unknown as Request;
    const res = makeRes();

    errorHandler(new Error('db down'), req, res as unknown as Response, vi.fn() as NextFunction);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, ctx] = captureException.mock.calls[0] as [unknown, { tags: Record<string, string> }];
    expect(ctx.tags['workspaceId']).toBe('ws_123');
    expect(ctx.tags['ref']).toMatch(/^hm_err_/);
  });

  it('NÃO reporta 4xx (ruído de cliente/validação)', async () => {
    const errorHandler = await loadHandler();
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const req = {} as Request;
    const res = makeRes();

    errorHandler(err, req, res as unknown as Response, vi.fn() as NextFunction);

    expect(captureException).not.toHaveBeenCalled();
  });

  it('reporta 5xx sem sessão (workspaceId undefined) sem quebrar', async () => {
    const errorHandler = await loadHandler();
    const req = {} as Request;
    const res = makeRes();

    errorHandler(new Error('anon boom'), req, res as unknown as Response, vi.fn() as NextFunction);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, ctx] = captureException.mock.calls[0] as [unknown, { tags: Record<string, string | undefined> }];
    expect(ctx.tags['workspaceId']).toBeUndefined();
  });
});
