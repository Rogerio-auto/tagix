/**
 * Verificação de assinatura do webhook AbacatePay (PAYMENTS_ABACATEPAY.md §4/§9).
 *
 * O webhook assinado é a **fonte da verdade** do pagamento. A verificação deve
 * acontecer ANTES de qualquer parse, sobre o corpo BRUTO recebido (nunca o JSON
 * re-serializado, senão o HMAC diverge). Comparação constant-time.
 *
 * TODO(confirmar contra doc/sandbox): nome exato do header de assinatura e o
 * formato/prefixo. A AbacatePay v2 usa um secret de webhook (`ABACATEPAY_WEBHOOK_SECRET`).
 * Suportamos com e sem prefixo `sha256=` e a comparação aceita tanto hex quanto base64.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header de assinatura recomendado (confirmar contra a doc). */
export const ABACATEPAY_SIGNATURE_HEADER = 'x-abacatepay-signature' as const;

const SHA256_PREFIX = 'sha256=';

/**
 * Verifica a assinatura HMAC-SHA256 de um corpo de webhook.
 *
 * @param rawBody  Corpo bruto EXATO recebido (Buffer/string). Não re-serialize.
 * @param signature  Valor do header de assinatura (com ou sem prefixo `sha256=`).
 * @param secret  `ABACATEPAY_WEBHOOK_SECRET` (segredo de plataforma).
 * @returns `true` somente se a assinatura confere; `false` se ausente/mismatch.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined | null,
  secret: string | undefined | null,
): boolean {
  if (!signature || !secret) return false;

  const provided = signature.startsWith(SHA256_PREFIX)
    ? signature.slice(SHA256_PREFIX.length)
    : signature;
  if (provided.length === 0) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;

  // O gateway pode codificar a assinatura em hex ou base64 — tentamos ambos.
  // Instâncias separadas: um Hmac só pode ser consumido (`digest`) uma vez.
  const expectedHex = createHmac('sha256', secret).update(body).digest('hex');
  const expectedBase64 = createHmac('sha256', secret).update(body).digest('base64');

  return constantTimeEqualUtf8(provided, expectedHex) || constantTimeEqualUtf8(provided, expectedBase64);
}

/**
 * Compara duas strings em tempo constante, tratando-as como bytes UTF-8.
 * Strings de tamanhos diferentes nunca conferem — e ainda assim a comparação é
 * feita contra um buffer de mesmo tamanho para não vazar timing.
 */
function constantTimeEqualUtf8(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compara A contra si mesmo para gastar tempo equivalente, depois falha.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
