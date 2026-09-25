/**
 * Assinatura dos webhooks de saída com timestamp (F70-S19, achado L5 da auditoria).
 * Signer ÚNICO do sistema desde a F70-S20: o dispatcher dos workers e a entrega de
 * teste de Settings → Dev (API) assinam por aqui, então os dois caminhos nunca
 * divergem de formato.
 *
 * ```
 * x-hm-timestamp:     <segundos Unix no momento da tentativa>
 * x-hm-signature-256: sha256=<hex de HMAC-SHA256(segredo, `${timestamp}.${corpo cru}`)>
 * ```
 *
 * O timestamp entra na assinatura: quem captura uma entrega não consegue reenviá-la
 * depois com outro horário, e o receptor recusa o que estiver fora da janela
 * ({@link WEBHOOK_TOLERANCE_SECONDS}). Cada tentativa (inclusive retry) é assinada de
 * novo com o horário dela; a deduplicação continua por `_meta.eventId`.
 *
 * Antes era `sha256=<hex de HMAC(corpo)>`, sem timestamp: uma entrega capturada valia
 * para sempre. A troca foi direta, sem período com os dois formatos, porque ainda não
 * existe consumidor real (o CO-22 do Rogério OS é o primeiro e nasce no formato novo).
 * Manter o formato antigo em paralelo manteria justamente o replay que a troca fecha.
 *
 * {@link verifyWebhookSignature} é o verificador de REFERÊNCIA: o que a documentação
 * pública (`docs/api-reference/guides/webhooks.mdx` e `webhook-events.mdx`) ensina e
 * o que os testes usam como cliente. A API pública dele é contrato: clientes copiam.
 *
 * Node-only (`node:crypto`): exportado por `@hm/shared/mq`, nunca pelo barrel raiz
 * (que entra no bundle do browser).
 */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header da assinatura: `sha256=<hex>` sobre `${timestamp}.${corpo}`. */
export const SIGNATURE_HEADER = 'x-hm-signature-256';
/** Header do instante da tentativa, em segundos Unix (inteiro, decimal). */
export const TIMESTAMP_HEADER = 'x-hm-timestamp';
/** Janela de aceitação do verificador de referência (5 minutos, para os dois lados). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;
/** Segundos Unix: só dígitos, sem sinal, sem fração; 12 dígitos cobrem além do ano 30000. */
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

/** Segundos Unix inteiros de um instante. */
export function unixSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

function hmacHex(secret: string, timestamp: number, body: string | Buffer): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.`, 'utf8');
  if (typeof body === 'string') mac.update(body, 'utf8');
  else mac.update(body);
  return mac.digest('hex');
}

/** Assina uma entrega: `sha256=<hex>` de `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError('timestamp do webhook deve ser um inteiro de segundos Unix.');
  }
  return `sha256=${hmacHex(secret, timestamp, body)}`;
}

/** Headers de assinatura de uma tentativa de entrega. */
export function signatureHeaders(
  secret: string,
  body: string,
  at: Date,
): Record<typeof SIGNATURE_HEADER | typeof TIMESTAMP_HEADER, string> {
  const timestamp = unixSeconds(at);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: signWebhook(secret, timestamp, body),
  };
}

export interface VerifyWebhookInput {
  readonly secret: string;
  /** Corpo CRU recebido (bytes exatos, antes de qualquer parse). */
  readonly body: string | Buffer;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  /** Relógio do receptor (teste). Default: agora. */
  readonly now?: Date;
  /** Janela em segundos. Default: {@link WEBHOOK_TOLERANCE_SECONDS}. */
  readonly toleranceSeconds?: number;
}

export type VerifyWebhookResult =
  | { readonly ok: true; readonly timestamp: number }
  | {
      readonly ok: false;
      readonly reason: 'missing_header' | 'malformed' | 'outside_tolerance' | 'mismatch';
    };

/**
 * Verificador de referência do lado do cliente. Ordem das checagens:
 *  1. os dois headers presentes e bem formados (senão `missing_header`/`malformed`);
 *  2. o timestamp dentro da janela, para o passado e para o futuro
 *     (`outside_tolerance`): uma entrega capturada não serve depois de 5 minutos;
 *  3. o HMAC de `${timestamp}.${corpo}` bate, comparado em tempo constante
 *     (`mismatch`). Os dois lados têm o mesmo tamanho porque o formato já foi
 *     validado, então `timingSafeEqual` nunca lança.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): VerifyWebhookResult {
  const { signature, timestamp } = input;
  if (signature === undefined || signature === '' || timestamp === undefined || timestamp === '') {
    return { ok: false, reason: 'missing_header' };
  }
  if (!SIGNATURE_PATTERN.test(signature) || !TIMESTAMP_PATTERN.test(timestamp)) {
    return { ok: false, reason: 'malformed' };
  }
  const ts = Number(timestamp);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const now = unixSeconds(input.now ?? new Date());
  if (Math.abs(now - ts) > tolerance) {
    return { ok: false, reason: 'outside_tolerance' };
  }
  const expected = Buffer.from(`sha256=${hmacHex(input.secret, ts, input.body)}`, 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, timestamp: ts };
}
