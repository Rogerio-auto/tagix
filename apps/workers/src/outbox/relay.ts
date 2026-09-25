/**
 * Relay da outbox transacional (F70-S16).
 *
 * Leva ao RabbitMQ o que os produtores gravaram na tabela `outbox` na transação do
 * dado. Garantia: PELO MENOS UMA VEZ. O consumidor deduplica pelo event_id (fan-out
 * de webhooks: índice único por eventId; outbound: guarda do external_id).
 *
 * ```
 * NOTIFY hm_outbox (commit) ─┐
 * polling de segurança ──────┼─► drena: lote FOR UPDATE SKIP LOCKED
 *                            │     → publish com confirms (mandatory)
 *                            │     → ack: sent | falha: backoff | esgotou: dead (log error)
 * limpeza periódica ─────────┘   enviados > N dias, mortos > M dias
 * ```
 *
 * ## Duas falhas, dois tratamentos
 * - **Broker fora** (não conecta, conexão caiu): o relay NÃO reivindica linha nenhuma —
 *   só tenta reconectar com backoff exponencial (teto). Uma queda longa do broker não
 *   gasta tentativa de mensagem nem manda nada para `dead`.
 * - **Mensagem recusada** (nack, sem rota, confirmação fora do prazo): a LINHA ganha
 *   tentativa, volta com backoff exponencial com jitter (teto) e, no máximo de
 *   tentativas, vira `dead` com log de erro.
 *
 * ## Linha que não pode sair (F70-S24)
 * Antes de publicar, o relay repete os CHECKs do banco (`outboxRowViolation`): envelope
 * válido, workspace do envelope = coluna, `job` só nas filas de `OUTBOX_JOB_QUEUES`,
 * `event` só com routing key `domain.*`. A linha que viola vai DIRETO para `dead`, sem
 * tentar publicar, com log `error` (motivo, workspace, destino — nunca o payload). O
 * banco já recusa essas linhas na gravação; esta é a segunda trava, no único ponto que
 * publica.
 *
 * Vários relays (uma instância por processo de workers) em paralelo: `SKIP LOCKED`
 * reparte as linhas; o NOTIFY acorda todos, e quem chega depois encontra o lote vazio.
 */
import {
  listenOutbox,
  outboxBacklog,
  purgeOutbox,
  withClaimedOutboxBatch,
  type ClaimedOutboxRow,
  type OutboxBatchResult,
  type OutboxListener,
  type OutboxOutcome,
  type PurgeOutboxOptions,
} from '@hm/db';
import {
  envelopeSchema,
  openConfirmPublisher,
  outboxRowViolation,
  type ConfirmPublisher,
  type ConfirmPublishItem,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
}

export interface OutboxRelayOptions {
  readonly logger: Logger;
  /** Abre o publisher (default: conexão própria com confirms, `AMQP_URL`). */
  readonly connectPublisher?: () => Promise<ConfirmPublisher>;
  /** Linhas por lote (default 100). */
  readonly batchSize?: number;
  /** Polling de segurança (default 1s) — cobre NOTIFY perdido e backoff vencido. */
  readonly pollIntervalMs?: number;
  /** Tentativas por mensagem antes de `dead` (default 12). */
  readonly maxAttempts?: number;
  /** Backoff por mensagem (default 1s → teto 5min, com jitter). */
  readonly messageBackoff?: BackoffOptions;
  /** Backoff de reconexão ao broker/banco (default 500ms → teto 30s). */
  readonly reconnectBackoff?: BackoffOptions;
  /** `LISTEN hm_outbox` (default true). */
  readonly listen?: boolean;
  /** Limpeza (default: a cada 10min; enviados 7 dias, mortos 7). `false` desliga. */
  readonly cleanup?: (PurgeOutboxOptions & { readonly intervalMs?: number }) | false;
  /** Cinto de transação presa (default 30s; precisa ser maior que o prazo de confirmação). */
  readonly idleInTransactionTimeoutMs?: number;
  /** Jitter (default true). Os testes desligam para ver o backoff exato. */
  readonly jitter?: boolean;
  /** Drena só um workspace (reenvio dirigido, testes). Default: todos. */
  readonly workspaceId?: string;
}

export interface OutboxRelayStats {
  readonly batches: number;
  readonly sent: number;
  readonly retried: number;
  readonly dead: number;
  readonly publisherOpen: boolean;
  readonly listening: boolean;
}

const DEFAULTS = {
  batchSize: 100,
  pollIntervalMs: 1_000,
  maxAttempts: 12,
  messageBackoff: { baseMs: 1_000, maxMs: 300_000 },
  reconnectBackoff: { baseMs: 500, maxMs: 30_000 },
  cleanupIntervalMs: 10 * 60_000,
  idleInTransactionTimeoutMs: 30_000,
} as const;

/** Atraso da tentativa `attempt` (1 = primeira falha): base·2^(n-1), teto, jitter 50–100%. */
export function backoffDelayMs(attempt: number, o: BackoffOptions, jitter = true): number {
  const n = Math.max(1, Math.trunc(attempt));
  const raw = Math.min(o.maxMs, o.baseMs * 2 ** Math.min(n - 1, 30));
  return jitter ? Math.floor(raw / 2 + Math.random() * (raw / 2)) : raw;
}

const RELISTEN_INTERVAL_MS = 60_000;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OutboxRelay {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly messageBackoff: BackoffOptions;
  private readonly reconnectBackoff: BackoffOptions;
  private readonly jitter: boolean;
  private readonly connectPublisher: () => Promise<ConfirmPublisher>;

  private publisher: ConfirmPublisher | null = null;
  private listener: OutboxListener | null = null;
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private notified = false;
  private reconnectFailures = 0;
  private nextCleanupAt = 0;
  private nextRelistenAt = 0;
  private stats = { batches: 0, sent: 0, retried: 0, dead: 0 };

  constructor(private readonly opts: OutboxRelayOptions) {
    this.batchSize = opts.batchSize ?? DEFAULTS.batchSize;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULTS.maxAttempts);
    this.messageBackoff = opts.messageBackoff ?? DEFAULTS.messageBackoff;
    this.reconnectBackoff = opts.reconnectBackoff ?? DEFAULTS.reconnectBackoff;
    this.jitter = opts.jitter ?? true;
    this.connectPublisher =
      opts.connectPublisher ?? (() => openConfirmPublisher({ logger: opts.logger }));
  }

  /** Sobe o loop (idempotente). Não espera o broker: conecta em segundo plano. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.opts.listen !== false) {
      await this.startListening();
      this.nextRelistenAt = Date.now() + RELISTEN_INTERVAL_MS;
    }
    this.loop = this.run();
    this.opts.logger.info('outbox relay iniciado', {
      batchSize: this.batchSize,
      pollIntervalMs: this.pollIntervalMs,
      maxAttempts: this.maxAttempts,
      listening: this.listener !== null,
    });
  }

  /** Para o loop, espera o lote em curso terminar e fecha conexões. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.poke();
    await this.loop;
    this.loop = null;
    const listener = this.listener;
    this.listener = null;
    await listener?.close().catch(() => undefined);
    const publisher = this.publisher;
    this.publisher = null;
    await publisher?.close().catch(() => undefined);
    this.opts.logger.info('outbox relay parado', { ...this.stats });
  }

  getStats(): OutboxRelayStats {
    return {
      ...this.stats,
      publisherOpen: this.publisher?.isOpen() ?? false,
      listening: this.listener !== null,
    };
  }

  /**
   * Um lote: reivindica, publica, marca. Exposto para teste e para drenar sob
   * demanda. Sem publisher aberto, não reivindica nada.
   */
  async drainOnce(): Promise<OutboxBatchResult> {
    const publisher = this.publisher;
    if (publisher === null || !publisher.isOpen()) {
      return { claimed: 0, sent: 0, retried: 0, dead: 0 };
    }
    const result = await withClaimedOutboxBatch(
      {
        limit: this.batchSize,
        idleInTransactionTimeoutMs:
          this.opts.idleInTransactionTimeoutMs ?? DEFAULTS.idleInTransactionTimeoutMs,
        ...(this.opts.workspaceId !== undefined ? { workspaceId: this.opts.workspaceId } : {}),
      },
      (rows) => this.publishRows(publisher, rows),
    );
    if (result.claimed > 0) {
      this.stats.batches += 1;
      this.stats.sent += result.sent;
      this.stats.retried += result.retried;
      this.stats.dead += result.dead;
    }
    return result;
  }

  // ─── loop ─────────────────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    while (this.running) {
      if (!(await this.ensurePublisher())) {
        await this.sleep(this.nextReconnectDelay());
        continue;
      }
      let full = false;
      try {
        const result = await this.drainOnce();
        full = result.claimed >= this.batchSize;
        this.reconnectFailures = 0;
      } catch (err: unknown) {
        // Banco fora, transação morta pelo cinto: nada foi marcado, o lote volta.
        this.reconnectFailures += 1;
        this.opts.logger.warn('outbox relay: lote falhou — nova tentativa com backoff', {
          error: describe(err),
          attempt: this.reconnectFailures,
        });
        await this.sleep(this.nextReconnectDelay());
        continue;
      }
      await this.maybeCleanup();
      await this.maybeRelisten();
      if (full || this.consumeNotified()) continue;
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async ensurePublisher(): Promise<boolean> {
    if (this.publisher?.isOpen()) return true;
    const previous = this.publisher;
    this.publisher = null;
    if (previous !== null) await previous.close().catch(() => undefined);
    try {
      this.publisher = await this.connectPublisher();
      if (this.reconnectFailures > 0) {
        this.opts.logger.info('outbox relay: broker de volta', {
          failures: this.reconnectFailures,
        });
      }
      this.reconnectFailures = 0;
      return true;
    } catch (err: unknown) {
      this.reconnectFailures += 1;
      const log = this.reconnectFailures === 1 ? 'warn' : 'error';
      this.opts.logger[log]('outbox relay: broker indisponível — nada é reivindicado até voltar', {
        error: describe(err),
        attempt: this.reconnectFailures,
      });
      return false;
    }
  }

  private nextReconnectDelay(): number {
    return backoffDelayMs(this.reconnectFailures, this.reconnectBackoff, this.jitter);
  }

  private async startListening(): Promise<void> {
    try {
      this.listener = await listenOutbox(
        () => {
          this.notified = true;
          this.poke();
        },
        {
          // (Re)inscrição: pode ter havido commit no intervalo — drena já.
          onListen: () => {
            this.notified = true;
            this.poke();
          },
        },
      );
    } catch (err: unknown) {
      this.listener = null;
      this.opts.logger.warn('outbox relay: LISTEN indisponível — seguindo só com polling', {
        error: describe(err),
      });
    }
  }

  private consumeNotified(): boolean {
    const was = this.notified;
    this.notified = false;
    return was;
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private sleep(ms: number): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      timer.unref?.();
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /**
   * LISTEN que não subiu no boot (banco fora naquela hora): tenta de novo a cada
   * minuto. Enquanto isso o polling de segurança garante a entrega. Depois de
   * inscrito, o postgres.js refaz o LISTEN sozinho a cada reconexão.
   */
  private async maybeRelisten(): Promise<void> {
    if (this.opts.listen === false || this.listener !== null) return;
    const now = Date.now();
    if (now < this.nextRelistenAt) return;
    this.nextRelistenAt = now + RELISTEN_INTERVAL_MS;
    await this.startListening();
    if (this.listener !== null) this.opts.logger.info('outbox relay: LISTEN restabelecido');
  }

  private async maybeCleanup(): Promise<void> {
    const cfg = this.opts.cleanup;
    if (cfg === false) return;
    const now = Date.now();
    if (now < this.nextCleanupAt) return;
    this.nextCleanupAt = now + (cfg?.intervalMs ?? DEFAULTS.cleanupIntervalMs);
    try {
      const purged = await purgeOutbox(cfg ?? {});
      const backlog = await outboxBacklog();
      if (purged.sent > 0 || purged.dead > 0 || backlog.pending > 0 || backlog.dead > 0) {
        this.opts.logger.info('outbox relay: limpeza e backlog', { purged, backlog });
      }
      if (backlog.dead > 0) {
        this.opts.logger.error('outbox: mensagens mortas aguardando ação', { dead: backlog.dead });
      }
    } catch (err: unknown) {
      this.opts.logger.warn('outbox relay: limpeza falhou', { error: describe(err) });
    }
  }

  // ─── publicação de um lote ────────────────────────────────────────────────────

  private async publishRows(
    publisher: ConfirmPublisher,
    rows: readonly ClaimedOutboxRow[],
  ): Promise<OutboxOutcome[]> {
    const outcomes: OutboxOutcome[] = [];
    const items: ConfirmPublishItem[] = [];
    for (const row of rows) {
      const parsed = envelopeSchema.safeParse(row.envelope);
      if (!parsed.success) {
        // Linha corrompida não melhora com retentativa: morta já, com log.
        outcomes.push(
          this.rejected(row, `invalid_envelope: ${parsed.error.issues[0]?.message ?? ''}`),
        );
        continue;
      }
      const violation = outboxRowViolation({
        kind: row.kind,
        workspaceId: row.workspaceId,
        exchange: row.exchange,
        routingKey: row.routingKey,
        envelope: parsed.data,
      });
      if (violation !== null) {
        // Destino fora da lista ou tenant trocado: publicar seria o dano. Morta já.
        outcomes.push(this.rejected(row, violation));
        continue;
      }
      items.push({
        key: String(row.id),
        exchange: row.exchange,
        routingKey: row.routingKey,
        envelope: parsed.data,
      });
    }
    const byKey = new Map(rows.map((r) => [String(r.id), r]));
    const results = await publisher.publishBatch(items);
    for (const item of items) {
      const row = byKey.get(item.key);
      if (row === undefined) continue;
      const failure = results.get(item.key);
      if (failure === null) {
        outcomes.push({ id: row.id, kind: 'sent' });
        continue;
      }
      const error = failure ?? 'no_confirm';
      const attempt = row.attempts + 1;
      if (attempt >= this.maxAttempts) {
        outcomes.push(this.dead(row, error));
      } else {
        const delayMs = backoffDelayMs(attempt, this.messageBackoff, this.jitter);
        this.opts.logger.warn('outbox relay: mensagem não confirmada — nova tentativa', {
          outboxId: row.id,
          eventId: row.eventId,
          routingKey: row.routingKey,
          attempt,
          delayMs,
          error,
        });
        outcomes.push({ id: row.id, kind: 'retry', delayMs, error });
      }
    }
    return outcomes;
  }

  /** Linha que o relay se recusa a publicar (envelope inválido, destino ou tenant). */
  private rejected(row: ClaimedOutboxRow, error: string): OutboxOutcome {
    this.opts.logger.error('outbox relay: mensagem MORTA — recusada antes de publicar', {
      outboxId: row.id,
      eventId: row.eventId,
      kind: row.kind,
      workspaceId: row.workspaceId,
      exchange: row.exchange,
      routingKey: row.routingKey,
      error,
    });
    return { id: row.id, kind: 'dead', error };
  }

  private dead(row: ClaimedOutboxRow, error: string): OutboxOutcome {
    this.opts.logger.error('outbox relay: mensagem MORTA — esgotou as tentativas', {
      outboxId: row.id,
      eventId: row.eventId,
      kind: row.kind,
      workspaceId: row.workspaceId,
      exchange: row.exchange,
      routingKey: row.routingKey,
      attempts: row.attempts + 1,
      error,
    });
    return { id: row.id, kind: 'dead', error };
  }
}

/** Sobe um relay com as opções do ambiente. */
export async function startOutboxRelay(opts: OutboxRelayOptions): Promise<OutboxRelay> {
  const relay = new OutboxRelay(opts);
  await relay.start();
  return relay;
}
