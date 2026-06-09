import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Error handler central (4 args). Nunca envia stack ao cliente (UX §2.11);
 * loga server-side com um ref copiável.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const ref = `hm_err_${randomUUID().slice(0, 8)}`;
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: 'error', ref, message }));
  if (res.headersSent) return;
  res.status(500).json({ message: 'Erro interno. Tente novamente.', ref });
}
