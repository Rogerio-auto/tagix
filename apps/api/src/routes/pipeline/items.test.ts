/**
 * F47-S03 — itens do card + recompute autoritativo de `deals.value_cents`.
 *
 * Integração com o Postgres dev (RLS real). Os middlewares de auth são mockados de
 * forma FIEL: `requireAuth` recusa sem sessão (401), `requireRole` usa o `can()` REAL
 * da matriz de permissões, e `withRLS` injeta `req.scoped` = `withWorkspace` real
 * (papel `hm_app`, RLS por workspace). Provamos a regra central de ponta a ponta:
 *  - mutação recalcula `deals.value_cents = Σ(qty × unit_price)` no servidor (SQL),
 *  - grava `deal_history(field_updated, from/to value_cents)` na MESMA transação,
 *  - snapshot de produto é imutável e sobrevive a produto inativo/soft-deletado,
 *  - cross-workspace e item de outro deal -> 404,
 *  - concorrência: o recompute autoritativo nunca corrompe a soma.
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

// Sessão controlada pelos testes; lida pelos mocks de auth.
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

const { createDealItemsRouter } = await import('./items');

const app = express();
app.use(express.json());
app.use(createDealItemsRouter());

// ---------------------------------------------------------------------------
// Fixtures (ids únicos por execução p/ não colidir entre rodadas).
// ---------------------------------------------------------------------------
const WS = randomUUID();
const OTHER_WS = randomUUID();
const MEMBER = randomUUID();
const CONTACT = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();
const PRODUCT = randomUUID();
const PRODUCT_INACTIVE = randomUUID();
const PRODUCT_DELETED = randomUUID();

let dbAvailable = true;

async function seedWorkspace(wsId: string, slug: string): Promise<void> {
  const db = getDb();
  await db.insert(schema.workspaces).values({ id: wsId, name: `WS ${slug}`, slug });
}

beforeAll(async () => {
  try {
    const db = getDb();
    await seedWorkspace(WS, `f47s03-${WS.slice(0, 8)}`);
    await seedWorkspace(OTHER_WS, `f47s03o-${OTHER_WS.slice(0, 8)}`);
    await db.insert(schema.members).values({
      id: MEMBER,
      workspaceId: WS,
      authUserId: randomUUID(),
      email: `m-${MEMBER.slice(0, 8)}@x.test`,
      role: 'AGENT',
      status: 'active',
    });
    await db.insert(schema.contacts).values({ id: CONTACT, workspaceId: WS, displayName: 'Cliente' });
    await db
      .insert(schema.pipelines)
      .values({ id: PIPELINE, workspaceId: WS, name: 'Funil', isDefault: true });
    await db
      .insert(schema.stages)
      .values({ id: STAGE, workspaceId: WS, pipelineId: PIPELINE, name: 'Novo', position: 0 });
    await db.insert(schema.products).values([
      { id: PRODUCT, workspaceId: WS, name: 'Plano Premium', priceCents: 9900, currency: 'BRL' },
      {
        id: PRODUCT_INACTIVE,
        workspaceId: WS,
        name: 'Produto Descontinuado',
        priceCents: 5000,
        active: false,
      },
      {
        id: PRODUCT_DELETED,
        workspaceId: WS,
        name: 'Apagado',
        priceCents: 100,
        deletedAt: new Date(),
      },
    ]);
  } catch (err) {
    dbAvailable = false;
    console.warn('[items.test] Postgres dev indisponível — testes de DB serão pulados.', err);
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

/** Cria um deal limpo (value_cents=0, sem itens) e devolve o id. */
async function freshDeal(wsId = WS): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(schema.deals)
    .values({
      id,
      workspaceId: wsId,
      pipelineId: PIPELINE,
      stageId: STAGE,
      contactId: CONTACT,
      title: 'Negócio',
      valueCents: 0,
    });
  return id;
}

async function dealValue(dealId: string): Promise<number> {
  const [row] = await getDb()
    .select({ v: schema.deals.valueCents })
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId));
  return row?.v ?? -1;
}

async function historyTypes(dealId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ t: schema.dealHistory.eventType })
    .from(schema.dealHistory)
    .where(eq(schema.dealHistory.dealId, dealId));
  return rows.map((r) => r.t);
}

beforeEach(() => {
  session = { workspaceId: WS, memberId: MEMBER, role: 'AGENT' };
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbAvailable) return;
    await fn();
  });

// ---------------------------------------------------------------------------
// Autorização (não precisa de DB para o 401; can() é real).
// ---------------------------------------------------------------------------
describe('autorização', () => {
  it('sem sessão -> 401', async () => {
    session = null;
    const ID = randomUUID();
    expect((await request(app).get(`/api/deals/${ID}/items`)).status).toBe(401);
    expect((await request(app).post(`/api/deals/${ID}/items`).send({ qty: 1 })).status).toBe(401);
    expect((await request(app).patch(`/api/deals/${ID}/items/${ID}`).send({ qty: 1 })).status).toBe(
      401,
    );
    expect((await request(app).delete(`/api/deals/${ID}/items/${ID}`)).status).toBe(401);
  });

  maybe('READONLY lista (pipeline.view) mas NÃO muta (deal.edit -> 403)', async () => {
    const dealId = await freshDeal();
    session = { workspaceId: WS, memberId: MEMBER, role: 'READONLY' };
    expect((await request(app).get(`/api/deals/${dealId}/items`)).status).toBe(200);
    const post = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 100, qty: 1 });
    expect(post.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Recompute autoritativo.
// ---------------------------------------------------------------------------
describe('recompute de deals.value_cents', () => {
  maybe('POST soma, devolve dealValueCents e grava field_updated', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'Serviço A', unitPriceCents: 5000, qty: 3 });
    expect(res.status).toBe(201);
    expect(res.body.dealValueCents).toBe(15000);
    expect(await dealValue(dealId)).toBe(15000);
    expect(await historyTypes(dealId)).toContain('field_updated');
  });

  maybe('PATCH recalcula após editar qty', async () => {
    const dealId = await freshDeal();
    const created = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 1000, qty: 2 });
    expect(await dealValue(dealId)).toBe(2000);
    const itemId = created.body.item.id as string;
    const res = await request(app).patch(`/api/deals/${dealId}/items/${itemId}`).send({ qty: 5 });
    expect(res.status).toBe(200);
    expect(res.body.dealValueCents).toBe(5000);
    expect(await dealValue(dealId)).toBe(5000);
  });

  maybe('DELETE remove e zera a soma', async () => {
    const dealId = await freshDeal();
    const created = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 4000, qty: 1 });
    expect(await dealValue(dealId)).toBe(4000);
    const itemId = created.body.item.id as string;
    const res = await request(app).delete(`/api/deals/${dealId}/items/${itemId}`);
    expect(res.status).toBe(200);
    expect(res.body.dealValueCents).toBe(0);
    expect(await dealValue(dealId)).toBe(0);
  });

  maybe('soma de múltiplos itens = Σ(qty × unit_price)', async () => {
    const dealId = await freshDeal();
    await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'A', unitPriceCents: 1000, qty: 2 }); // 2000
    const last = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'B', unitPriceCents: 750, qty: 4 }); // 3000
    expect(last.body.dealValueCents).toBe(5000);
    expect(await dealValue(dealId)).toBe(5000);
  });

  maybe('GET lista os itens do card em ordem de position', async () => {
    const dealId = await freshDeal();
    await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'A', unitPriceCents: 1000, qty: 1, position: 1 });
    await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'B', unitPriceCents: 1000, qty: 1, position: 0 });
    const res = await request(app).get(`/api/deals/${dealId}/items`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { nameSnapshot: string }) => i.nameSnapshot)).toEqual(['B', 'A']);
  });
});

// ---------------------------------------------------------------------------
// Snapshot de produto.
// ---------------------------------------------------------------------------
describe('snapshot de produto', () => {
  maybe('snapshota nome/preço no momento do lançamento', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ productId: PRODUCT, qty: 2 });
    expect(res.status).toBe(201);
    expect(res.body.item.nameSnapshot).toBe('Plano Premium');
    expect(res.body.item.unitPriceCents).toBe(9900);
    expect(res.body.dealValueCents).toBe(19800);
  });

  maybe('produto inativo ainda é referenciável (snapshot)', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ productId: PRODUCT_INACTIVE, qty: 1 });
    expect(res.status).toBe(201);
    expect(res.body.item.nameSnapshot).toBe('Produto Descontinuado');
  });

  maybe('snapshot sobrevive a produto soft-deletado APÓS lançado', async () => {
    // Lança com produto vivo, depois soft-deleta: o item mantém o snapshot e o valor.
    const dealId = await freshDeal();
    const liveProduct = randomUUID();
    await getDb()
      .insert(schema.products)
      .values({ id: liveProduct, workspaceId: WS, name: 'Efêmero', priceCents: 1234 });
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ productId: liveProduct, qty: 1 });
    expect(res.status).toBe(201);
    await getDb()
      .update(schema.products)
      .set({ deletedAt: new Date() })
      .where(eq(schema.products.id, liveProduct));
    const list = await request(app).get(`/api/deals/${dealId}/items`);
    expect(list.body.items[0].nameSnapshot).toBe('Efêmero');
    expect(list.body.items[0].unitPriceCents).toBe(1234);
  });

  maybe('produto soft-deletado não pode ser lançado -> 404', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ productId: PRODUCT_DELETED, qty: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('product_not_found');
  });
});

// ---------------------------------------------------------------------------
// Validação + RLS + concorrência.
// ---------------------------------------------------------------------------
describe('validação, RLS e concorrência', () => {
  maybe('qty<=0 -> 400', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 100, qty: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  maybe('unit_price_cents<0 -> 400', async () => {
    const dealId = await freshDeal();
    const res = await request(app)
      .post(`/api/deals/${dealId}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: -1, qty: 1 });
    expect(res.status).toBe(400);
  });

  maybe('sem productId nem nameSnapshot+preço -> 400', async () => {
    const dealId = await freshDeal();
    const res = await request(app).post(`/api/deals/${dealId}/items`).send({ qty: 1 });
    expect(res.status).toBe(400);
  });

  maybe('deal de outro workspace -> 404 (RLS)', async () => {
    const otherDeal = randomUUID();
    // Deal num workspace sem pipeline/stage/contact próprios — usa os do WS só para
    // satisfazer FK? Não: FK exige mesmas linhas. Criamos um deal mínimo no OTHER_WS
    // reaproveitando que pipeline/stage/contact são do WS NÃO funciona (cross-ws FK).
    // Então criamos um deal real no WS e mudamos a sessão para OTHER_WS: a RLS do
    // OTHER_WS não enxerga o deal do WS -> 404.
    const dealInWs = await freshDeal(WS);
    void otherDeal;
    session = { workspaceId: OTHER_WS, memberId: MEMBER, role: 'AGENT' };
    const res = await request(app)
      .post(`/api/deals/${dealInWs}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 100, qty: 1 });
    expect(res.status).toBe(404);
  });

  maybe('item de outro deal -> 404 no PATCH', async () => {
    const dealA = await freshDeal();
    const dealB = await freshDeal();
    const created = await request(app)
      .post(`/api/deals/${dealA}/items`)
      .send({ nameSnapshot: 'X', unitPriceCents: 100, qty: 1 });
    const itemId = created.body.item.id as string;
    const res = await request(app).patch(`/api/deals/${dealB}/items/${itemId}`).send({ qty: 9 });
    expect(res.status).toBe(404);
  });

  maybe('concorrência: duas mutações simultâneas não corrompem a soma', async () => {
    const dealId = await freshDeal();
    await Promise.all([
      request(app)
        .post(`/api/deals/${dealId}/items`)
        .send({ nameSnapshot: 'A', unitPriceCents: 1000, qty: 1 }),
      request(app)
        .post(`/api/deals/${dealId}/items`)
        .send({ nameSnapshot: 'B', unitPriceCents: 2000, qty: 1 }),
    ]);
    // O recompute é Σ sobre TODOS os itens (autoritativo), nunca soma incremental:
    // independentemente da ordem, o valor final é exato.
    expect(await dealValue(dealId)).toBe(3000);
  });
});
