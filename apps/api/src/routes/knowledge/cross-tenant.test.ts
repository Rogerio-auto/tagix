/**
 * F70-S11 — `POST /api/knowledge/feedback` recusa chunk, agente e conversa de outro
 * workspace, e chunk de outro documento do próprio workspace.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema } from '@hm/db';

vi.mock('../../middlewares/auth', async () =>
  (await import('../deals/__tests__/two-workspaces')).authMiddlewareMock(),
);

const { actAs, dropTenants, ghostId, seedTenant } =
  await import('../deals/__tests__/two-workspaces');
type TenantFixture = Awaited<ReturnType<typeof seedTenant>>;
const { createKnowledgeFeedbackRouter } = await import('./feedback');

const app = express();
app.use(express.json());
app.use(createKnowledgeFeedbackRouter());

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await seedTenant('A');
  B = await seedTenant('B');
});

afterAll(async () => {
  await dropTenants(A, B);
  await closeDb();
});

beforeEach(() => actAs(A));

async function feedbackOf(workspaceId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.kbFeedback.id })
    .from(schema.kbFeedback)
    .where(eq(schema.kbFeedback.workspaceId, workspaceId));
  return rows.length;
}

describe('POST /api/knowledge/feedback (F70-S11)', () => {
  const cases: ReadonlyArray<{ field: string; value: () => string }> = [
    { field: 'chunkId', value: () => B.kbChunk },
    { field: 'agentId', value: () => B.agent },
    { field: 'conversationId', value: () => B.conversation },
  ];

  for (const c of cases) {
    it(`${c.field} de B → 422, igual a inexistente, sem gravar`, async () => {
      const base = { documentId: A.kbDocument, helpful: true };
      const res = await request(app)
        .post('/api/knowledge/feedback')
        .send({ ...base, [c.field]: c.value() });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('invalid_reference');
      expect(res.body.fields).toEqual([c.field]);
      const ghost = await request(app)
        .post('/api/knowledge/feedback')
        .send({ ...base, [c.field]: ghostId() });
      expect(ghost.body).toEqual(res.body);
      expect(await feedbackOf(A.ws)).toBe(0);
    });
  }

  it('chunk de OUTRO documento do mesmo workspace → 422 chunkId', async () => {
    const [otherDoc] = await getDb()
      .insert(schema.kbDocuments)
      .values({
        workspaceId: A.ws,
        title: 'Outro doc',
        source: 'manual',
        rawContent: '# outro',
        contentSha256: 'f'.repeat(64),
      })
      .returning();
    if (!otherDoc) throw new Error('doc');
    const res = await request(app)
      .post('/api/knowledge/feedback')
      .send({ documentId: otherDoc.id, chunkId: A.kbChunk, helpful: false });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual(['chunkId']);
  });

  it('caminho feliz com chunk, agente e conversa próprios → 201', async () => {
    const res = await request(app).post('/api/knowledge/feedback').send({
      documentId: A.kbDocument,
      chunkId: A.kbChunk,
      agentId: A.agent,
      conversationId: A.conversation,
      helpful: true,
    });
    expect(res.status).toBe(201);
    expect(await feedbackOf(A.ws)).toBe(1);
  });
});
