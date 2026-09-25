/**
 * F70-S17/S20 — API pública v1 grava na outbox, na transação do dado (Postgres dev,
 * RLS real):
 *  - `POST /api/v1/deals/:id/move` → `deal.stage_changed` (autor `api`);
 *  - `POST /api/v1/conversions` → `conversion.registered`;
 *  - `send_message`, `send_template`, `messages/media` → o job de envio em
 *    `hm.q.outbound` (F70-S20), na transação da mensagem `pending`.
 *
 * Por produtor: commit → uma linha com o `event_id` canônico; rollback forçado depois
 * de todo o trabalho, antes do COMMIT → nenhuma linha.
 *
 * A chave de API é mockada (sem Redis do rate limit): o tenant vem de
 * `req.apiAuth.workspaceId`, exatamente o que o middleware real injeta.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type * as Db from '@hm/db';

const { keyWorkspace, rollback } = vi.hoisted(() => ({
  keyWorkspace: { id: '' },
  rollback: { armed: false },
}));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/api-key', () => ({
  requireApiKey: (req: Request, _res: Response, next: NextFunction) => {
    req.apiAuth = { workspaceId: keyWorkspace.id } as Request['apiAuth'];
    next();
  },
  requireScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  closeApiKeyRateLimiter: async () => {},
}));

const { closeDb, getDb, schema } = await import('@hm/db');
const { dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxEventsNamed } = await import('../deals/__tests__/outbox');
const { envelopeSchema } = await import('@hm/shared/mq');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createV1Router } = await import('./index');

const app = express();
app.use(express.json());
app.use(createV1Router());

let A: TenantFixture;
let stage2 = '';

beforeAll(async () => {
  A = await seedTenant('A');
  const [row] = await getDb()
    .insert(schema.stages)
    .values({ workspaceId: A.ws, pipelineId: A.pipeline, name: 'Proposta', position: 1 })
    .returning({ id: schema.stages.id });
  if (!row) throw new Error('fixture: estágio 2 não criado');
  stage2 = row.id;
});

afterAll(async () => {
  rollback.armed = false;
  await dropTenants(A);
  await closeDb();
});

beforeEach(() => {
  rollback.armed = false;
  keyWorkspace.id = A.ws;
});

async function freshDeal(): Promise<string> {
  const [row] = await getDb()
    .insert(schema.deals)
    .values({
      workspaceId: A.ws,
      pipelineId: A.pipeline,
      stageId: A.stage,
      contactId: A.contact,
      title: 'Deal v1 F70-S17',
    })
    .returning({ id: schema.deals.id });
  if (!row) throw new Error('fixture: deal não criado');
  return row.id;
}

async function stageChangedOf(dealId: string) {
  return (await outboxEventsNamed(A.ws, 'deal.stage_changed')).filter(
    (r) => r.data['dealId'] === dealId,
  );
}

describe('POST /api/v1/deals/:id/move → deal.stage_changed na outbox (F70-S17)', () => {
  it('commit: uma linha com a ocorrência do movimento e autor api', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: stage2 });
    expect(res.status).toBe(200);

    const rows = await stageChangedOf(dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toMatch(
      new RegExp(
        `^${dealId}:stage_changed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ),
    );
    expect(rows[0]).toMatchObject({ kind: 'event', routingKey: 'domain.deal.stage_changed' });
    expect(rows[0]?.data).toMatchObject({
      fromStageId: A.stage,
      toStageId: stage2,
      actorType: 'api',
    });
  });

  it('mesmo estágio é no-op: nenhuma linha', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: A.stage });
    expect(res.status).toBe(200);
    expect(await stageChangedOf(dealId)).toHaveLength(0);
  });

  it('rollback: o deal não se move e nada fica na outbox', async () => {
    const dealId = await freshDeal();
    rollback.armed = true;
    const res = await request(app).post(`/api/v1/deals/${dealId}/move`).send({ stageId: stage2 });
    expect(res.status).toBe(500);
    rollback.armed = false;

    const [deal] = await getDb()
      .select({ stageId: schema.deals.stageId })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect(deal?.stageId).toBe(A.stage);
    expect(await stageChangedOf(dealId)).toHaveLength(0);
  });
});

describe('POST /api/v1/conversions → conversion.registered na outbox (F70-S17)', () => {
  // Ordem importa: o rollback roda antes do commit (o dedup é por contato+tipo+dia).
  it('rollback: nem a conversão nem o evento ficam', async () => {
    rollback.armed = true;
    const res = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(res.status).toBe(500);
    rollback.armed = false;

    const rows = await getDb()
      .select({ id: schema.conversionEvents.id })
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.workspaceId, A.ws));
    expect(rows).toHaveLength(0);
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(0);
  });

  it('commit: uma linha com o event_id canônico; o dedup do dia não grava outra', async () => {
    const res = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(res.status).toBe(201);
    const conversionId: string = res.body.conversion.id;

    const rows = await outboxEventsNamed(A.ws, 'conversion.registered');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: `${conversionId}:registered`,
      exchange: 'hm.events',
      routingKey: 'domain.conversion.registered',
    });
    expect(rows[0]?.data).toMatchObject({ conversionId, source: 'api' });

    const dup = await request(app)
      .post('/api/v1/conversions')
      .send({ conversionTypeKey: A.conversionTypeKey, contactId: A.contact });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('deduped');
    expect(await outboxEventsNamed(A.ws, 'conversion.registered')).toHaveLength(1);
  });
});

// ─── F70-S20: envios da API v1 pela outbox ────────────────────────────────────

interface OutboxJobRow {
  readonly eventId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly type: string;
  readonly envelopeId: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Jobs da outbox do workspace A, lidos por OUTRA conexão (a do processo): uma linha
 * visível aqui está commitada.
 */
async function outboxJobs(): Promise<OutboxJobRow[]> {
  const { outbox } = schema;
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(and(eq(outbox.workspaceId, A.ws), eq(outbox.kind, 'job')))
    .orderBy(asc(outbox.id));
  return rows.map((r) => {
    const envelope = envelopeSchema.parse(r.envelope);
    return {
      eventId: r.eventId,
      exchange: r.exchange,
      routingKey: r.routingKey,
      type: envelope.type,
      envelopeId: envelope.id,
      payload: envelope.payload as Record<string, unknown>,
    };
  });
}

async function conversationTarget(): Promise<{ channelId: string; remoteId: string }> {
  const [row] = await getDb()
    .select({
      channelId: schema.conversations.channelId,
      remoteId: schema.conversations.remoteId,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, A.conversation));
  if (!row) throw new Error('fixture: conversa não encontrada');
  return row;
}

interface SendCase {
  readonly name: string;
  readonly path: string;
  /** Corpo com um marcador único (acha a mensagem e o job mesmo sem o id do 500). */
  readonly body: (marker: string) => Record<string, unknown>;
  /** Campos do job que dependem do endpoint. */
  readonly job: (marker: string) => Record<string, unknown>;
  /** Coluna da mensagem que carrega o marcador. */
  readonly markerColumn: 'content' | 'mediaUrl';
}

const SEND_CASES: readonly SendCase[] = [
  {
    name: 'send_message',
    path: '/api/v1/send_message',
    body: (m) => ({ conversationId: A.conversation, text: m }),
    job: (m) => ({ kind: 'text', text: m }),
    markerColumn: 'content',
  },
  {
    name: 'send_template',
    path: '/api/v1/send_template',
    body: (m) => ({
      conversationId: A.conversation,
      templateName: m,
      languageCode: 'pt_BR',
      components: [],
    }),
    job: (m) => ({ kind: 'template', templateName: m, languageCode: 'pt_BR', components: [] }),
    markerColumn: 'content',
  },
  {
    name: 'send_media',
    path: '/api/v1/messages/media',
    body: (m) => ({
      conversationId: A.conversation,
      mediaKind: 'image',
      mediaUrl: `https://cdn.test/${m}.png`,
      mime: 'image/png',
      caption: 'foto',
    }),
    job: (m) => ({
      kind: 'media',
      mediaKind: 'image',
      publicMediaUrl: `https://cdn.test/${m}.png`,
      mime: 'image/png',
      caption: 'foto',
    }),
    markerColumn: 'mediaUrl',
  },
];

async function messagesMarked(c: SendCase, marker: string) {
  const col = c.markerColumn === 'content' ? schema.messages.content : schema.messages.mediaUrl;
  const value = c.markerColumn === 'content' ? marker : `https://cdn.test/${marker}.png`;
  return getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.workspaceId, A.ws), eq(col, value)));
}

describe.each(SEND_CASES)('POST $path → job de envio na outbox (F70-S20)', (c) => {
  it('commit: a mensagem pending e UM job em hm.q.outbound, com o shape do worker', async () => {
    const marker = `f70s20-${c.name}-${randomUUID()}`;
    const before = (await outboxJobs()).length;

    const res = await request(app).post(c.path).send(c.body(marker));
    expect(res.status).toBe(201);
    const messageId: string = res.body.message.id;
    expect(res.body.message.viewStatus).toBe('pending');

    const jobs = await outboxJobs();
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.find((j) => j.payload['messageId'] === messageId);
    expect(job).toBeDefined();
    const target = await conversationTarget();
    expect(job).toMatchObject({
      exchange: '',
      routingKey: 'hm.q.outbound',
      type: 'outbound.job',
    });
    // Chave de idempotência da outbox = id do envelope (queueJobOutbox).
    expect(job?.eventId).toBe(job?.envelopeId);
    expect(job?.payload).toEqual({
      channelId: target.channelId,
      conversationId: A.conversation,
      messageId,
      chatId: target.remoteId,
      ...c.job(marker),
    });
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const marker = `f70s20-${c.name}-rb-${randomUUID()}`;
    const before = (await outboxJobs()).length;

    rollback.armed = true;
    const res = await request(app).post(c.path).send(c.body(marker));
    expect(res.status).toBe(500);
    rollback.armed = false;

    expect(await messagesMarked(c, marker)).toHaveLength(0);
    expect(await outboxJobs()).toHaveLength(before);
  });

  it('conversa fora do workspace da chave: 404 e nenhum job', async () => {
    const before = (await outboxJobs()).length;
    const res = await request(app)
      .post(c.path)
      .send({ ...c.body(`f70s20-404-${randomUUID()}`), conversationId: randomUUID() });
    expect(res.status).toBe(404);
    expect(await outboxJobs()).toHaveLength(before);
  });
});
