/**
 * Grant do turno do Copiloto (ADR-003 §2): a credencial curta que o runtime devolve em
 * `X-Copilot-Grant` a cada callback de ferramenta.
 *
 *   grant   = b64url(payload) + "." + b64url(HMAC-SHA256(COPILOT_GRANT_SECRET, b64url(payload)))
 *   payload = { v: 1, tid, ws, mid, exp, nonce }      (exp em segundos Unix)
 *
 * O HMAC cobre os BYTES do segmento codificado, não um JSON re-serializado: não há
 * canonicalização a errar, e qualquer bit trocado no payload invalida a assinatura.
 *
 * A verificação autentica ANTES de interpretar: a assinatura é conferida em tempo constante
 * sobre o segmento cru, e só depois o JSON é lido. Um payload forjado nunca chega ao parser
 * de JSON nem ao Zod.
 *
 * O grant sozinho não autoriza nada: ele só diz "este turno, deste membro, deste workspace".
 * O callback confere o turno no banco (`claimToolCall`: vivo, do membro, nonce, teto) e
 * recarrega o membro a cada chamada (ADR-003 §3).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { copilotGrantSecret } from '../../../config';

/** Versão atual do formato. Versão desconhecida é recusada, nunca "tentada". */
export const COPILOT_GRANT_VERSION = 1 as const;
/** Validade padrão e máxima (ADR-003 §2: o turno vive 120 s). */
export const COPILOT_GRANT_TTL_SECONDS = 120;
/** Folga de relógio aceita acima do TTL máximo ao conferir `exp` (emissor e verificador). */
export const COPILOT_GRANT_CLOCK_SKEW_SECONDS = 5;
/** Teto do token inteiro. Um grant legítimo tem ~250 caracteres. */
export const COPILOT_GRANT_MAX_LENGTH = 1024;

/** Motivos estáveis de recusa (logados; nunca com dado de negócio). */
export const GRANT_REJECTION_REASONS = [
  'grant_malformed',
  'grant_expired',
  'grant_bad_signature',
  'grant_unsupported_version',
] as const;
export type GrantRejectionReason = (typeof GRANT_REJECTION_REASONS)[number];

export interface CopilotGrantPayload {
  readonly v: typeof COPILOT_GRANT_VERSION;
  /** Turno. */
  readonly tid: string;
  /** Workspace. */
  readonly ws: string;
  /** Membro. */
  readonly mid: string;
  /** Expiração, segundos Unix. */
  readonly exp: number;
  /** Nonce do turno (`copilot_turns.grant_nonce`). */
  readonly nonce: string;
}

export type GrantVerification =
  | { readonly ok: true; readonly payload: CopilotGrantPayload }
  | { readonly ok: false; readonly reason: GrantRejectionReason };

const uuid = z.string().uuid();
/** Mesmo intervalo do `check` de `copilot_turns.grant_nonce` (16..128). */
const NonceSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const PayloadV1Schema = z
  .object({
    v: z.literal(COPILOT_GRANT_VERSION),
    tid: uuid,
    ws: uuid,
    mid: uuid,
    exp: z.number().int().positive(),
    nonce: NonceSchema,
  })
  .strict();

const VersionProbeSchema = z.object({ v: z.unknown() }).passthrough();

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
/** HMAC-SHA256 = 32 bytes. */
const SIGNATURE_BYTES = 32;

function sign(encodedPayload: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest();
}

/**
 * Assina um payload arbitrário. Uso interno e de teste (versões e formatos que o
 * `mintGrant` nunca produz). Quem tem o segredo já pode tudo: isto não abre superfície.
 */
export function signRawGrant(payload: unknown, secret: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded, secret).toString('base64url')}`;
}

/** Nonce novo para `copilot_turns.grant_nonce` (32 caracteres base64url, 192 bits). */
export function generateGrantNonce(): string {
  return randomBytes(24).toString('base64url');
}

export interface MintGrantInput {
  readonly turnId: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly nonce: string;
  /** 1..120. Default 120 (a vida do turno). */
  readonly ttlSeconds?: number;
}

export interface GrantOptions {
  /** Default: `COPILOT_GRANT_SECRET` (config). */
  readonly secret?: Buffer;
  /** Default: `Date.now()`. */
  readonly now?: Date;
}

/** Emite o grant do turno. Entrada inválida é erro de programação: lança. */
export function mintGrant(input: MintGrantInput, options: GrantOptions = {}): string {
  const ttl = input.ttlSeconds ?? COPILOT_GRANT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > COPILOT_GRANT_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds precisa ser inteiro em 1..${COPILOT_GRANT_TTL_SECONDS}.`);
  }
  const nowMs = (options.now ?? new Date()).getTime();
  const payload = PayloadV1Schema.parse({
    v: COPILOT_GRANT_VERSION,
    tid: input.turnId,
    ws: input.workspaceId,
    mid: input.memberId,
    exp: Math.floor(nowMs / 1000) + ttl,
    nonce: input.nonce,
  });
  return signRawGrant(payload, options.secret ?? copilotGrantSecret());
}

/** Comparação em tempo constante; tamanho diferente compara consigo mesmo e recusa. */
function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Verifica o grant. Ordem: forma → assinatura (tempo constante) → versão → schema → `exp`
 * (vencido → `grant_expired`; além de `TTL + folga` → `grant_malformed`).
 * Nunca lança: entrada de rede vira motivo estável.
 */
export function verifyGrant(token: unknown, options: GrantOptions = {}): GrantVerification {
  const fail = (reason: GrantRejectionReason): GrantVerification => ({ ok: false, reason });
  if (typeof token !== 'string' || token.length === 0 || token.length > COPILOT_GRANT_MAX_LENGTH) {
    return fail('grant_malformed');
  }
  const parts = token.split('.');
  const [encodedPayload, encodedSignature] = parts;
  if (
    parts.length !== 2 ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !B64URL_RE.test(encodedPayload) ||
    !B64URL_RE.test(encodedSignature)
  ) {
    return fail('grant_malformed');
  }

  const secret = options.secret ?? copilotGrantSecret();
  const expected = sign(encodedPayload, secret);
  const provided = Buffer.from(encodedSignature, 'base64url');
  // Assinatura com tamanho errado também é "assinatura inválida" (não "malformado"): o
  // chamador não aprende nada sobre o formato esperado comparando os dois motivos.
  // Codificação canônica obrigatória: o decodificador base64url ignora os bits de sobra do
  // último caractere, e sem esta checagem duas grafias diferentes valeriam pela mesma
  // assinatura (maleabilidade).
  if (
    provided.length !== SIGNATURE_BYTES ||
    provided.toString('base64url') !== encodedSignature ||
    !constantTimeEqual(provided, expected)
  ) {
    return fail('grant_bad_signature');
  }

  // Daqui em diante o payload é autêntico (foi emitido por quem tem o segredo).
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return fail('grant_malformed');
  }
  const probe = VersionProbeSchema.safeParse(decoded);
  if (!probe.success) return fail('grant_malformed');
  if (probe.data.v !== COPILOT_GRANT_VERSION) return fail('grant_unsupported_version');

  const payload = PayloadV1Schema.safeParse(decoded);
  if (!payload.success) return fail('grant_malformed');

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.data.exp <= nowSeconds) return fail('grant_expired');
  // Nenhum grant legítimo vale mais que o TTL máximo: um `exp` distante (segredo vazado,
  // relógio errado, emissor fora do contrato) não vira credencial de longa duração.
  if (
    payload.data.exp >
    nowSeconds + COPILOT_GRANT_TTL_SECONDS + COPILOT_GRANT_CLOCK_SKEW_SECONDS
  ) {
    return fail('grant_malformed');
  }

  return { ok: true, payload: payload.data };
}
