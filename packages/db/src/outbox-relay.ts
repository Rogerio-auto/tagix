/**
 * Lado do banco do relay da outbox (F70-S16). Só o relay dos workers usa isto
 * (papel `hm_outbox_relay`; nunca a API).
 *
 * ## Um lote
 * ```
 * BEGIN
 *   SET LOCAL idle_in_transaction_session_timeout / lock_timeout
 *   SELECT … WHERE status='pending' AND available_at <= now()
 *     ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED      ← linhas travadas só por ESTE relay
 *   publish(rows)  → confirmações do broker            ← fora do banco, com prazo
 *   UPDATE sent / pending(+backoff) / dead            ← um comando por destino
 * COMMIT
 * ```
 * A transação dura o lote e a confirmação (prazo curto no publisher); o
 * `idle_in_transaction_session_timeout` é o cinto: um relay travado perde a sessão, as
 * travas caem e outro relay assume (a mensagem pode sair duas vezes — pelo menos uma
 * vez, com dedup no consumidor pelo event_id).
 *
 * Dois relays em paralelo nunca pegam a mesma linha: `SKIP LOCKED` pula o que o outro
 * travou. Em condições normais cada mensagem sai uma vez.
 */
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { OUTBOX_NOTIFY_CHANNEL } from './outbox';

/** Linha reivindicada pelo relay. */
export interface ClaimedOutboxRow {
  readonly id: number;
  readonly eventId: string;
  readonly kind: string;
  readonly workspaceId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly envelope: unknown;
  /** Tentativas ANTES desta. */
  readonly attempts: number;
}

/** Destino de uma linha depois da publicação. */
export type OutboxOutcome =
  | { readonly id: number; readonly kind: 'sent' }
  | {
      readonly id: number;
      readonly kind: 'retry';
      readonly delayMs: number;
      readonly error: string;
    }
  | { readonly id: number; readonly kind: 'dead'; readonly error: string };

export interface ClaimBatchOptions {
  readonly limit: number;
  /** Cinto contra relay travado com as linhas presas (default 30s). */
  readonly idleInTransactionTimeoutMs?: number;
  /** Só as linhas deste workspace (drenagem dirigida: reenvio manual, testes). */
  readonly workspaceId?: string;
}

export interface OutboxBatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly dead: number;
}

const MAX_ERROR_LEN = 1_000;

function clampError(error: string): string {
  return error.length <= MAX_ERROR_LEN ? error : `${error.slice(0, MAX_ERROR_LEN - 1)}…`;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

/**
 * Reivindica um lote, entrega a `publish` e aplica o que ela decidiu — tudo numa
 * transação. `publish` devolve um destino por linha; linha sem destino volta como está
 * (fica `pending`, sem gastar tentativa).
 */
export async function withClaimedOutboxBatch(
  opts: ClaimBatchOptions,
  publish: (rows: readonly ClaimedOutboxRow[]) => Promise<readonly OutboxOutcome[]>,
): Promise<OutboxBatchResult> {
  const idleMs = Math.max(1_000, Math.trunc(opts.idleInTransactionTimeoutMs ?? 30_000));
  const limit = Math.max(1, Math.trunc(opts.limit));

  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${String(idleMs)}ms'`),
    );
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    const scope =
      opts.workspaceId === undefined ? sql`` : sql`AND workspace_id = ${opts.workspaceId}::uuid`;
    const claimed = rowsOf(
      await tx.execute(sql`
        SELECT id, event_id, kind, workspace_id, exchange, routing_key, envelope, attempts
          FROM outbox
         WHERE status = 'pending' AND available_at <= now() ${scope}
         ORDER BY id
         LIMIT ${limit}
           FOR UPDATE SKIP LOCKED
      `),
    ).map(
      (r): ClaimedOutboxRow => ({
        id: Number(r['id']),
        eventId: String(r['event_id']),
        kind: String(r['kind']),
        workspaceId: String(r['workspace_id']),
        exchange: String(r['exchange']),
        routingKey: String(r['routing_key']),
        envelope: r['envelope'],
        attempts: Number(r['attempts']),
      }),
    );
    if (claimed.length === 0) return { claimed: 0, sent: 0, retried: 0, dead: 0 };

    const outcomes = await publish(claimed);
    const known = new Set(claimed.map((r) => r.id));
    const sentIds: number[] = [];
    const retry: { id: number; delayMs: number; error: string }[] = [];
    const dead: { id: number; error: string }[] = [];
    for (const o of outcomes) {
      if (!known.has(o.id)) continue;
      if (o.kind === 'sent') sentIds.push(o.id);
      else if (o.kind === 'retry') {
        retry.push({
          id: o.id,
          delayMs: Math.max(0, Math.trunc(o.delayMs)),
          error: clampError(o.error),
        });
      } else dead.push({ id: o.id, error: clampError(o.error) });
    }

    if (sentIds.length > 0) {
      await tx.execute(sql`
        UPDATE outbox
           SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
         WHERE id = ANY(${`{${sentIds.join(',')}}`}::bigint[])
      `);
    }
    if (retry.length > 0) {
      await tx.execute(sql`
        UPDATE outbox o
           SET attempts = o.attempts + 1,
               available_at = now() + make_interval(secs => f.delay_ms / 1000.0),
               last_error = f.error
          FROM unnest(
                 ${`{${retry.map((r) => r.id).join(',')}}`}::bigint[],
                 ${`{${retry.map((r) => r.delayMs).join(',')}}`}::bigint[],
                 ${pgTextArray(retry.map((r) => r.error))}::text[]
               ) AS f(id, delay_ms, error)
         WHERE o.id = f.id
      `);
    }
    if (dead.length > 0) {
      await tx.execute(sql`
        UPDATE outbox o
           SET status = 'dead', attempts = o.attempts + 1, last_error = f.error
          FROM unnest(
                 ${`{${dead.map((r) => r.id).join(',')}}`}::bigint[],
                 ${pgTextArray(dead.map((r) => r.error))}::text[]
               ) AS f(id, error)
         WHERE o.id = f.id
      `);
    }
    return {
      claimed: claimed.length,
      sent: sentIds.length,
      retried: retry.length,
      dead: dead.length,
    };
  });
}

/** Literal de array de texto do Postgres (aspas e barras escapadas). */
function pgTextArray(values: readonly string[]): string {
  const items = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${items.join(',')}}`;
}

/** Retenção de `sent` (dias). */
export const DEFAULT_OUTBOX_SENT_RETENTION_DAYS = 7;
/**
 * Retenção de `dead` (dias, F70-S24; era 30). A linha morta carrega o envelope inteiro,
 * com dado pessoal, e a outbox não entra na redação/exclusão de contato (LGPD). Sete dias
 * cobrem uma semana inteira de triagem (fim de semana incluso), com alerta `error` a cada
 * 10 min enquanto houver morto; guardar mais só prolonga a cópia do dado.
 */
export const DEFAULT_OUTBOX_DEAD_RETENTION_DAYS = 7;

export interface PurgeOutboxOptions {
  /** Enviados mais velhos que isto somem (default {@link DEFAULT_OUTBOX_SENT_RETENTION_DAYS}). */
  readonly sentRetentionDays?: number;
  /**
   * Mortos mais velhos que isto somem (default {@link DEFAULT_OUTBOX_DEAD_RETENTION_DAYS}).
   * O envelope guarda dado pessoal (texto de mensagem, telefone): a janela é a mesma dos
   * enviados, e o relay loga `error` a cada limpeza enquanto houver morto.
   */
  readonly deadRetentionDays?: number;
  /** Linhas por DELETE (default 5000). */
  readonly batchSize?: number;
  /** Teto de lotes por chamada (default 20) — a próxima rodada continua. */
  readonly maxBatches?: number;
}

export interface PurgeOutboxResult {
  readonly sent: number;
  readonly dead: number;
}

/**
 * Limpa o que já saiu (e os mortos antigos) em lotes curtos, pelos índices parciais
 * `idx_outbox_sent_at`/`idx_outbox_dead`. `SKIP LOCKED` deixa dois relays limparem ao
 * mesmo tempo sem se esperar.
 */
export async function purgeOutbox(opts: PurgeOutboxOptions = {}): Promise<PurgeOutboxResult> {
  const sentDays = Math.max(
    1,
    Math.trunc(opts.sentRetentionDays ?? DEFAULT_OUTBOX_SENT_RETENTION_DAYS),
  );
  const deadDays = Math.max(
    1,
    Math.trunc(opts.deadRetentionDays ?? DEFAULT_OUTBOX_DEAD_RETENTION_DAYS),
  );
  const batch = Math.max(1, Math.trunc(opts.batchSize ?? 5_000));
  const maxBatches = Math.max(1, Math.trunc(opts.maxBatches ?? 20));
  const db = getDb();

  const run = async (status: 'sent' | 'dead', days: number): Promise<number> => {
    let total = 0;
    for (let i = 0; i < maxBatches; i += 1) {
      const column = status === 'sent' ? sql`sent_at` : sql`created_at`;
      const result = await db.execute(sql`
        DELETE FROM outbox
         WHERE id IN (
           SELECT id FROM outbox
            WHERE status = ${status}
              AND ${column} < now() - make_interval(days => ${days})
            ORDER BY ${column}
            LIMIT ${batch}
              FOR UPDATE SKIP LOCKED
         )
      `);
      const n = result.count;
      total += n;
      if (n < batch) break;
    }
    return total;
  };

  const sent = await run('sent', sentDays);
  const dead = await run('dead', deadDays);
  return { sent, dead };
}

export interface OutboxBacklog {
  readonly pending: number;
  readonly due: number;
  readonly dead: number;
  /** Idade (s) da pendente mais antiga; `null` sem pendentes. */
  readonly oldestPendingAgeSeconds: number | null;
}

/** Retrato da fila (log/health). Usa os índices parciais. */
export async function outboxBacklog(): Promise<OutboxBacklog> {
  const [row] = rowsOf(
    await getDb().execute(sql`
      SELECT
        (SELECT count(*) FROM outbox WHERE status = 'pending') AS pending,
        (SELECT count(*) FROM outbox WHERE status = 'pending' AND available_at <= now()) AS due,
        (SELECT count(*) FROM outbox WHERE status = 'dead') AS dead,
        (SELECT extract(epoch FROM now() - min(created_at)) FROM outbox WHERE status = 'pending') AS oldest
    `),
  );
  const oldest = row?.['oldest'];
  return {
    pending: Number(row?.['pending'] ?? 0),
    due: Number(row?.['due'] ?? 0),
    dead: Number(row?.['dead'] ?? 0),
    oldestPendingAgeSeconds: oldest === null || oldest === undefined ? null : Number(oldest),
  };
}

export interface OutboxListener {
  close(): Promise<void>;
}

/**
 * `LISTEN hm_outbox` numa conexão dedicada: `onNotify` a cada commit que gravou na
 * outbox. O postgres.js refaz o LISTEN sozinho se a conexão cair (`onListen` avisa a
 * cada (re)inscrição — o relay drena ali o que pode ter chegado no intervalo).
 */
export async function listenOutbox(
  onNotify: () => void,
  opts: { readonly url?: string; readonly onListen?: () => void } = {},
): Promise<OutboxListener> {
  const url = opts.url ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('Variável de ambiente obrigatória ausente: DATABASE_URL');
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await client.listen(
      OUTBOX_NOTIFY_CHANNEL,
      () => onNotify(),
      () => opts.onListen?.(),
    );
  } catch (err) {
    await client.end({ timeout: 1 }).catch(() => undefined);
    throw err;
  }
  return {
    async close(): Promise<void> {
      await client.end({ timeout: 2 });
    },
  };
}
