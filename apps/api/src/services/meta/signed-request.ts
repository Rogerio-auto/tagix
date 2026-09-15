/**
 * Verificação do `signed_request` da Meta (F69-S01).
 *
 * A Meta chama os callbacks de exclusão de dados e de desautorização com um corpo
 * `signed_request=<assinatura>.<payload>`, os dois em base64url. A assinatura é o
 * HMAC-SHA256 do **payload ainda codificado**, com o App Secret como chave.
 *
 * ## Por que a assinatura é conferida antes de ler o payload
 *
 * Estas rotas são públicas por definição — quem chama é a Meta, sem sessão. Sem a
 * assinatura, qualquer pessoa poderia pedir a exclusão dos dados de um usuário
 * alheio ou derrubar a conexão de um cliente. Então nada do payload é interpretado
 * antes de o HMAC bater: JSON de origem desconhecida não chega nem ao `JSON.parse`.
 *
 * A comparação é em tempo constante. Comparar com `===` vaza, pelo tempo de
 * resposta, quantos bytes iniciais da assinatura estavam certos.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignedRequestFailure =
  /** Formato quebrado: sem ponto, base64url inválido, JSON ilegível. */
  | 'malformed'
  /** HMAC não confere. */
  | 'bad_signature'
  /** Payload assinado, mas com algoritmo diferente do único que aceitamos. */
  | 'bad_algorithm'
  /** Payload válido sem `user_id` — não há de quem apagar nada. */
  | 'missing_user';

export interface SignedRequestPayload {
  /** ID do usuário com escopo do app (não é o ID global do Facebook). */
  readonly userId: string;
  readonly issuedAt: number | null;
}

export type SignedRequestResult =
  | { readonly ok: true; readonly payload: SignedRequestPayload }
  | { readonly ok: false; readonly reason: SignedRequestFailure };

/** Único algoritmo aceito. Qualquer outro é recusado mesmo com assinatura válida. */
const ALGORITMO = 'HMAC-SHA256';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function verifySignedRequest(signedRequest: string, appSecret: string): SignedRequestResult {
  if (appSecret === '') return { ok: false, reason: 'bad_signature' };

  const partes = signedRequest.split('.');
  if (partes.length !== 2) return { ok: false, reason: 'malformed' };
  const [assinaturaCodificada, payloadCodificado] = partes as [string, string];
  if (!BASE64URL.test(assinaturaCodificada) || !BASE64URL.test(payloadCodificado)) {
    return { ok: false, reason: 'malformed' };
  }

  const recebida = Buffer.from(assinaturaCodificada, 'base64url');
  const esperada = createHmac('sha256', appSecret).update(payloadCodificado).digest();
  // `timingSafeEqual` exige tamanhos iguais; o tamanho de um SHA-256 é público,
  // então checá-lo antes não vaza nada.
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(Buffer.from(payloadCodificado, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof bruto !== 'object' || bruto === null) return { ok: false, reason: 'malformed' };

  const payload = bruto as Record<string, unknown>;
  const algoritmo = payload['algorithm'];
  if (typeof algoritmo !== 'string' || algoritmo.toUpperCase() !== ALGORITMO) {
    return { ok: false, reason: 'bad_algorithm' };
  }

  const userId = payload['user_id'];
  if (typeof userId !== 'string' || userId.trim() === '') {
    return { ok: false, reason: 'missing_user' };
  }

  const issuedAt = payload['issued_at'];
  return {
    ok: true,
    payload: { userId, issuedAt: typeof issuedAt === 'number' ? issuedAt : null },
  };
}
