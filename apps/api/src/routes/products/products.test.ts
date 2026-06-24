/**
 * Testes de rota do catálogo de produtos (F47-S02).
 *
 * Sem banco real: mockamos os middlewares de auth (injetando `req.auth` + um
 * `req.scoped` controlável por teste) e usamos o `can()` REAL de `@hm/shared`, então
 * a autorização (`product.view`/`product.edit`) é genuinamente exercitada.
 *
 * Cobre: happy path CRUD, authz (READONLY/AGENT barrados no edit/create),
 * 409 duplicate_sku, RLS scoping (cross-workspace → 404, não vaza) e soft-delete
 * (some da lista; resposta 204).
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { can, type Permission, type Role } from '@hm/shared';

const WORKSPACE_A = '00000000-0000-0000-0000-000000000001';
const MEMBER_ID = '00000000-0000-0000-0000-0000000000a1';
const PRODUCT_ID = '00000000-0000-0000-0000-0000000000b1';

/** Estado de auth mutável por teste. */
const authState: { role: Role; authenticated: boolean } = {
  role: 'ADMIN',
  authenticated: true,
};

/**
 * Handler do `req.scoped(fn)`. Por padrão executa `fn` contra um `tx` fake que
 * registra a última operação tentada; os testes substituem por uma implementação
 * que devolve linhas ou lança a violação de unique (23505).
 */
const scopedState: { handler: (fn: (tx: unknown) => unknown) => Promise<unknown> } = {
  handler: (fn) => Promise.resolve(fn({})),
};

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.authenticated) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: WORKSPACE_A },
      member: { id: MEMBER_ID, role: authState.role },
    } as typeof req.auth;
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { scoped: unknown }).scoped = (fn: (tx: unknown) => unknown) =>
      scopedState.handler(fn);
    next();
  },
  // Matriz REAL — authz de verdade.
  requireRole:
    (perm: Permission) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = (req.auth?.member.role ?? authState.role) as Role;
      if (!can(role, perm)) {
        res.status(403).json({ message: 'Sem permissão para esta ação.' });
        return;
      }
      next();
    },
}));

// Importado APÓS o mock (vi.mock é hoisted).
import { createProductsRouter } from './index';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createProductsRouter());
  return app;
}

const productRow = {
  id: PRODUCT_ID,
  workspaceId: WORKSPACE_A,
  name: 'Plano Pro',
  sku: 'PRO-1',
  description: null,
  priceCents: 9900,
  currency: 'BRL',
  active: true,
  createdAt: new Date().toISOString(),
  updatedAt: null,
  deletedAt: null,
};

/** Erro com `code` 23505 (unique violation do Postgres). */
function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

beforeEach(() => {
  authState.role = 'ADMIN';
  authState.authenticated = true;
  scopedState.handler = (fn) => Promise.resolve(fn({}));
});

// ── GET /api/products ────────────────────────────────────────────────────────
describe('GET /api/products', () => {
  it('200 com { products, page, pageSize, total, totalPages }', async () => {
    scopedState.handler = () => Promise.resolve({ rows: [productRow], total: 1 });
    const res = await request(buildApp()).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].id).toBe(PRODUCT_ID);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.total).toBe(1);
    expect(res.body.totalPages).toBe(1);
  });

  it('READONLY tem product.view → 200 (catálogo é leitura ampla)', async () => {
    authState.role = 'READONLY';
    scopedState.handler = () => Promise.resolve({ rows: [], total: 0 });
    const res = await request(buildApp()).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([]);
    expect(res.body.totalPages).toBe(1);
  });

  it('401 sem sessão', async () => {
    authState.authenticated = false;
    expect((await request(buildApp()).get('/api/products')).status).toBe(401);
  });

  it('400 para query inválida (pageSize > 100)', async () => {
    const res = await request(buildApp()).get('/api/products?pageSize=500');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_query');
  });

  it('paginação calcula totalPages a partir de total/pageSize', async () => {
    scopedState.handler = () => Promise.resolve({ rows: [productRow], total: 7 });
    const res = await request(buildApp()).get('/api/products?pageSize=3&page=2');
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(3);
    expect(res.body.page).toBe(2);
    expect(res.body.totalPages).toBe(3);
  });
});

// ── POST /api/products ───────────────────────────────────────────────────────
describe('POST /api/products', () => {
  it('201 cria com { product } e carimba workspaceId do escopo', async () => {
    let inserted: Record<string, unknown> | undefined;
    scopedState.handler = (fn) =>
      Promise.resolve(
        fn({
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              inserted = v;
              return { returning: () => [{ ...productRow, ...v }] };
            },
          }),
        }),
      );
    const res = await request(buildApp())
      .post('/api/products')
      .send({ name: 'Plano Pro', sku: 'PRO-1', priceCents: 9900 });
    expect(res.status).toBe(201);
    expect(res.body.product.name).toBe('Plano Pro');
    expect(inserted?.['workspaceId']).toBe(WORKSPACE_A);
    expect(inserted?.['currency']).toBe('BRL'); // default
    expect(inserted?.['active']).toBe(true); // default
  });

  it('409 duplicate_sku em SKU repetido (23505)', async () => {
    scopedState.handler = () => Promise.reject(uniqueViolation());
    const res = await request(buildApp())
      .post('/api/products')
      .send({ name: 'Plano Pro', sku: 'PRO-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_sku');
  });

  it('400 sem name', async () => {
    const res = await request(buildApp()).post('/api/products').send({ priceCents: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 para priceCents negativo', async () => {
    const res = await request(buildApp())
      .post('/api/products')
      .send({ name: 'X', priceCents: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 para READONLY (sem product.edit)', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('403 para AGENT (sem product.edit — só ADMINS gerem o catálogo)', async () => {
    authState.role = 'AGENT';
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('403 para SUPERVISOR (catálogo é ADMINS)', async () => {
    authState.role = 'SUPERVISOR';
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/products/:id ──────────────────────────────────────────────────
describe('PATCH /api/products/:id', () => {
  it('200 edita parcial e retorna { product }', async () => {
    scopedState.handler = (fn) =>
      Promise.resolve(
        fn({
          update: () => ({
            set: (patch: Record<string, unknown>) => ({
              where: () => ({ returning: () => [{ ...productRow, ...patch }] }),
            }),
          }),
        }),
      );
    const res = await request(buildApp())
      .patch(`/api/products/${PRODUCT_ID}`)
      .send({ priceCents: 12000 });
    expect(res.status).toBe(200);
    expect(res.body.product.priceCents).toBe(12000);
  });

  it('404 cross-workspace (RLS não vaza — update afeta 0 linhas)', async () => {
    // RLS + filtro de workspace fazem o UPDATE não casar nenhuma linha de outro tenant.
    scopedState.handler = (fn) =>
      Promise.resolve(
        fn({
          update: () => ({
            set: () => ({ where: () => ({ returning: () => [] }) }),
          }),
        }),
      );
    const res = await request(buildApp())
      .patch(`/api/products/${PRODUCT_ID}`)
      .send({ name: 'Hack' });
    expect(res.status).toBe(404);
  });

  it('409 duplicate_sku ao colidir SKU (23505)', async () => {
    scopedState.handler = () => Promise.reject(uniqueViolation());
    const res = await request(buildApp())
      .patch(`/api/products/${PRODUCT_ID}`)
      .send({ sku: 'OUTRO' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_sku');
  });

  it('403 para READONLY', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp())
      .patch(`/api/products/${PRODUCT_ID}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/products/:id ─────────────────────────────────────────────────
describe('DELETE /api/products/:id', () => {
  it('204 soft-delete (marca deleted_at; não some do banco)', async () => {
    let setPatch: Record<string, unknown> | undefined;
    scopedState.handler = (fn) =>
      Promise.resolve(
        fn({
          update: () => ({
            set: (patch: Record<string, unknown>) => {
              setPatch = patch;
              return { where: () => ({ returning: () => [{ id: PRODUCT_ID }] }) };
            },
          }),
        }),
      );
    const res = await request(buildApp()).delete(`/api/products/${PRODUCT_ID}`);
    expect(res.status).toBe(204);
    // É soft-delete: carimba deleted_at (não DELETE físico) e desativa.
    expect(setPatch?.['deletedAt']).toBeInstanceOf(Date);
    expect(setPatch?.['active']).toBe(false);
  });

  it('404 quando já deletado ou de outro workspace (0 linhas)', async () => {
    scopedState.handler = (fn) =>
      Promise.resolve(
        fn({
          update: () => ({ set: () => ({ where: () => ({ returning: () => [] }) }) }),
        }),
      );
    const res = await request(buildApp()).delete(`/api/products/${PRODUCT_ID}`);
    expect(res.status).toBe(404);
  });

  it('403 para READONLY', async () => {
    authState.role = 'READONLY';
    const res = await request(buildApp()).delete(`/api/products/${PRODUCT_ID}`);
    expect(res.status).toBe(403);
  });
});
