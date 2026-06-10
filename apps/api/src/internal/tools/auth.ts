/**
 * Auth do endpoint interno de tools (callback Python → Node).
 *
 * Este endpoint é serviço-a-serviço: NÃO usa sessão de usuário (`requireAuth`).
 * A confiança vem de um **token interno compartilhado** (`AGENT_RUNTIME_TOKEN`),
 * o mesmo que o agent-runtime envia no header `Authorization: Bearer <token>`.
 *
 * Garantias:
 *  - O token é lido na CONSTRUÇÃO do router. Se faltar/for vazio, o middleware
 *    responde 500 (misconfiguração) — fail-closed, nunca aceita "sem token".
 *  - A comparação é em tempo (quase-)constante (`crypto.timingSafeEqual`) para
 *    não vazar o token por canal de tempo. Tamanhos diferentes → rejeita sem
 *    comparar bytes (sem early-return informativo).
 *  - Qualquer ausência/mismatch → 401, sem revelar o porquê.
 */
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const BEARER_PREFIX = 'Bearer ';

/** Compara dois segredos em tempo constante (tolerante a tamanhos distintos). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Comparação dummy para não retornar antes só por tamanho diferente.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Extrai o token do header `Authorization: Bearer <token>` (ou `null`). */
function extractBearer(header: string | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Cria o middleware de auth ligado ao token esperado. Lança na construção se o
 * token não estiver configurado — o router decide como reportar (500).
 */
export function createInternalTokenGuard(expectedToken: string) {
  const expected = expectedToken.trim();
  return function internalTokenGuard(req: Request, res: Response, next: NextFunction): void {
    if (expected.length === 0) {
      // Misconfiguração de servidor: nunca aceitar requisições sem segredo.
      res.status(500).json({ ok: false, error: 'Internal tools endpoint misconfigured.' });
      return;
    }
    const provided = extractBearer(req.header('authorization'));
    if (provided === null || !safeEqual(provided, expected)) {
      res.status(401).json({ ok: false, error: 'Unauthorized.' });
      return;
    }
    next();
  };
}
