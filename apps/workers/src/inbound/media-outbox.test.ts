/**
 * F70-S21 — o job de download da mídia recebida entra na outbox na transação que insere
 * a mensagem (`DbInboundPersistence.persist`, Postgres dev, RLS real do `withWorkspace`):
 *  - commit: a mensagem nasce `media_status = pending` e UM job em `hm.q.media`, no
 *    shape de `parseMediaJob`, com o workspace real no envelope;
 *  - mensagem sem mídia: nenhum job;
 *  - reentrega do mesmo envelope (dedup da mensagem): nenhum job novo;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem a mensagem nem o
 *    job ficam.
 *
 * A outbox é lida por outra conexão (`../outbox/testing`): linha visível = commitada.
 * Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Db from '@hm/db';
import type { InboundEvent } from '@hm/channels';
import { createLogger } from '@hm/logger';
import type { InboundSocketPort } from './db-ports';
import type { StatusDeps } from './status';
import type { PersistInboundRequest } from './ports';

const FORCED = 'F70-S21: rollback forçado pelo teste';
const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const withWorkspace: typeof actual.withWorkspace = (workspaceId, fn) =>
    actual.withWorkspace(workspaceId, async (tx) => {
      const out = await fn(tx);
      if (rollback.armed) throw new Error(FORCED);
      return out;
    });
  return { ...actual, withWorkspace };
});

const { closeDb, getDb, schema } = await import('@hm/db');
const { outboxRowsOf } = await import('../outbox/testing');
const { DbInboundPersistence } = await import('./db-ports');
const { INBOUND_MEDIA_TYPE } = await import('./mq-ports');
const { parseMediaJob } = await import('../media/job');

const ready = Boolean(process.env['DATABASE_URL']);
const WS = randomUUID();
const CHANNEL = randomUUID();
const PHONE_NUMBER_ID = `pn-f70s21-${CHANNEL.slice(0, 8)}`;
const REMOTE = '5511966665555';

const noopSocket: InboundSocketPort = {
  async emitMessageNew() {},
  async emitContactPresence() {},
  async emitConversationAssigned() {},
};
const noopStatusDeps: StatusDeps = {
  channels: {
    async resolve() {
      return null;
    },
  },
  persistence: {
    async applyStatus() {
      return { outcome: 'not_found' as const };
    },
  },
  socket: { async emitStatusChanged() {} },
  orphan: {
    async record() {},
    async drain() {
      return null;
    },
  },
};

const persistence = new DbInboundPersistence(
  noopSocket,
  noopStatusDeps,
  createLogger('error'),
  { resolve: async () => ({ channelId: CHANNEL, workspaceId: WS }) },
);

function request(events: InboundEvent[]): PersistInboundRequest {
  return { provider: 'meta_whatsapp', routing: { phoneNumberId: PHONE_NUMBER_ID }, events };
}

function imageEvent(externalId: string): InboundEvent {
  return {
    type: 'message',
    provider: 'meta_whatsapp',
    contactRemoteId: REMOTE,
    externalId,
    messageType: 'image',
    mediaRef: { refOrUrl: `media-${externalId}`, mimeType: 'image/jpeg' },
    rawTimestamp: new Date().toISOString(),
  };
}

function textEvent(externalId: string): InboundEvent {
  return {
    type: 'message',
    provider: 'meta_whatsapp',
    contactRemoteId: REMOTE,
    externalId,
    messageType: 'text',
    content: 'oi',
    rawTimestamp: new Date().toISOString(),
  };
}

async function mediaJobsFor(externalId: string) {
  return (await outboxRowsOf(WS)).filter(
    (r) =>
      r.kind === 'job' &&
      (r.envelope.payload as Record<string, unknown>)['externalId'] === externalId,
  );
}

async function messageOf(externalId: string) {
  const [row] = await getDb()
    .select({ id: schema.messages.id, mediaStatus: schema.messages.mediaStatus })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, WS), eq(schema.messages.externalId, externalId)));
  return row;
}

beforeAll(async () => {
  if (!ready) return;
  const db = getDb();
  await db
    .insert(schema.workspaces)
    .values({ id: WS, name: 'F70-S21 inbound', slug: `f70s21-in-${WS.slice(0, 8)}` });
  await db.insert(schema.channels).values({
    id: CHANNEL,
    workspaceId: WS,
    provider: 'meta_whatsapp',
    name: 'WA F70-S21 inbound',
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: `waba-f70s21-${CHANNEL.slice(0, 8)}`,
  });
});

afterEach(() => {
  rollback.armed = false;
});

afterAll(async () => {
  rollback.armed = false;
  if (ready) await getDb().delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await closeDb();
});

describe.skipIf(!ready)('inbound → job de mídia na outbox (F70-S21)', () => {
  it('commit: mensagem pending e UM job em hm.q.media, com o workspace real', async () => {
    const externalId = `wamid.f70s21.${randomUUID()}`;
    const result = await persistence.persist(request([imageEvent(externalId)]));
    expect(result).toMatchObject({ inserted: 1, mediaJobs: 1 });

    expect((await messageOf(externalId))?.mediaStatus).toBe('pending');
    const jobs = await mediaJobsFor(externalId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'job', exchange: '', routingKey: 'hm.q.media' });
    expect(jobs[0]?.eventId).toBe(jobs[0]?.envelope.id);
    expect(jobs[0]?.envelope).toMatchObject({ type: INBOUND_MEDIA_TYPE, workspaceId: WS });
    expect(parseMediaJob(jobs[0]?.envelope.payload)).toEqual({
      provider: 'meta_whatsapp',
      externalId,
      mediaRef: { refOrUrl: `media-${externalId}`, mimeType: 'image/jpeg' },
      routing: { phoneNumberId: PHONE_NUMBER_ID },
    });
  });

  it('mensagem sem mídia: nenhum job', async () => {
    const externalId = `wamid.f70s21.txt.${randomUUID()}`;
    const result = await persistence.persist(request([textEvent(externalId)]));
    expect(result).toMatchObject({ inserted: 1, mediaJobs: 0 });
    expect(await mediaJobsFor(externalId)).toHaveLength(0);
  });

  it('reentrega do mesmo envelope: a mensagem é deduplicada e nenhum job novo entra', async () => {
    const externalId = `wamid.f70s21.dup.${randomUUID()}`;
    await persistence.persist(request([imageEvent(externalId)]));
    const again = await persistence.persist(request([imageEvent(externalId)]));
    expect(again).toMatchObject({ inserted: 0, deduped: 1, mediaJobs: 0 });
    expect(await mediaJobsFor(externalId)).toHaveLength(1);
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const externalId = `wamid.f70s21.rb.${randomUUID()}`;
    rollback.armed = true;
    await expect(persistence.persist(request([imageEvent(externalId)]))).rejects.toThrow(FORCED);
    rollback.armed = false;

    expect(await messageOf(externalId)).toBeUndefined();
    expect(await mediaJobsFor(externalId)).toHaveLength(0);
  });
});
