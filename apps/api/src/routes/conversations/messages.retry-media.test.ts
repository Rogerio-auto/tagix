/**
 * F70-S27 — "Tentar de novo" da mídia recebida que falhou
 * (`POST /api/conversations/:id/messages/:messageId/retry-media`), contra o Postgres dev
 * (RLS real, outbox real):
 *  - falha recuperável com o job guardado: 202, status volta a `pending` e UM job em
 *    `hm.q.media` com o workspace real; o segundo clique não duplica;
 *  - falha terminal (mídia expirada na Meta): 409, nenhum job;
 *  - sem job guardado: 409 `no_reference`;
 *  - READONLY não pode (403); conversa de outro workspace: 404.
 * Mais a regra pura `decideMediaRetry`.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type * as Mq from '@hm/shared/mq';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);
vi.mock('@hm/shared/mq', async (importOriginal) => ({
  ...(await importOriginal<typeof Mq>()),
  connectMq: vi.fn(async () => ({ channel: { sendToQueue: vi.fn() }, connection: {} })),
}));

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxJobsOf } = await import('./__tests__/outbox-jobs');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createMessagesRouter, decideMediaRetry } = await import('./messages');

const ready = Boolean(process.env['DATABASE_URL']);
const app = express();
app.use(express.json());
app.use(createMessagesRouter());

let A: TenantFixture;
let B: TenantFixture;

function jobFor(externalId: string) {
  return {
    provider: 'meta_whatsapp',
    externalId,
    mediaRef: { refOrUrl: `media-${externalId}`, mimeType: 'image/jpeg' },
    routing: { phoneNumberId: 'pn-s27' },
  };
}

async function seedMessage(
  t: TenantFixture,
  metadata: Record<string, unknown>,
  status: 'failed' | 'pending' = 'failed',
): Promise<string> {
  const [row] = await getDb()
    .insert(schema.messages)
    .values({
      workspaceId: t.ws,
      conversationId: t.conversation,
      externalId: `wamid.s27.api.${randomUUID()}`,
      direction: 'inbound',
      senderType: 'contact',
      type: 'image',
      viewStatus: 'delivered',
      mediaStatus: status,
      metadata,
      createdAt: new Date(Date.now() - 60 * 60_000),
    })
    .returning({ id: schema.messages.id });
  if (!row) throw new Error('fixture: mensagem');
  return row.id;
}

function retry(t: TenantFixture, messageId: string) {
  return request(app)
    .post(`/api/conversations/${t.conversation}/messages/${messageId}/retry-media`)
    .send();
}

async function mediaJobs(ws: string) {
  return (await outboxJobsOf(ws)).filter((j) => j.routingKey === 'hm.q.media');
}

beforeAll(async () => {
  if (!ready) return;
  A = await seedTenant('A');
  B = await seedTenant('B');
});

afterAll(async () => {
  if (ready) await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => {
  if (ready) actAs(A);
});

describe.skipIf(!ready)('POST …/retry-media (F70-S27)', () => {
  it('falha recuperável: 202, pending e UM job de mídia com o workspace real; 2º clique não duplica', async () => {
    const externalId = `wamid.s27.ok.${randomUUID()}`;
    const failure = {
      reason: 'storage_unavailable',
      code: 'AccessDenied',
      at: new Date(Date.now() - 60_000).toISOString(),
    };
    const id = await seedMessage(A, { mediaFailure: failure, mediaJob: jobFor(externalId) });
    const before = (await mediaJobs(A.ws)).length;

    const first = await retry(A, id);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ status: 'queued' });

    const jobs = await mediaJobs(A.ws);
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.at(-1);
    expect(job).toMatchObject({
      exchange: '',
      type: 'inbound.media.requested',
      envelopeWorkspaceId: A.ws,
    });
    expect(job?.payload).toEqual(jobFor(externalId));

    const [row] = await getDb()
      .select({ status: schema.messages.mediaStatus, metadata: schema.messages.metadata })
      .from(schema.messages)
      .where(eq(schema.messages.id, id));
    expect(row?.status).toBe('pending');
    expect(row?.metadata['mediaReprocess']).toMatchObject({ source: 'member' });

    const second = await retry(A, id);
    expect(second.status).toBe(202);
    expect(second.body).toEqual({ status: 'already_queued' });
    expect(await mediaJobs(A.ws)).toHaveLength(before + 1);
  });

  it('mídia expirada na Meta: 409 terminal, nenhum job', async () => {
    const id = await seedMessage(A, {
      mediaFailure: { reason: 'media_expired', at: new Date().toISOString() },
      mediaJob: jobFor(`wamid.${randomUUID()}`),
    });
    const before = (await mediaJobs(A.ws)).length;
    const res = await retry(A, id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('terminal');
    expect(await mediaJobs(A.ws)).toHaveLength(before);
  });

  it('sem job guardado: 409 no_reference', async () => {
    const id = await seedMessage(A, {}, 'pending');
    const res = await retry(A, id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_reference');
  });

  it('READONLY não pode tentar de novo (403)', async () => {
    const id = await seedMessage(A, {
      mediaFailure: { reason: 'storage_error', at: new Date().toISOString() },
      mediaJob: jobFor(`wamid.${randomUUID()}`),
    });
    actAs(A, 'READONLY');
    const res = await retry(A, id);
    expect(res.status).toBe(403);
  });

  it('mensagem de outro workspace: 404, nenhum job', async () => {
    const id = await seedMessage(B, {
      mediaFailure: { reason: 'storage_error', at: new Date().toISOString() },
      mediaJob: jobFor(`wamid.${randomUUID()}`),
    });
    const res = await request(app)
      .post(`/api/conversations/${B.conversation}/messages/${id}/retry-media`)
      .send();
    expect(res.status).toBe(404);
    expect(await mediaJobs(B.ws)).toHaveLength(0);
  });
});

describe('decideMediaRetry', () => {
  const base = {
    direction: 'inbound',
    mediaStatus: 'failed',
    mediaSha256: null,
    createdAt: new Date('2026-09-25T10:00:00Z'),
    now: new Date('2026-09-25T12:00:00Z'),
  };
  const job = jobFor('wamid.x');

  it('pendente recente ainda está carregando', () => {
    expect(
      decideMediaRetry({
        ...base,
        mediaStatus: 'pending',
        metadata: {},
        createdAt: new Date('2026-09-25T11:59:30Z'),
      }).kind,
    ).toBe('in_progress');
  });

  it('já pronta / outbound não retentam', () => {
    expect(decideMediaRetry({ ...base, mediaSha256: 'abc', metadata: {} }).kind).toBe(
      'already_ready',
    );
    expect(decideMediaRetry({ ...base, direction: 'outbound', metadata: {} }).kind).toBe(
      'not_retryable',
    );
  });

  it('pedido em voo depois da última falha segura por 10 minutos, e libera depois', () => {
    const metadata = {
      mediaJob: job,
      mediaFailure: { reason: 'storage_unavailable', at: '2026-09-25T11:00:00Z' },
      mediaReprocess: { requestedAt: '2026-09-25T11:55:00Z' },
    };
    expect(decideMediaRetry({ ...base, metadata }).kind).toBe('already_queued');
    expect(
      decideMediaRetry({ ...base, metadata, now: new Date('2026-09-25T12:10:00Z') }).kind,
    ).toBe('retry');
  });

  it('falha nova depois do pedido libera na hora', () => {
    const metadata = {
      mediaJob: job,
      mediaFailure: { reason: 'storage_error', at: '2026-09-25T11:58:00Z' },
      mediaReprocess: { requestedAt: '2026-09-25T11:55:00Z' },
    };
    expect(decideMediaRetry({ ...base, metadata }).kind).toBe('retry');
  });

  it('job malformado não é reenfileirado', () => {
    expect(decideMediaRetry({ ...base, metadata: { mediaJob: { provider: 'x' } } }).kind).toBe(
      'no_reference',
    );
  });
});
