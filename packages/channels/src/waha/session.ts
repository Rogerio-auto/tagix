/**
 * Gestão de sessão WAHA.
 *
 * A WAHA opera por "sessões" nomeadas (uma sessão = uma conta WhatsApp logada
 * via QR). Antes de enviar/baixar, o adapter garante que a sessão está em
 * estado `WORKING`. `ensureSession` é idempotente:
 *  - `409 Conflict`  → sessão já existe / já iniciada: tratado como sucesso.
 *  - `422 Unprocessable` → estado intermediário (ex.: STARTING/SCAN_QR_CODE):
 *    aguarda e re-checa (retry), em vez de falhar.
 *
 * Quando a sessão está `FAILED`/`STOPPED` sem recuperação, lança `WahaError`
 * (o caller notifica o admin — UI em F1-S19).
 */

import { WahaError, type WahaClient } from './client';

/** Estados de sessão da WAHA (subset relevante). */
export type WahaSessionStatus =
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | 'STOPPED';

export interface EnsureSessionOptions {
  /** Tentativas de re-checagem do status. Default: 5. */
  readonly maxAttempts?: number;
  /** Espera base entre re-checagens, em ms. Default: 500. */
  readonly pollIntervalMs?: number;
}

const DEFAULTS = {
  maxAttempts: 5,
  pollIntervalMs: 500,
} as const;

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Lê `status` de `GET /api/sessions/{name}` com narrowing. */
function extractStatus(body: unknown): WahaSessionStatus | undefined {
  if (!isRecord(body)) return undefined;
  const status = asString(body['status']);
  switch (status) {
    case 'STARTING':
    case 'SCAN_QR_CODE':
    case 'WORKING':
    case 'FAILED':
    case 'STOPPED':
      return status;
    default:
      return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Garante que a sessão `session` está em `WORKING`. Cria/inicia se necessário,
 * tolerando 409 (já existe) e 422 (estado transitório, re-checa). Lança
 * `WahaError` se a sessão não converge para `WORKING` ou está em falha.
 */
export async function ensureSession(
  client: WahaClient,
  session: string,
  opts: EnsureSessionOptions = {},
): Promise<WahaSessionStatus> {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULTS.pollIntervalMs;

  // Tenta iniciar a sessão. 409/422 não são fatais aqui — seguimos para o poll.
  await tryStart(client, session);

  let lastStatus: WahaSessionStatus | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await fetchStatus(client, session);
    lastStatus = status;

    if (status === 'WORKING') return status;
    if (status === 'FAILED' || status === 'STOPPED') {
      throw new WahaError(`Sessão WAHA '${session}' em estado não recuperável: ${status}.`, {
        httpStatus: 422,
        retryable: false,
        raw: { session, status },
      });
    }

    // STARTING / SCAN_QR_CODE / desconhecido: aguarda e re-checa.
    if (attempt < maxAttempts) await delay(pollIntervalMs * attempt);
  }

  throw new WahaError(
    `Sessão WAHA '${session}' não atingiu WORKING após ${maxAttempts} checagens (último: ${lastStatus ?? 'desconhecido'}).`,
    { httpStatus: 422, retryable: true, raw: { session, lastStatus } },
  );
}

/**
 * `POST /api/sessions/{name}/start`. Idempotente: 409 (já iniciada) e 422
 * (estado transitório) são engolidos; demais erros propagam.
 */
async function tryStart(client: WahaClient, session: string): Promise<void> {
  try {
    await client.post(`/api/sessions/${encodeURIComponent(session)}/start`, { name: session });
  } catch (err: unknown) {
    if (err instanceof WahaError && (err.httpStatus === 409 || err.httpStatus === 422)) {
      return; // já existe / transitório — o poll de status resolve.
    }
    throw err;
  }
}

/** `GET /api/sessions/{name}` → status normalizado. */
async function fetchStatus(client: WahaClient, session: string): Promise<WahaSessionStatus | undefined> {
  try {
    const body = await client.get(`/api/sessions/${encodeURIComponent(session)}`);
    return extractStatus(body);
  } catch (err: unknown) {
    // 404 / outros: trata como ainda não pronta (deixa o poll continuar).
    if (err instanceof WahaError) return undefined;
    throw err;
  }
}
