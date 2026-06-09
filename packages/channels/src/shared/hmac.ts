/**
 * Verificação de assinatura de webhook Meta (compartilhada WA + IG).
 *
 * A Meta envia `x-hub-signature-256: sha256=<hmac>` calculado com o
 * **app_secret** (não com o channel secret), pois WA e IG vivem no mesmo
 * Meta App. Deve ser verificada ANTES de qualquer parse (LIVECHAT.md §2.4,
 * INSTAGRAM.md §4.3).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica a assinatura de um corpo de webhook Meta.
 *
 * @param rawBody  Corpo bruto da requisição (Buffer/string EXATOS recebidos —
 *                 nunca o JSON re-serializado, senão o HMAC diverge).
 * @param signatureHeader  Valor de `x-hub-signature-256` (com prefixo `sha256=`).
 * @param appSecret  App secret do Meta App.
 * @returns `true` se a assinatura confere (comparação constant-time).
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  if (provided.length === 0) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', appSecret).update(body).digest('hex');

  // Comparação constant-time; exige buffers de mesmo tamanho.
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}
