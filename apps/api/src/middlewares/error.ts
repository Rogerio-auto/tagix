import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Error handler central (4 args) — sanitização OWASP A05 (Security
 * Misconfiguration) / A09 (Logging & Monitoring) (F10-S07).
 *
 * Contrato de resposta (preservado): `500 { message, ref }`. O `ref`
 * (`hm_err_*`, correlation id) é o único identificador exposto ao cliente —
 * copiável para suporte — e é espelhado no header `X-Error-Ref`. O detalhe real
 * (mensagem/stack/SQL) é logado server-side sob esse ref.
 *
 * Produção: NUNCA vaza stack, SQL, paths internos ou a mensagem crua do erro —
 * só a mensagem genérica + ref. Desenvolvimento/test: anexa `detail` (mensagem)
 * e `stack` à resposta para acelerar o debug local.
 */

const GENERIC_MESSAGE = 'Erro interno. Tente novamente.';

interface SanitizedError {
  readonly status: number;
  readonly message: string;
  readonly stack: string | undefined;
}

/** Extrai dados do erro sem assumir formato (zero `any`). */
function sanitize(err: unknown): SanitizedError {
  if (err instanceof Error) {
    const status =
      'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;
    return { status, message: err.message, stack: err.stack };
  }
  return { status: 500, message: String(err), stack: undefined };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const ref = `hm_err_${randomUUID().slice(0, 8)}`;
  const { status, message, stack } = sanitize(err);

  // Log estruturado server-side: detalhe completo fica só nos logs, sob o ref.
  console.error(JSON.stringify({ level: 'error', ref, status, message, stack }));

  if (res.headersSent) return;

  // Correlation id sempre presente — também como header para proxies/clientes.
  res.setHeader('X-Error-Ref', ref);

  // Dev/test preservam detalhe; produção devolve só a mensagem genérica + ref.
  const isProd = process.env['NODE_ENV'] === 'production';
  if (isProd) {
    res.status(status >= 400 && status < 600 ? status : 500).json({ message: GENERIC_MESSAGE, ref });
    return;
  }

  res
    .status(status >= 400 && status < 600 ? status : 500)
    .json({ message: GENERIC_MESSAGE, ref, detail: message, stack });
}
