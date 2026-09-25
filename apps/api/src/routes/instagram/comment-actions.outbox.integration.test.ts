/**
 * F70-S21 — ações de comentário do Instagram gravam o job na outbox, na transação da
 * escrita que o motiva (Postgres dev, RLS real):
 *  - resposta pública/privada: a mensagem `pending` e UM job `ig_*_reply`;
 *  - ocultar: `ig_comments.hidden` e UM job `ig_hide_comment`;
 *  - rollback forçado depois de todo o trabalho, antes do COMMIT: nem o dado nem o job;
 *  - comentário sem conversa associada: o `hidden` é gravado (como antes) e nenhum job.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type * as Db from '@hm/db';

const rollback = vi.hoisted(() => ({ armed: false }));
vi.mock('@hm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>();
  const { armableWithWorkspace } = await import('../deals/__tests__/forced-rollback');
  return { ...actual, withWorkspace: armableWithWorkspace(actual.withWorkspace, rollback) };
});
vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { closeDb, getDb, schema } = await import('@hm/db');
const { actAs, dropTenants, seedTenant } = await import('../deals/__tests__/two-workspaces');
const { outboxJobsOf } = await import('../conversations/__tests__/outbox-jobs');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createInstagramRouter } = await import('./index');

const app = express();
app.use(express.json());
app.use(createInstagramRouter());

const MEDIA = 'media-f70s21';
const IGSID = 'igsid-f70s21';

let A: TenantFixture;
let threadConversation = '';

/** Comentário novo (id externo único), opcionalmente de um autor sem conversa. */
async function seedComment(fromIgsid: string = IGSID): Promise<{ id: string; commentId: string }> {
  const commentId = `c-${randomUUID()}`;
  const [row] = await getDb()
    .insert(schema.igComments)
    .values({
      workspaceId: A.ws,
      channelId: A.channel,
      mediaId: MEDIA,
      commentId,
      fromIgsid,
      text: 'comentário',
    })
    .returning({ id: schema.igComments.id });
  if (!row) throw new Error('fixture: comentário');
  return { id: row.id, commentId };
}

async function hiddenOf(id: string): Promise<boolean | undefined> {
  const [row] = await getDb()
    .select({ hidden: schema.igComments.hidden })
    .from(schema.igComments)
    .where(eq(schema.igComments.id, id));
  return row?.hidden;
}

beforeAll(async () => {
  A = await seedTenant('A');
  const [conv] = await getDb()
    .insert(schema.conversations)
    .values({
      workspaceId: A.ws,
      channelId: A.channel,
      contactId: A.contact,
      remoteId: `cmt:${MEDIA}:${IGSID}`,
    })
    .returning({ id: schema.conversations.id });
  if (!conv) throw new Error('fixture: conversa do comentário');
  threadConversation = conv.id;
});

afterAll(async () => {
  rollback.armed = false;
  await dropTenants(A);
  await closeDb();
});

beforeEach(() => {
  rollback.armed = false;
  actAs(A);
});

describe.each([
  { mode: 'public', kind: 'ig_public_reply', type: 'comment_reply' },
  { mode: 'private', kind: 'ig_private_reply', type: 'text' },
] as const)('POST /api/instagram/comments/:id/reply ($mode) → outbox (F70-S21)', (c) => {
  it('commit: a mensagem pending e UM job com o shape do worker', async () => {
    const comment = await seedComment();
    const text = `f70s21-${c.mode}-${randomUUID()}`;
    const before = (await outboxJobsOf(A.ws)).length;

    const res = await request(app)
      .post(`/api/instagram/comments/${comment.commentId}/reply`)
      .send({ mode: c.mode, text });
    expect(res.status).toBe(202);
    const messageId: string = res.body.messageId;

    const [message] = await getDb()
      .select({ type: schema.messages.type, viewStatus: schema.messages.viewStatus })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId));
    expect(message).toEqual({ type: c.type, viewStatus: 'pending' });

    const jobs = await outboxJobsOf(A.ws);
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.find((j) => j.payload['messageId'] === messageId);
    expect(job).toMatchObject({ exchange: '', routingKey: 'hm.q.outbound', type: 'outbound.job' });
    expect(job?.payload).toEqual({
      kind: c.kind,
      channelId: A.channel,
      conversationId: threadConversation,
      messageId,
      commentId: comment.commentId,
      text,
    });
  });

  it('rollback: nem a mensagem nem o job ficam', async () => {
    const comment = await seedComment();
    const text = `f70s21-${c.mode}-rb-${randomUUID()}`;
    const before = (await outboxJobsOf(A.ws)).length;

    rollback.armed = true;
    const res = await request(app)
      .post(`/api/instagram/comments/${comment.commentId}/reply`)
      .send({ mode: c.mode, text });
    rollback.armed = false;
    expect(res.status).toBe(500);

    const rows = await getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(eq(schema.messages.workspaceId, A.ws), eq(schema.messages.content, text)));
    expect(rows).toHaveLength(0);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });
});

describe('POST /api/instagram/comments/:id/hide → outbox (F70-S21)', () => {
  it('commit: hidden gravado e UM job ig_hide_comment', async () => {
    const comment = await seedComment();
    const before = (await outboxJobsOf(A.ws)).length;

    const res = await request(app)
      .post(`/api/instagram/comments/${comment.commentId}/hide`)
      .send({ hide: true });
    expect(res.status).toBe(202);
    expect(await hiddenOf(comment.id)).toBe(true);

    const jobs = await outboxJobsOf(A.ws);
    expect(jobs).toHaveLength(before + 1);
    expect(jobs[jobs.length - 1]?.payload).toEqual({
      kind: 'ig_hide_comment',
      channelId: A.channel,
      conversationId: threadConversation,
      messageId: comment.id,
      commentId: comment.commentId,
      hide: true,
    });
  });

  it('rollback: o comentário segue visível e nenhum job fica', async () => {
    const comment = await seedComment();
    const before = (await outboxJobsOf(A.ws)).length;

    rollback.armed = true;
    const res = await request(app)
      .post(`/api/instagram/comments/${comment.commentId}/hide`)
      .send({ hide: true });
    rollback.armed = false;
    expect(res.status).toBe(500);

    expect(await hiddenOf(comment.id)).toBe(false);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });

  it('sem conversa associada: 409, hidden gravado e nenhum job', async () => {
    const comment = await seedComment(`orfao-${randomUUID()}`);
    const before = (await outboxJobsOf(A.ws)).length;

    const res = await request(app)
      .post(`/api/instagram/comments/${comment.commentId}/hide`)
      .send({ hide: true });
    expect(res.status).toBe(409);
    expect(await hiddenOf(comment.id)).toBe(true);
    expect(await outboxJobsOf(A.ws)).toHaveLength(before);
  });
});
