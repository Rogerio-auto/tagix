/**
 * F47-S04 — PATCH de cadastro estruturado (address/document) + detalhe.
 *
 * Integração com o Postgres dev (RLS real). Mocks de auth FIÉIS (mesma estratégia
 * de items.test.ts). Provamos:
 *  - PATCH /api/contacts/:id aceita address (UF/CEP validados) e document e PERSISTE,
 *  - validação: UF inválida -> 400; CEP malformado -> 400; documento com nº de dígitos
 *    errado -> 400,
 *  - GET /api/contacts/:id retorna address/document,
 *  - cross-workspace -> 404 (RLS).
 *
 * Skip automático se o Postgres dev não estiver acessível.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { can, type Permission, type Role } from '@hm/shared';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';

interface Session {
  workspaceId: string;
  memberId: string;
  role: Role;
}
let session: Session | null = null;

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!session) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: session.workspaceId },
      member: { id: session.memberId, role: session.role },
    } as express.Request['auth'];
    next();
  },
  withRLS: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    const wsId = req.auth.workspace.id;
    (req as unknown as { scoped: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> }).scoped = (
      fn,
    ) => withWorkspace(wsId, fn as never);
    next();
  },
  requireRole:
    (perm: Permission) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.auth?.member.role as Role | undefined;
      if (!role || !can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

const { createContactsCrudRouter } = await import('./contacts');

const app = express();
app.use(express.json());
app.use(createContactsCrudRouter());

const WS = randomUUID();
const OTHER_WS = randomUUID();
const MEMBER = randomUUID();
const OTHER_MEMBER = randomUUID();
const CONTACT = randomUUID();

let dbAvailable = true;

beforeAll(async () => {
  try {
    const db = getDb();
    await db.insert(schema.workspaces).values([
      { id: WS, name: 'WS', slug: `f47s04c-${WS.slice(0, 8)}` },
      { id: OTHER_WS, name: 'WSo', slug: `f47s04co-${OTHER_WS.slice(0, 8)}` },
    ]);
    await db.insert(schema.members).values([
      {
        id: MEMBER,
        workspaceId: WS,
        authUserId: randomUUID(),
        email: `m-${MEMBER.slice(0, 8)}@x.test`,
        role: 'OWNER',
        status: 'active',
      },
      {
        id: OTHER_MEMBER,
        workspaceId: OTHER_WS,
        authUserId: randomUUID(),
        email: `m-${OTHER_MEMBER.slice(0, 8)}@x.test`,
        role: 'OWNER',
        status: 'active',
      },
    ]);
    await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, displayName: 'Cliente' });
  } catch (err) {
    dbAvailable = false;
    console.warn('[contacts.test] Postgres dev indisponível — testes pulados.', err);
  }
});

afterAll(async () => {
  if (dbAvailable) {
    const db = getDb();
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, OTHER_WS));
  }
  await closeDb();
});

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

describe('PATCH /api/contacts/:id — cadastro estruturado', () => {
  maybe('persiste address + document e devolve no body', async () => {
    const res = await request(app)
      .patch(`/api/contacts/${CONTACT}`)
      .send({
        address: {
          cep: '01001-000',
          street: 'Praça da Sé',
          number: '100',
          district: 'Sé',
          city: 'São Paulo',
          state: 'sp',
        },
        document: '123.456.789-01',
      });
    expect(res.status).toBe(200);
    expect(res.body.contact.document).toBe('123.456.789-01');
    expect(res.body.contact.address.city).toBe('São Paulo');
    // UF normalizada para maiúscula.
    expect(res.body.contact.address.state).toBe('SP');

    // Persistiu de fato.
    const [row] = await getDb()
      .select({ address: schema.contacts.address, document: schema.contacts.document })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, CONTACT));
    expect(row?.document).toBe('123.456.789-01');
    expect(row?.address.cep).toBe('01001-000');
  });

  maybe('GET /api/contacts/:id retorna address/document', async () => {
    await getDb()
      .update(schema.contacts)
      .set({ document: '11222333000181', address: { city: 'Curitiba', state: 'PR' } })
      .where(eq(schema.contacts.id, CONTACT));
    const res = await request(app).get(`/api/contacts/${CONTACT}`);
    expect(res.status).toBe(200);
    expect(res.body.contact.document).toBe('11222333000181');
    expect(res.body.contact.address.state).toBe('PR');
  });

  maybe('UF inválida -> 400', async () => {
    const res = await request(app)
      .patch(`/api/contacts/${CONTACT}`)
      .send({ address: { state: 'XYZ' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  maybe('CEP malformado -> 400', async () => {
    const res = await request(app)
      .patch(`/api/contacts/${CONTACT}`)
      .send({ address: { cep: '123' } });
    expect(res.status).toBe(400);
  });

  maybe('documento com dígitos errados -> 400', async () => {
    const res = await request(app)
      .patch(`/api/contacts/${CONTACT}`)
      .send({ document: '12345' });
    expect(res.status).toBe(400);
  });

  maybe('contato de outro workspace -> 404 (RLS)', async () => {
    session = { workspaceId: OTHER_WS, memberId: OTHER_MEMBER, role: 'OWNER' };
    const res = await request(app)
      .patch(`/api/contacts/${CONTACT}`)
      .send({ document: '12345678901' });
    expect(res.status).toBe(404);
  });
});
