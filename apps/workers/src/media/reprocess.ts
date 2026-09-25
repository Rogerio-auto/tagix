/**
 * Reprocessamento de mídia não ingerida (F70-S27).
 *
 * Depois de corrigida a causa (o caso típico: credencial do storage trocada), recupera
 * as mídias que ficaram para trás. É o miolo do `scripts/reprocess-media.ts`; mora aqui
 * para ser testado junto do worker e usar os mesmos contratos (job, outbox, metadata).
 *
 * ## O que é candidato
 *
 * Mensagem inbound, não apagada, sem `media_sha256`, com `media_status` em
 * `pending`/`downloading`/`failed`, criada na janela pedida e há mais de `minAgeMinutes`
 * (um job recém-nascido ainda está a caminho — reenfileirar seria duplicar). Fica de
 * fora a mídia marcada indisponível na origem (`metadata.mediaUnavailable`, F61-S11).
 *
 * ## De onde vem o job
 *
 * Em ordem: `metadata.mediaJob` (gravado pelo worker na falha), o último job de
 * `hm.q.media` ainda na outbox (retida por 7 dias depois de enviada) e, para o que
 * morreu na fila, o próprio job na DLQ. Sem nenhum dos três, não há como pedir o
 * arquivo de novo — a mensagem é contada como `noReference`.
 *
 * ## O que NÃO se tenta
 *
 *  - falha terminal do provedor (`media_expired`, `media_unavailable`, `empty_media`);
 *  - mídia mais velha que a janela de recuperação do provedor
 *    ({@link providerRecoveryWindowDays}): o provedor já apagou o arquivo, e tentar
 *    só gera ruído. O relatório diz quantas são (`tooOld`).
 *
 * ## Idempotência
 *
 * Cada reenfileiramento roda numa transação `withWorkspace` (RLS real): trava a linha
 * (`FOR UPDATE`), confere de novo o estado, grava `metadata.mediaReprocess.requestedAt`,
 * volta o status para `pending` e grava o job na outbox pelo `inboundMediaJobOutbox`,
 * com o workspace REAL da mensagem. Um pedido em voo (reprocesso mais novo que a última
 * falha) é pulado: rodar duas vezes não duplica. Se o reprocesso falhar de novo, o
 * worker grava uma falha mais nova e a mensagem volta a ser candidata. `force` ignora o
 * pedido em voo (job perdido).
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { closeDb, enqueueOutbox, getDb, withWorkspace } from '@hm/db';
import {
  connectMq,
  DLQ_QUEUE,
  envelopeSchema,
  ORIGIN_QUEUE_HEADER,
  QUEUES,
  type MqHandle,
} from '@hm/shared/mq';
import type { ChannelProvider } from '@hm/shared';
import { inboundMediaJobOutbox } from '../inbound/mq-ports';
import { mediaJobSchema, type MediaJob } from './job';
import { MEDIA_FAILURE_META, MEDIA_JOB_META, MEDIA_REPROCESS_META } from './adapters';
import { TERMINAL_MEDIA_FAILURES, type MediaFailureReason } from './ports';

/**
 * Janela em que o provedor ainda devolve o arquivo (dias desde o recebimento).
 *
 * Estimativas conservadoras, não contrato: a Meta não publica a retenção da mídia
 * RECEBIDA por mensagem de forma estável (a URL de download dura minutos; o `media_id`
 * resolve por semanas). O Instagram serve anexos por URL de CDN que expira em dias. O
 * WAHA depende do armazenamento da sessão. Ajustável por `maxAgeDays`.
 */
const RECOVERY_WINDOW_DAYS: Readonly<Record<ChannelProvider, number>> = {
  meta_whatsapp: 30,
  meta_instagram: 7,
  waha: 7,
  // E-mail não passa pelo download de mídia do provedor hoje; valor defensivo.
  email: 7,
};

export function providerRecoveryWindowDays(provider: ChannelProvider): number {
  return RECOVERY_WINDOW_DAYS[provider];
}

export interface ReprocessOptions {
  /** Só este workspace (recomendado). Sem ele, todos. */
  readonly workspaceId?: string | undefined;
  /** Início da janela (inclusive), sobre `messages.created_at`. */
  readonly since: Date;
  /** Fim da janela (exclusivo). Default: agora. */
  readonly until?: Date | undefined;
  /** Não mexe no que nasceu há menos que isto (job ainda a caminho). Default 10. */
  readonly minAgeMinutes?: number | undefined;
  /** Sobrescreve a janela de recuperação do provedor (dias). */
  readonly maxAgeDays?: number | undefined;
  /** Só lista; não grava nada nem tira nada da DLQ. */
  readonly dryRun: boolean;
  /** Ignora pedido de reprocessamento em voo. */
  readonly force?: boolean | undefined;
  /** Teto de mensagens avaliadas por execução. Default 5000. */
  readonly limit?: number | undefined;
  /** Lê a DLQ de mídia (precisa do RabbitMQ). Default `true`. */
  readonly includeDlq?: boolean | undefined;
  /** Teto de mensagens lidas da DLQ. Default 1000. */
  readonly dlqMax?: number | undefined;
  /** Relógio injetável (teste). */
  readonly now?: Date | undefined;
  /** Canal AMQP injetável (teste). Sem ele, abre uma conexão própria. */
  readonly mqChannel?: MqHandle['channel'] | undefined;
}

/** Destino de cada mensagem avaliada. */
export type ReprocessAction =
  | 'enqueued'
  | 'would_enqueue'
  | 'already_queued'
  | 'too_old'
  | 'terminal'
  | 'no_reference'
  | 'already_ingested';

export interface ReprocessItem {
  readonly messageId: string;
  readonly workspaceId: string;
  readonly provider: ChannelProvider | null;
  readonly createdAt: string;
  readonly source: 'message' | 'outbox' | 'dlq' | null;
  readonly action: ReprocessAction;
}

export interface ReprocessReport {
  readonly dryRun: boolean;
  readonly window: { readonly since: string; readonly until: string };
  readonly scanned: number;
  readonly counts: Readonly<Record<ReprocessAction, number>>;
  /** Quantas velhas demais, por provedor (o provedor já apagou o arquivo). */
  readonly tooOldByProvider: Readonly<Partial<Record<ChannelProvider, number>>>;
  readonly dlq: {
    readonly read: number;
    readonly media: number;
    /** Removidas da DLQ (reenfileiradas pela outbox ou já resolvidas). */
    readonly removed: number;
    /** Devolvidas à DLQ (não resolvidas por esta execução, ou de outras filas). */
    readonly returned: number;
    readonly unmatched: number;
  } | null;
  readonly items: readonly ReprocessItem[];
}

const failureSchema = z.object({ reason: z.string(), at: z.string().optional() }).passthrough();
const reprocessSchema = z.object({ requestedAt: z.string() }).passthrough();

interface CandidateRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly externalId: string;
  readonly createdAt: Date;
  readonly channelProvider: ChannelProvider | null;
  readonly job: unknown;
  readonly failure: unknown;
  readonly reprocess: unknown;
  readonly outboxJob: unknown;
}

const EMPTY_COUNTS: Record<ReprocessAction, number> = {
  enqueued: 0,
  would_enqueue: 0,
  already_queued: 0,
  too_old: 0,
  terminal: 0,
  no_reference: 0,
  already_ingested: 0,
};

function toDate(raw: unknown): Date {
  return raw instanceof Date ? raw : new Date(String(raw));
}

function parseJob(raw: unknown): MediaJob | null {
  const parsed = mediaJobSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseTime(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Há um reprocessamento pedido DEPOIS da última falha? Então já está a caminho.
 * Mesma regra da rota `retry-media` da API (`routes/conversations/messages.ts`).
 */
export function reprocessInFlight(failureRaw: unknown, reprocessRaw: unknown): boolean {
  const reprocess = reprocessSchema.safeParse(reprocessRaw);
  if (!reprocess.success) return false;
  const requestedAt = parseTime(reprocess.data.requestedAt);
  if (requestedAt === null) return false;
  const failure = failureSchema.safeParse(failureRaw);
  const failedAt = failure.success ? parseTime(failure.data.at) : null;
  return failedAt === null || failedAt < requestedAt;
}

function terminalReason(failureRaw: unknown): boolean {
  const failure = failureSchema.safeParse(failureRaw);
  return failure.success && TERMINAL_MEDIA_FAILURES.has(failure.data.reason as MediaFailureReason);
}

/** Candidatas (papel de conexão dos workers: leitura entre workspaces, como o resolver). */
async function loadCandidates(
  opts: ReprocessOptions,
  since: Date,
  until: Date,
  limit: number,
): Promise<CandidateRow[]> {
  const wsFilter =
    opts.workspaceId !== undefined ? sql`and m.workspace_id = ${opts.workspaceId}` : sql``;
  const outboxWsFilter =
    opts.workspaceId !== undefined ? sql`and o.workspace_id = ${opts.workspaceId}` : sql``;
  const rows = await getDb().execute(sql`
    with media_jobs as (
      select distinct on (o.workspace_id, o.envelope #>> '{payload,externalId}')
             o.workspace_id,
             o.envelope #>> '{payload,externalId}' as external_id,
             o.envelope -> 'payload' as job
        from outbox o
       where o.kind = 'job'
         and o.routing_key = ${QUEUES.media}
         and o.created_at >= ${since.toISOString()}::timestamptz - interval '1 day'
         ${outboxWsFilter}
       order by o.workspace_id, o.envelope #>> '{payload,externalId}', o.id desc
    )
    select m.id,
           m.workspace_id,
           m.external_id,
           m.created_at,
           ch.provider as channel_provider,
           m.metadata -> ${MEDIA_JOB_META}::text as job,
           m.metadata -> ${MEDIA_FAILURE_META}::text as failure,
           m.metadata -> ${MEDIA_REPROCESS_META}::text as reprocess,
           mj.job as outbox_job
      from messages m
      join conversations c on c.id = m.conversation_id
      left join channels ch on ch.id = c.channel_id
      left join media_jobs mj
             on mj.workspace_id = m.workspace_id and mj.external_id = m.external_id
     where m.direction = 'inbound'
       and m.deleted_at is null
       and m.external_id is not null
       and m.media_sha256 is null
       and m.media_status in ('pending', 'downloading', 'failed')
       and coalesce(m.metadata ->> 'mediaUnavailable', 'false') <> 'true'
       and m.created_at >= ${since.toISOString()}::timestamptz
       and m.created_at < ${until.toISOString()}::timestamptz
       ${wsFilter}
     order by m.created_at
     limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r['id']),
    workspaceId: String(r['workspace_id']),
    externalId: String(r['external_id']),
    createdAt: toDate(r['created_at']),
    channelProvider: (r['channel_provider'] ?? null) as ChannelProvider | null,
    job: r['job'],
    failure: r['failure'],
    reprocess: r['reprocess'],
    outboxJob: r['outbox_job'],
  }));
}

/**
 * Reenfileira UMA mensagem, sob RLS, com a trava da linha. Devolve o destino real
 * (pode divergir da leitura: outra execução ou o worker pode ter mexido no meio).
 */
async function enqueueOne(
  workspaceId: string,
  messageId: string,
  job: MediaJob,
  force: boolean,
  now: Date,
): Promise<'enqueued' | 'already_queued' | 'already_ingested'> {
  return withWorkspace(workspaceId, async (tx) => {
    const locked = await tx.execute(sql`
      select media_sha256,
             metadata -> ${MEDIA_FAILURE_META}::text as failure,
             metadata -> ${MEDIA_REPROCESS_META}::text as reprocess
        from messages
       where id = ${messageId}
         for update
    `);
    const row = locked[0];
    if (row === undefined || row['media_sha256'] !== null) return 'already_ingested';
    if (!force && reprocessInFlight(row['failure'], row['reprocess'])) return 'already_queued';

    const mark = { [MEDIA_REPROCESS_META]: { requestedAt: now.toISOString(), source: 'script' } };
    await tx.execute(sql`
      update messages
         set media_status = 'pending',
             metadata = metadata || ${JSON.stringify(mark)}::jsonb,
             updated_at = now()
       where id = ${messageId}
    `);
    await enqueueOutbox(tx, inboundMediaJobOutbox(workspaceId, job));
    return 'enqueued';
  });
}

interface Evaluation {
  readonly action: ReprocessAction;
  readonly source: ReprocessItem['source'];
  readonly provider: ChannelProvider | null;
  readonly job: MediaJob | null;
}

function evaluate(
  row: CandidateRow,
  dlqJob: MediaJob | null,
  opts: ReprocessOptions,
  now: Date,
): Evaluation {
  const fromMessage = parseJob(row.job);
  const fromOutbox = fromMessage === null ? parseJob(row.outboxJob) : null;
  const job = fromMessage ?? fromOutbox ?? dlqJob;
  const source: ReprocessItem['source'] =
    fromMessage !== null
      ? 'message'
      : fromOutbox !== null
        ? 'outbox'
        : dlqJob !== null
          ? 'dlq'
          : null;
  const provider = job?.provider ?? row.channelProvider;

  if (terminalReason(row.failure)) return { action: 'terminal', source, provider, job };
  if (!opts.force && reprocessInFlight(row.failure, row.reprocess)) {
    return { action: 'already_queued', source, provider, job };
  }
  if (provider !== null) {
    const days = opts.maxAgeDays ?? providerRecoveryWindowDays(provider);
    if (now.getTime() - row.createdAt.getTime() > days * 86_400_000) {
      return { action: 'too_old', source, provider, job };
    }
  }
  if (job === null) return { action: 'no_reference', source, provider, job };
  return { action: opts.dryRun ? 'would_enqueue' : 'enqueued', source, provider, job };
}

type MqChannel = MqHandle['channel'];
type GetMessage = Exclude<Awaited<ReturnType<MqChannel['get']>>, false>;

interface DlqEntry {
  readonly msg: GetMessage;
  readonly job: MediaJob | null;
}

/** Lê a DLQ segurando as mensagens (sem ack) até o fim — evita reler a mesma. */
async function drainDlq(channel: MqChannel, max: number): Promise<DlqEntry[]> {
  const out: DlqEntry[] = [];
  for (let i = 0; i < max; i += 1) {
    const msg = await channel.get(DLQ_QUEUE, { noAck: false });
    if (msg === false) break;
    const origin: unknown = msg.properties.headers?.[ORIGIN_QUEUE_HEADER];
    if (origin !== QUEUES.media) {
      out.push({ msg, job: null });
      continue;
    }
    let job: MediaJob | null = null;
    try {
      const envelope = envelopeSchema.parse(JSON.parse(msg.content.toString()));
      job = parseJob(envelope.payload);
    } catch {
      job = null;
    }
    out.push({ msg, job });
  }
  return out;
}

/** Mensagem da DLQ (pode estar fora da janela): busca pela `externalId`. */
async function findByExternalId(
  externalId: string,
  workspaceId: string | undefined,
): Promise<{ readonly row: CandidateRow; readonly ingested: boolean } | null> {
  const wsFilter = workspaceId !== undefined ? sql`and m.workspace_id = ${workspaceId}` : sql``;
  const rows = await getDb().execute(sql`
    select m.id, m.workspace_id, m.external_id, m.created_at, m.media_sha256,
           ch.provider as channel_provider,
           m.metadata -> ${MEDIA_FAILURE_META}::text as failure,
           m.metadata -> ${MEDIA_REPROCESS_META}::text as reprocess
      from messages m
      join conversations c on c.id = m.conversation_id
      left join channels ch on ch.id = c.channel_id
     where m.external_id = ${externalId}
       and m.direction = 'inbound'
       and m.deleted_at is null
       ${wsFilter}
     limit 1
  `);
  const r = rows[0];
  if (r === undefined) return null;
  return {
    row: {
      id: String(r['id']),
      workspaceId: String(r['workspace_id']),
      externalId: String(r['external_id']),
      createdAt: toDate(r['created_at']),
      channelProvider: (r['channel_provider'] ?? null) as ChannelProvider | null,
      job: null,
      failure: r['failure'],
      reprocess: r['reprocess'],
      outboxJob: null,
    },
    ingested: r['media_sha256'] !== null,
  };
}

/** Fecha o pool do banco (a linha de comando encerra limpa). */
export async function closeReprocessConnections(): Promise<void> {
  await closeDb();
}

/** Executa o reprocessamento e devolve o relatório. */
export async function reprocessMedia(opts: ReprocessOptions): Promise<ReprocessReport> {
  const now = opts.now ?? new Date();
  const minAgeMs = Math.max(0, opts.minAgeMinutes ?? 10) * 60_000;
  const requestedUntil = opts.until ?? now;
  const until = new Date(Math.min(requestedUntil.getTime(), now.getTime() - minAgeMs));
  const since = opts.since;
  const limit = Math.max(1, Math.trunc(opts.limit ?? 5_000));
  const force = opts.force ?? false;

  const counts: Record<ReprocessAction, number> = { ...EMPTY_COUNTS };
  const tooOldByProvider: Partial<Record<ChannelProvider, number>> = {};
  const items: ReprocessItem[] = [];
  const seen = new Set<string>();

  const record = (row: CandidateRow, ev: Evaluation, action: ReprocessAction): void => {
    counts[action] += 1;
    if (action === 'too_old' && ev.provider !== null) {
      tooOldByProvider[ev.provider] = (tooOldByProvider[ev.provider] ?? 0) + 1;
    }
    items.push({
      messageId: row.id,
      workspaceId: row.workspaceId,
      provider: ev.provider,
      createdAt: row.createdAt.toISOString(),
      source: ev.source,
      action,
    });
  };

  /** Avalia e (fora do dry-run) reenfileira; devolve o destino final. */
  const handle = async (row: CandidateRow, dlqJob: MediaJob | null): Promise<ReprocessAction> => {
    seen.add(row.id);
    const ev = evaluate(row, dlqJob, opts, now);
    let action = ev.action;
    if (action === 'enqueued' && ev.job !== null) {
      action = await enqueueOne(row.workspaceId, row.id, ev.job, force, now);
    }
    record(row, ev, action);
    return action;
  };

  // 1) DLQ de mídia primeiro: o job de lá é a referência mais fiel do que morreu.
  let dlqReport: ReprocessReport['dlq'] = null;
  if (opts.includeDlq ?? true) {
    const handleMq =
      opts.mqChannel === undefined ? await connectMq(undefined, { reconnect: false }) : null;
    const channel = opts.mqChannel ?? handleMq?.channel;
    if (channel === undefined) throw new Error('canal AMQP indisponível');
    const entries = await drainDlq(channel, Math.max(1, Math.trunc(opts.dlqMax ?? 1_000)));
    let removed = 0;
    let media = 0;
    let unmatched = 0;
    const toReturn: GetMessage[] = [];
    try {
      for (const entry of entries) {
        if (entry.job === null) {
          toReturn.push(entry.msg);
          continue;
        }
        media += 1;
        const found = await findByExternalId(entry.job.externalId, opts.workspaceId);
        if (found === null) {
          unmatched += 1;
          toReturn.push(entry.msg);
          continue;
        }
        let action: ReprocessAction;
        if (found.ingested) {
          // A mídia chegou por outro caminho: o job morto não tem mais o que fazer.
          action = 'already_ingested';
          seen.add(found.row.id);
          counts.already_ingested += 1;
        } else {
          action = await handle(found.row, entry.job);
        }
        const resolved =
          action === 'enqueued' || action === 'already_ingested' || action === 'already_queued';
        if (!opts.dryRun && resolved) {
          // Ack só depois do commit do reenfileiramento: queda no meio deixa a cópia na DLQ.
          channel.ack(entry.msg);
          removed += 1;
        } else {
          toReturn.push(entry.msg);
        }
      }
    } finally {
      for (const msg of toReturn) channel.nack(msg, false, true);
      if (handleMq !== null) await handleMq.close();
    }
    dlqReport = { read: entries.length, media, removed, returned: toReturn.length, unmatched };
  }

  // 2) Mensagens da janela.
  const candidates = await loadCandidates(opts, since, until, limit);
  for (const row of candidates) {
    if (seen.has(row.id)) continue;
    await handle(row, null);
  }

  return {
    dryRun: opts.dryRun,
    window: { since: since.toISOString(), until: until.toISOString() },
    scanned: seen.size,
    counts,
    tooOldByProvider,
    dlq: dlqReport,
    items,
  };
}
