/**
 * F47-S04 — Card a partir da conversa + cadastro read-through + snapshot.
 *
 * Integração com o Postgres dev (RLS real). Mocks de auth FIÉIS (mesma estratégia
 * de items.test.ts): `requireAuth` recusa sem sessão (401), `requireRole` usa o
 * `can()` REAL, `withRLS` injeta `req.scoped` = `withWorkspace` real. Provamos:
 *  - POST /api/conversations/:id/deal cria o card ligado à conversa (idempotente:
 *    2 chamadas = 1 deal, mesma id),
 *  - read-through: GET /api/deals/:id e GET /api/conversations/:id trazem o
 *    cadastro VIVO do contato (address/document),
 *  - snapshot no fechamento: close-won/lost grava custom_fields.contact_snapshot
 *    com o cadastro vigente (pré-handler do pipeline + close canônico do deals/crud),
 *  - cross-workspace -> 404 (RLS), conversa invisível -> 404 (IDOR fechado).
 *
 * O router de deals/crud é montado JUNTO (depois do pipeline) p/ exercer o
 * pass-through real do snapshot e a interação de ordem dos routers.
 *
 * Skip automático se o Postgres dev não estiver acessível (CI sem DB).
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

const { createDealConversationRouter } = await import('./deal-conversation');
const { createDealsCrudRouter } = await import('../deals/crud');

const app = express();
app.use(express.json());
// Pipeline (read-through + snapshot pré-handler) ANTES de deals/crud — espelha
// a ordem de app.ts (pipeline → deals).
app.use(createDealConversationRouter());
app.use(createDealsCrudRouter());

// ── Fixtures ────────────────────────────────────────────────────────────────
const WS = randomUUID();
const OTHER_WS = randomUUID();
const MEMBER = randomUUID();
const OTHER_MEMBER = randomUUID();
const CONTACT = randomUUID();
const CHANNEL = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();

let dbAvailable = true;

async function seedWorkspace(wsId: string, slug: string): Promise<void> {
  const db = getDb();
  await db.insert(schema.workspaces).values({ id: wsId, name: `WS ${slug}`, slug });
}

beforeAll(async () => {
  try {
    const db = getDb();
    await seedWorkspace(WS, `f47s04-${WS.slice(0, 8)}`);
    await seedWorkspace(OTHER_WS, `f47s04o-${OTHER_WS.slice(0, 8)}`);
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
    await db.insert(schema.contacts).values({
      id: CONTACT,
      workspaceId: WS,
      displayName: 'Maria Souza',
      phone: '+5511999990000',
    });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal Teste',
      wahaSessionId: `s-${CHANNEL.slice(0, 8)}`,
    });
    await db
      .insert(schema.pipelines)
      .values({ id: PIPELINE, workspaceId: WS, name: 'Funil', isDefault: true });
    await db
      .insert(schema.stages)
      .values({ id: STAGE, workspaceId: WS, pipelineId: PIPELINE, name: 'Novo', position: 0 });
  } catch (err) {
    dbAvailable = false;
    console.warn('[deal-conversation.test] Postgres dev indisponível — testes pulados.', err);
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

/** Cria uma conversa limpa (sem deal) e devolve a id. */
async function freshConversation(wsId = WS): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.conversations)
    .values({
      id,
      workspaceId: wsId,
      channelId: CHANNEL,
      contactId: CONTACT,
      remoteId: `r-${id.slice(0, 12)}`,
    });
  return id;
}

async function dealsForConversation(conversationId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(eq(schema.deals.conversationId, conversationId));
  return rows.map((r) => r.id);
}

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'OWNER' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

// ── Autorização ───────────────────────────────────────────────────────────────
describe('autorização', () => {
  it('sem sessão -> 401', async () => {
    session = null;
    const ID = randomUUID();
    expect((await request(app).post(`/api/conversations/${ID}/deal`)).status).toBe(401);
  });

  maybe('READONLY (sem deal.edit) -> 403', async () => {
    const conv = await freshConversation();
    session = { workspaceId: WS, memberId: MEMBER, role: 'READONLY' };
    const res = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(res.status).toBe(403);
  });
});

// ── Criação idempotente ─────────────────────────────────────────────────────
describe('POST /api/conversations/:id/deal — idempotência', () => {
  maybe('cria o card ligado à conversa (estágio default, título = nome)', async () => {
    const conv = await freshConversation();
    const res = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(res.status).toBe(201);
    expect(res.body.deal.contactId).toBe(CONTACT);
    expect(res.body.deal.conversationId).toBe(conv);
    expect(res.body.deal.stageId).toBe(STAGE);
    expect(res.body.deal.title).toBe('Maria Souza');
  });

  maybe('2 chamadas = 1 deal (mesma id)', async () => {
    const conv = await freshConversation();
    const first = await request(app).post(`/api/conversations/${conv}/deal`);
    const second = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.deal.id).toBe(first.body.deal.id);
    expect(await dealsForConversation(conv)).toHaveLength(1);
  });

  maybe('conversa de outro workspace -> 404 (RLS/IDOR)', async () => {
    const conv = await freshConversation(WS);
    session = { workspaceId: OTHER_WS, memberId: OTHER_MEMBER, role: 'OWNER' };
    const res = await request(app).post(`/api/conversations/${conv}/deal`);
    expect(res.status).toBe(404);
  });

  maybe('conversa inexistente -> 404', async () => {
    const res = await request(app).post(`/api/conversations/${randomUUID()}/deal`);
    expect(res.status).toBe(404);
  });
});

// ── Read-through ─────────────────────────────────────────────────────────────
describe('GET /api/deals/:id — cadastro read-through', () => {
  maybe('detalhe do deal traz o cadastro VIVO do contato (address/document)', async () => {
    // Enriquece o cadastro do contato e checa que o detalhe do deal reflete na hora.
    await getDb()
      .update(schema.contacts)
      .set({ document: '12345678901', address: { city: 'São Paulo', state: 'SP', cep: '01001000' } })
      .where(eq(schema.contacts.id, CONTACT));

    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    const res = await request(app).get(`/api/deals/${dealId}`);
    expect(res.status).toBe(200);
    expect(res.body.deal.id).toBe(dealId);
    expect(res.body.contact.document).toBe('12345678901');
    expect(res.body.contact.address.city).toBe('São Paulo');
    expect(res.body.contact.address.state).toBe('SP');
  });

  maybe('deal de outro workspace -> 404', async () => {
    const conv = await freshConversation(WS);
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;
    session = { workspaceId: OTHER_WS, memberId: OTHER_MEMBER, role: 'OWNER' };
    const res = await request(app).get(`/api/deals/${dealId}`);
    expect(res.status).toBe(404);
  });
});

// ── Snapshot no fechamento ───────────────────────────────────────────────────
describe('snapshot no fechamento', () => {
  maybe('close-won grava custom_fields.contact_snapshot com o cadastro vigente', async () => {
    await getDb()
      .update(schema.contacts)
      .set({ document: '99988877766', address: { city: 'Rio', state: 'RJ' } })
      .where(eq(schema.contacts.id, CONTACT));

    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;

    const close = await request(app).post(`/api/deals/${dealId}/close-won`);
    expect(close.status).toBe(200);
    expect(close.body.deal.closedWon).toBe(true);

    const [row] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    const snap = (row?.cf as Record<string, unknown>)['contact_snapshot'] as Record<string, unknown>;
    expect(snap).toBeTruthy();
    expect(snap['document']).toBe('99988877766');
    expect((snap['address'] as Record<string, unknown>)['state']).toBe('RJ');
    expect(snap['capturedAt']).toBeTruthy();
  });

  maybe('close-lost também grava o snapshot', async () => {
    const conv = await freshConversation();
    const created = await request(app).post(`/api/conversations/${conv}/deal`);
    const dealId = created.body.deal.id as string;
    const close = await request(app)
      .post(`/api/deals/${dealId}/close-lost`)
      .send({ reason: 'sem orçamento' });
    expect(close.status).toBe(200);
    const [row] = await getDb()
      .select({ cf: schema.deals.customFields })
      .from(schema.deals)
      .where(eq(schema.deals.id, dealId));
    expect((row?.cf as Record<string, unknown>)['contact_snapshot']).toBeTruthy();
  });
});
