/**
 * F70-S11 — `POST/PATCH /api/contacts` recusam `ownerId` de outro workspace.
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
const { createContactsCrudRouter } = await import('./contacts');

const app = express();
app.use(express.json());
app.use(createContactsCrudRouter());

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

describe('POST/PATCH /api/contacts — ownerId (F70-S11)', () => {
  it('POST com ownerId de B → 422, igual a inexistente, sem gravar', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .send({ displayName: 'Lead X', ownerId: B.member });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_reference');
    expect(res.body.fields).toEqual(['ownerId']);
    const ghost = await request(app)
      .post('/api/contacts')
      .send({ displayName: 'Lead X', ownerId: ghostId() });
    expect(ghost.body).toEqual(res.body);
    const rows = await getDb()
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.displayName, 'Lead X'));
    expect(rows).toHaveLength(0);
  });

  it('PATCH com ownerId de B → 422 e o contato não muda', async () => {
    const res = await request(app).patch(`/api/contacts/${A.contact}`).send({ ownerId: B.member });
    expect(res.status).toBe(422);
    const [row] = await getDb()
      .select({ ownerId: schema.contacts.ownerId })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, A.contact));
    expect(row?.ownerId).toBeNull();
  });

  it('PATCH em contato de B → 404 antes de olhar o payload', async () => {
    const res = await request(app).patch(`/api/contacts/${B.contact}`).send({ ownerId: A.member });
    expect(res.status).toBe(404);
  });

  it('caminho feliz: dono do próprio workspace → 201/200', async () => {
    const created = await request(app)
      .post('/api/contacts')
      .send({ displayName: 'Lead Y', ownerId: A.otherMember });
    expect(created.status).toBe(201);
    expect(created.body.contact.ownerId).toBe(A.otherMember);
    const patched = await request(app)
      .patch(`/api/contacts/${A.contact}`)
      .send({ ownerId: A.otherMember });
    expect(patched.status).toBe(200);
    expect(patched.body.contact.ownerId).toBe(A.otherMember);
  });
});
