/**
 * Dispatcher de webhooks outbound (F9-S05).
 *
 * Drena `outbound_webhook_deliveries` com status `pending`/`retrying` e
 * `next_attempt_at <= now()`, faz o POST HTTP assinado com HMAC-SHA256 sobre o
 * segredo (decifrado de `outbound_webhooks.secret_enc`, AES-256-GCM) e atualiza o
 * estado:
 *   - 2xx → `sent` (sent_at = now()).
 *   - falha (rede/timeout/≥400) → backoff exponencial: incrementa `attempt`, agenda
 *     `next_attempt_at` e marca `retrying`; ao exceder `MAX_ATTEMPTS`, marca `failed`.
 *
 * Roda como owner (`getDb()`): drain de plataforma sobre a fila durável de todos os
 * tenants. Cada linha já carrega `workspace_id`; nada cruza tenant porque só lemos a
 * própria linha + seu webhook.
 */
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decryptSecret, getDb } from '@hm/db';
import type { Logger } from '@hm/logger';

/** Máximo de tentativas antes de `failed` (1 inicial + retries). */
export const MAX_ATTEMPTS = 6;
/** Base do backoff exponencial (segundos): 2^attempt * BASE, com teto. */
const BACKOFF_BASE_SECONDS = 5;
const BACKOFF_CAP_SECONDS = 3600;
/** Quantas deliveries por tick (evita varredura ilimitada). */
const BATCH_SIZE = 50;
/** Timeout do POST por entrega. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Header da assinatura HMAC (cliente verifica `sha256=<hex>` sobre o corpo cru). */
export const SIGNATURE_HEADER = 'x-hm-signature-256';

interface DueDelivery extends Record<string, unknown> {
  readonly id: string;
  readonly url: string;
  readonly secretEnc: string;
  readonly event: string;
  readonly payload: unknown;
  readonly attempt: number;
}

/** Assina `body` com HMAC-SHA256 → `sha256=<hex>`. Mesmo esquema do test-delivery (S04). */
export function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

/** Backoff exponencial com teto (segundos) para a próxima tentativa. */
export function backoffSeconds(attempt: number): number {
  return Math.min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** attempt);
}

export interface DispatchDeps {
  readonly logger: Logger;
  /** Injetável p/ teste (default: fetch global). */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

export interface DispatchTickResult {
  readonly processed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
}

/**
 * Processa um lote de entregas vencidas. Idempotente por tick: um `FOR UPDATE SKIP
 * LOCKED` garante que dois ticks concorrentes não peguem a mesma linha.
 */
export async function dispatchPending(deps: DispatchDeps): Promise<DispatchTickResult> {
  const db = getDb();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  // Pega as vencidas + dados do webhook (url/secret) num só round-trip, travando as
  // linhas selecionadas para outros ticks (SKIP LOCKED) — fan-out seguro multi-worker.
  const due = await db.execute<DueDelivery>(sql`
    SELECT d.id, w.url, w.secret_enc AS "secretEnc", d.event, d.payload, d.attempt
    FROM outbound_webhook_deliveries d
    JOIN outbound_webhooks w ON w.id = d.webhook_id
    WHERE d.status IN ('pending', 'retrying')
      AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
    ORDER BY d.next_attempt_at NULLS FIRST
    LIMIT ${BATCH_SIZE}
    FOR UPDATE OF d SKIP LOCKED
  `);

  const rows = Array.from(due);
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    const body = JSON.stringify(row.payload ?? {});
    const attemptNo = row.attempt + 1;
    const outcome = await attemptDelivery(fetchImpl, row, body);

    if (outcome.ok) {
      await db.execute(sql`
        UPDATE outbound_webhook_deliveries
        SET status = 'sent', attempt = ${attemptNo}, response_status = ${outcome.status ?? null},
            response_body = ${truncate(outcome.responseBody)}, sent_at = ${now().toISOString()}
        WHERE id = ${row.id}::uuid
      `);
      sent += 1;
      continue;
    }

    // Falha — decide retry vs failed terminal.
    if (attemptNo >= MAX_ATTEMPTS) {
      await db.execute(sql`
        UPDATE outbound_webhook_deliveries
        SET status = 'failed', attempt = ${attemptNo}, response_status = ${outcome.status ?? null},
            response_body = ${truncate(outcome.responseBody ?? outcome.error)}
        WHERE id = ${row.id}::uuid
      `);
      failed += 1;
      deps.logger.warn('webhook delivery falhou definitivamente', {
        deliveryId: row.id,
        attempts: attemptNo,
      });
    } else {
      const next = new Date(now().getTime() + backoffSeconds(attemptNo) * 1000);
      await db.execute(sql`
        UPDATE outbound_webhook_deliveries
        SET status = 'retrying', attempt = ${attemptNo}, response_status = ${outcome.status ?? null},
            response_body = ${truncate(outcome.responseBody ?? outcome.error)},
            next_attempt_at = ${next.toISOString()}
        WHERE id = ${row.id}::uuid
      `);
      retried += 1;
    }
  }

  return { processed: rows.length, sent, retried, failed };
}

interface AttemptOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly responseBody?: string;
  readonly error?: string;
}

/** Faz o POST assinado; classifica 2xx como sucesso, o resto como falha. */
async function attemptDelivery(
  fetchImpl: typeof fetch,
  row: DueDelivery,
  body: string,
): Promise<AttemptOutcome> {
  let signature: string;
  try {
    signature = signWebhook(decryptSecret(row.secretEnc), body);
  } catch (err) {
    // Segredo corrompido/inválido — não-retentável de forma útil, mas tratamos como
    // falha comum (retry deixa o operador ver o erro no log de deliveries).
    return { ok: false, error: err instanceof Error ? err.message : 'secret_error' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(row.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature,
        'x-hm-event': row.event,
      },
      body,
      signal: controller.signal,
    });
    const text = await safeText(resp);
    return { ok: resp.ok, status: resp.status, responseBody: text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(resp: Response): Promise<string | undefined> {
  try {
    return (await resp.text()).slice(0, 2000);
  } catch {
    return undefined;
  }
}

/** Limita o corpo de resposta persistido (coluna text; evita blobs gigantes). */
function truncate(value: string | undefined): string | null {
  if (value == null) return null;
  return value.length > 2000 ? value.slice(0, 2000) : value;
}
