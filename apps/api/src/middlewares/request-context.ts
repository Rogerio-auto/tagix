import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithLogContext } from '@hm/logger';

/**
 * Correlação de log por request/workspace (F56-S20).
 *
 * Deriva um `requestId` estável (respeita `x-request-id` de um proxy/cliente
 * confiável, senão gera um UUID), ecoa no header da resposta e abre um contexto
 * `AsyncLocalStorage` no `@hm/logger` para TODA a árvore async downstream. A
 * partir daí, qualquer log — inclusive os de loggers criados no load de módulo —
 * carrega `requestId` e (tardiamente) `workspaceId`.
 *
 * O `workspaceId` só é conhecido depois do `requireAuth`; por isso o contexto
 * expõe um GETTER que lê `req.auth` no momento do log, e não um snapshot. Assim
 * este middleware pode rodar bem cedo (antes de auth) sem perder o tenant.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Id de correlação da request (F56-S20). */
      requestId?: string;
    }
  }
}

const REQUEST_ID_HEADER = 'x-request-id';
// Aceita só tokens curtos e seguros (evita header injection / log forging via
// um `x-request-id` hostil). Fora do formato → gera um novo.
const SAFE_REQUEST_ID = /^[\w.:-]{1,200}$/;

function readRequestId(req: Request): string {
  const raw = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = readRequestId(req);
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithLogContext(
    {
      requestId,
      get workspaceId(): string | undefined {
        return req.auth?.workspace.id;
      },
    },
    () => {
      next();
    },
  );
}
