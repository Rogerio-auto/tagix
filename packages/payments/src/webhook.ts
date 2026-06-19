/**
 * Verificação de autenticidade do webhook AbacatePay (PAYMENTS_ABACATEPAY.md §4/§9).
 *
 * O webhook é a **fonte da verdade** do pagamento, então a autenticidade tem que
 * ser garantida ANTES de qualquer efeito de domínio.
 *
 * Mecanismo PRIMÁRIO (confirmado contra a doc oficial): a AbacatePay anexa o
 * secret na QUERY STRING do endpoint registrado
 * (`https://.../webhooks/abacatepay?webhookSecret=SEU_SECRET`). Validamos
 * comparando, em tempo constante, o query param `webhookSecret` recebido com
 * `ABACATEPAY_WEBHOOK_SECRET`. `verifyWebhookSecret` cobre esse caso.
 *
 * Mecanismo SECUNDÁRIO (defense-in-depth, opcional): o header
 * `X-Webhook-Signature` traz o HMAC-SHA256 do corpo BRUTO, codificado em
 * **base64**, usando como chave a **CHAVE PÚBLICA da AbacatePay**
 * (`ABACATEPAY_PUBLIC_KEY`). Só verificamos quando a chave pública está
 * configurada. `verifyWebhookSignature` cobre esse caso, sobre o corpo bruto
 * (nunca o JSON re-serializado — senão o HMAC diverge).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header de assinatura (camada extra). A chave do HMAC é a CHAVE PÚBLICA da
 * AbacatePay (`ABACATEPAY_PUBLIC_KEY`), não o secret do webhook.
 */
export const ABACATEPAY_SIGNATURE_HEADER = 'x-webhook-signature' as const;

/** Query param que carrega o secret do webhook (auth primária). */
export const ABACATEPAY_WEBHOOK_SECRET_PARAM = 'webhookSecret' as const;

const SHA256_PREFIX = 'sha256=';

/**
 * AUTH PRIMÁRIA — compara, em tempo constante, o secret recebido na query string
 * com o `ABACATEPAY_WEBHOOK_SECRET` configurado.
 *
 * @param providedSecret  Valor do query param `webhookSecret` recebido.
 * @param expectedSecret  `ABACATEPAY_WEBHOOK_SECRET` (segredo de plataforma).
 * @returns `true` somente se ambos existem e conferem; `false` caso contrário.
 */
export function verifyWebhookSecret(
  providedSecret: string | undefined | null,
  expectedSecret: string | undefined | null,
): boolean {
  if (!providedSecret || !expectedSecret) return false;
  return constantTimeEqualUtf8(providedSecret, expectedSecret);
}

/**
 * CAMADA EXTRA (opcional) — verifica o HMAC-SHA256 (base64) do corpo bruto, com
 * a CHAVE PÚBLICA da AbacatePay como chave do HMAC.
 *
 * Tolerante a prefixo `sha256=` e também aceita hex (defensivo). A verificação
 * roda sobre os bytes EXATOS recebidos — nunca re-serialize o JSON.
 *
 * @param rawBody   Corpo bruto EXATO recebido (Buffer/string).
 * @param signature Valor do header `x-webhook-signature` (com/sem `sha256=`).
 * @param publicKey `ABACATEPAY_PUBLIC_KEY` (chave pública da AbacatePay).
 * @returns `true` somente se a assinatura confere; `false` se ausente/mismatch.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined | null,
  publicKey: string | undefined | null,
): boolean {
  if (!signature || !publicKey) return false;

  const provided = signature.startsWith(SHA256_PREFIX)
    ? signature.slice(SHA256_PREFIX.length)
    : signature;
  if (provided.length === 0) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;

  // A doc especifica base64; aceitamos hex também por robustez. Instâncias
  // separadas: um Hmac só pode ser consumido (`digest`) uma vez.
  const expectedBase64 = createHmac('sha256', publicKey).update(body).digest('base64');
  const expectedHex = createHmac('sha256', publicKey).update(body).digest('hex');

  return (
    constantTimeEqualUtf8(provided, expectedBase64) || constantTimeEqualUtf8(provided, expectedHex)
  );
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
