/**
 * F70-S27 — reprocessamento de mídia não ingerida, contra o Postgres dev (RLS real do
 * `withWorkspace`, outbox real) e um canal AMQP falso para a DLQ.
 *
 *  - `dryRun` lista e não grava nada;
 *  - a execução reenfileira UMA vez por mensagem pela outbox, com o workspace real;
 *    rodar de novo não duplica;
 *  - falha terminal do provedor, mídia velha demais e mensagem sem referência não
 *    são reenfileiradas — e o relatório diz quantas;
 *  - job morto na DLQ de mídia é reenfileirado e sai da DLQ; o que não é de mídia volta;
 *  - `DbMediaPersistence.markFailed` grava motivo + job, e o sucesso limpa os dois.
 *
 * Pula sem `DATABASE_URL`.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import {
  DLQ_QUEUE,
  ORIGIN_QUEUE_HEADER,
  QUEUES,
  makeEnvelope,
  type MqHandle,
} from '@hm/shared/mq';
import { outboxRowsOf } from '../outbox/testing';
import { DbMediaPersistence } from './adapters';
import { parseMediaJob, type MediaJob } from './job';
import { reprocessMedia } from './reprocess';

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const CONV = randomUUID();
const PN = `pn-f70s27-${CHANNEL.slice(0, 8)}`;
const NOW = new Date();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function jobFor(externalId: string): MediaJob {
  return {
    provider: 'meta_whatsapp',
    externalId,
    mediaRef: { refOrUrl: `media-${externalId}`, mimeType: 'audio/ogg' },
    routing: { phoneNumberId: PN },
  };
}

interface Seed {
  readonly externalId: string;
  readonly ageMs: number;
  readonly status: 'pending' | 'downloading' | 'failed' | 'ready';
  readonly metadata?: Record<string, unknown>;
  readonly sha?: string;
}

const ids = new Map<string, string>();

async function seed(s: Seed): Promise<string> {
  const [row] = await getDb()
    .insert(schema.messages)
    .values({
      workspaceId: WS,
      conversationId: CONV,
      externalId: s.externalId,
      direction: 'inbound',
      senderType: 'contact',
      type: 'audio',
      viewStatus: 'delivered',
      mediaStatus: s.status,
      mediaSha256: s.sha ?? null,
      metadata: s.metadata ?? {},
      createdAt: new Date(NOW.getTime() - s.ageMs),
    })
    .returning({ id: schema.messages.id });
  if (row === undefined) throw new Error('seed falhou');
  ids.set(s.externalId, row.id);
  return row.id;
}

async function mediaJobs(): Promise<MediaJob[]> {
  return (await outboxRowsOf(WS))
    .filter((r) => r.kind === 'job' && r.routingKey === QUEUES.media)
    .map((r) => parseMediaJob(r.envelope.payload));
}

async function messageRow(externalId: string) {
  const [row] = await getDb()
    .select({ status: schema.messages.mediaStatus, metadata: schema.messages.metadata })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, WS), eq(schema.messages.externalId, externalId)));
  return row;
}

const E = {
  failedStorage: `wamid.s27.storage.${randomUUID()}`,
  pendingOutbox: `wamid.s27.outbox.${randomUUID()}`,
  expired: `wamid.s27.expired.${randomUUID()}`,
  tooOld: `wamid.s27.old.${randomUUID()}`,
  noRef: `wamid.s27.noref.${randomUUID()}`,
  fresh: `wamid.s27.fresh.${randomUUID()}`,
  ingested: `wamid.s27.ok.${randomUUID()}`,
  dlq: `wamid.s27.dlq.${randomUUID()}`,
};

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db.insert(schema.workspaces).values({ id: WS, name: 'F70-S27', slug: `f70s27-${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70-S27',
    phoneNumberId: PN,
    wabaId: `waba-f70s27-${CHANNEL.slice(0, 8)}`,
  });
  await db.insert(schema.conversations).values({
    id: CONV,
    workspaceId: WS,
    channelId: CHANNEL,
    remoteId: '5511900002727',
  });

  const failure = (reason: string, at: Date) => ({ reason, code: 'AccessDenied', at: at.toISOString() });
  // Falhou por storage negado há 2h, com o job guardado pelo worker.
  await seed({
    externalId: E.failedStorage,
    ageMs: 2 * HOUR,
    status: 'failed',
    metadata: {
      mediaFailure: failure('storage_unavailable', new Date(NOW.getTime() - HOUR)),
      mediaJob: jobFor(E.failedStorage),
    },
  });
  // Pending desde ontem; o job só existe na outbox (nunca chegou ao worker novo).
  await seed({ externalId: E.pendingOutbox, ageMs: DAY, status: 'pending' });
  await withOutboxJob(E.pendingOutbox);
  // A Meta disse que expirou: terminal.
  await seed({
    externalId: E.expired,
    ageMs: 3 * HOUR,
    status: 'failed',
    metadata: { mediaFailure: failure('media_expired', NOW), mediaJob: jobFor(E.expired) },
  });
  // 40 dias: além da janela do WhatsApp.
  await seed({
    externalId: E.tooOld,
    ageMs: 40 * DAY,
    status: 'failed',
    metadata: { mediaFailure: failure('storage_unavailable', NOW), mediaJob: jobFor(E.tooOld) },
  });
  // Sem job em lugar nenhum.
  await seed({ externalId: E.noRef, ageMs: 5 * HOUR, status: 'pending' });
  // Recém-chegada: o job ainda está a caminho.
  await seed({ externalId: E.fresh, ageMs: 60_000, status: 'pending', metadata: { mediaJob: jobFor(E.fresh) } });
  // Já ingerida.
  await seed({ externalId: E.ingested, ageMs: 2 * HOUR, status: 'ready', sha: 'abc' });
  // Job morreu na DLQ; a mensagem ficou em downloading, sem metadata.
  await seed({ externalId: E.dlq, ageMs: 6 * HOUR, status: 'downloading' });
});

/** Um job de mídia já enviado, ainda retido na outbox. */
async function withOutboxJob(externalId: string): Promise<void> {
  const env = makeEnvelope('inbound.media.requested', WS, jobFor(externalId));
  await getDb().insert(schema.outbox).values({
    eventId: env.id,
    kind: 'job',
    workspaceId: WS,
    exchange: '',
    routingKey: QUEUES.media,
    envelope: { ...env },
    status: 'sent',
    sentAt: new Date(),
  });
}

afterAll(async () => {
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

type MqChannel = MqHandle['channel'];

/** DLQ falsa: uma mensagem de mídia e uma de outra fila. */
function fakeDlq() {
  const media = {
    content: Buffer.from(JSON.stringify(makeEnvelope('inbound.media.requested', WS, jobFor(E.dlq)))),
    fields: {},
    properties: { headers: { [ORIGIN_QUEUE_HEADER]: QUEUES.media }, contentType: 'application/json' },
  };
  const other = {
    content: Buffer.from('{}'),
    fields: {},
    properties: { headers: { [ORIGIN_QUEUE_HEADER]: QUEUES.outbound } },
  };
  let queue: unknown[] = [media, other];
  const ack = vi.fn((m: unknown) => {
    queue = queue.filter((x) => x !== m);
  });
  const nack = vi.fn();
  let cursor = 0;
  const get = vi.fn(async (q: string) => {
    expect(q).toBe(DLQ_QUEUE);
    const next = queue[cursor];
    cursor += 1;
    return next ?? false;
  });
  const reset = (): void => {
    cursor = 0;
  };
  return { ch: { get, ack, nack } as unknown as MqChannel, ack, nack, reset, media, other };
}

describe.skipIf(!ready)('reprocessMedia (F70-S27)', () => {
  const since = new Date(NOW.getTime() - 60 * DAY);

  it('dry-run lista o que faria e não grava nada', async () => {
    const dlq = fakeDlq();
    const report = await reprocessMedia({
      workspaceId: WS,
      since,
      now: NOW,
      dryRun: true,
      mqChannel: dlq.ch,
    });

    const byId = new Map(report.items.map((i) => [i.messageId, i]));
    expect(byId.get(ids.get(E.failedStorage) ?? '')).toMatchObject({ action: 'would_enqueue', source: 'message' });
    expect(byId.get(ids.get(E.pendingOutbox) ?? '')).toMatchObject({ action: 'would_enqueue', source: 'outbox' });
    expect(byId.get(ids.get(E.dlq) ?? '')).toMatchObject({ action: 'would_enqueue', source: 'dlq' });
    expect(byId.get(ids.get(E.expired) ?? '')?.action).toBe('terminal');
    expect(byId.get(ids.get(E.tooOld) ?? '')?.action).toBe('too_old');
    expect(byId.get(ids.get(E.noRef) ?? '')?.action).toBe('no_reference');
    expect(byId.has(ids.get(E.fresh) ?? '')).toBe(false);
    expect(byId.has(ids.get(E.ingested) ?? '')).toBe(false);
    expect(report.counts.would_enqueue).toBe(3);
    expect(report.tooOldByProvider).toEqual({ meta_whatsapp: 1 });

    // Nada gravado; a DLQ foi devolvida inteira.
    expect(await mediaJobs()).toHaveLength(1); // só o job pré-existente da outbox
    expect(dlq.ack).not.toHaveBeenCalled();
    expect(dlq.nack).toHaveBeenCalledTimes(2);
    expect((await messageRow(E.failedStorage))?.status).toBe('failed');
  });

  it('execução reenfileira uma vez por mensagem, com o workspace real; rodar de novo não duplica', async () => {
    const dlq = fakeDlq();
    const first = await reprocessMedia({ workspaceId: WS, since, now: NOW, dryRun: false, mqChannel: dlq.ch });
    expect(first.counts.enqueued).toBe(3);
    expect(first.dlq).toMatchObject({ read: 2, media: 1, removed: 1, returned: 1 });
    expect(dlq.ack).toHaveBeenCalledWith(dlq.media);
    expect(dlq.nack).toHaveBeenCalledWith(dlq.other, false, true);

    const rows = (await outboxRowsOf(WS)).filter((r) => r.routingKey === QUEUES.media);
    const fresh = rows.filter((r) => r.status === 'pending');
    expect(fresh).toHaveLength(3);
    for (const r of fresh) expect(r.envelope.workspaceId).toBe(WS);
    expect(fresh.map((r) => parseMediaJob(r.envelope.payload).externalId).sort()).toEqual(
      [E.failedStorage, E.pendingOutbox, E.dlq].sort(),
    );

    const after = await messageRow(E.failedStorage);
    expect(after?.status).toBe('pending');
    expect(after?.metadata['mediaReprocess']).toMatchObject({ source: 'script' });

    // Segunda execução: tudo já a caminho — nenhum job novo.
    const again = await reprocessMedia({
      workspaceId: WS,
      since,
      now: new Date(NOW.getTime() + 1_000),
      dryRun: false,
      includeDlq: false,
    });
    expect(again.counts.enqueued).toBe(0);
    expect(again.counts.already_queued).toBe(3);
    expect((await outboxRowsOf(WS)).filter((r) => r.status === 'pending')).toHaveLength(3);
  });

  it('falha nova depois do reprocesso torna a mensagem candidata de novo', async () => {
    const later = new Date(NOW.getTime() + 60_000);
    await new DbMediaPersistence().markFailed({
      workspaceId: WS,
      messageId: ids.get(E.failedStorage) ?? '',
      reason: 'storage_unavailable',
      code: 'AccessDenied',
      job: jobFor(E.failedStorage),
    });
    const report = await reprocessMedia({
      workspaceId: WS,
      since,
      now: new Date(later.getTime() + 60_000),
      dryRun: false,
      includeDlq: false,
    });
    expect(report.counts.enqueued).toBe(1);
  });
});

describe.skipIf(!ready)('DbMediaPersistence — falha registrada e limpa (F70-S27)', () => {
  it('markFailed grava motivo e job; update de sucesso limpa os dois', async () => {
    const externalId = `wamid.s27.persist.${randomUUID()}`;
    const messageId = await seed({ externalId, ageMs: HOUR, status: 'downloading' });
    const persistence = new DbMediaPersistence();

    await persistence.markFailed({
      workspaceId: WS,
      messageId,
      reason: 'storage_unavailable',
      code: 'AccessDenied',
      job: jobFor(externalId),
    });
    const failed = await messageRow(externalId);
    expect(failed?.status).toBe('failed');
    expect(failed?.metadata['mediaFailure']).toMatchObject({ reason: 'storage_unavailable', code: 'AccessDenied' });
    expect(failed?.metadata['mediaJob']).toEqual(jobFor(externalId));
    expect((await persistence.findMessage(WS, externalId))?.currentFailureReason).toBe('storage_unavailable');

    await persistence.update({
      workspaceId: WS,
      messageId,
      mediaUrl: 'https://cdn.test/x',
      mediaMime: 'audio/ogg',
      mediaSizeBytes: 10,
      mediaSha256: `sha-${externalId}`,
      mediaKey: `${WS}/x.ogg`,
      mediaStatus: 'ready',
    });
    const ok = await messageRow(externalId);
    expect(ok?.status).toBe('ready');
    expect(ok?.metadata['mediaFailure']).toBeUndefined();
    expect(ok?.metadata['mediaJob']).toBeUndefined();
    expect(ok?.metadata['mediaKey']).toBe(`${WS}/x.ogg`);

    // Falha atrasada não rebaixa mídia pronta.
    await persistence.markFailed({
      workspaceId: WS,
      messageId,
      reason: 'storage_error',
      job: jobFor(externalId),
    });
    expect((await messageRow(externalId))?.status).toBe('ready');
  });
});
