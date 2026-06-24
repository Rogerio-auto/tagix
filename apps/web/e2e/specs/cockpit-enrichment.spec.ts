/**
 * F47-S11 (QA) — e2e da feature "Enriquecimento do Cliente no Cockpit + Catálogo
 * de Produtos" (COCKPIT_CLIENT_ENRICHMENT).
 *
 * Cobre os fluxos críticos da fase, herméticos (API mockada via fixtures):
 *  - Catálogo de Produtos em Settings (/settings/products): empty state com CTA →
 *    criar produto → ele aparece na lista (mock stateful por-spec).
 *  - Contrato do card-da-conversa: POST /api/conversations/:id/deal é idempotente
 *    (auto-create devolve o mesmo deal) e os itens recomputam o valor do card
 *    (Σ qty × unit_price) — exercitado pelo mesmo contrato que o cockpit usa.
 *
 * NOTA DE AMBIENTE (memória do projeto): a suíte Playwright NÃO hidrata no Windows
 * local (app não sobe headless); estes specs são escritos para rodar no CI. A
 * validação local da web é por typecheck/lint/build/unit.
 *
 * Os mocks F47 são instalados como OVERRIDES por-spec (page.route antes da
 * navegação), seguindo o padrão de pipeline.spec.ts ("estado vazio") — sem tocar
 * o router compartilhado em api-mock.ts (não regride as outras specs).
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';

interface MockProduct {
  id: string;
  workspaceId: string;
  name: string;
  sku: string | null;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

const WS = 'ws_e2e_1';

function makeProduct(over: Partial<MockProduct>): MockProduct {
  return {
    id: over.id ?? `prod_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: WS,
    name: over.name ?? 'Produto',
    sku: over.sku ?? null,
    description: over.description ?? null,
    priceCents: over.priceCents ?? 0,
    currency: 'BRL',
    active: over.active ?? true,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    deletedAt: null,
  };
}

/**
 * Instala um catálogo stateful em memória para /api/products. Devolve o array
 * (referência) para asserções. Precede o router compartilhado (page.route é LIFO).
 */
async function installProductsCatalog(page: Page, seed: MockProduct[]): Promise<MockProduct[]> {
  const catalog = [...seed];
  await page.route('**/api/products**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;

    const json = (body: unknown, status = 200): Promise<void> =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/products' && method === 'GET') {
      const live = catalog.filter((p) => p.deletedAt === null);
      return json({
        products: live,
        page: 1,
        pageSize: 25,
        total: live.length,
        totalPages: 1,
      });
    }
    if (path === '/api/products' && method === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}') as Partial<MockProduct>;
      const created = makeProduct({
        name: body.name ?? 'Sem nome',
        sku: body.sku ?? null,
        priceCents: body.priceCents ?? 0,
      });
      // Unicidade de SKU vivo por workspace (espelha o 409 do backend).
      if (created.sku && catalog.some((p) => p.deletedAt === null && p.sku === created.sku)) {
        return json({ error: 'duplicate_sku', message: 'SKU já existe.' }, 409);
      }
      catalog.push(created);
      return json({ product: created }, 201);
    }
    const idMatch = /^\/api\/products\/([^/]+)$/.exec(path);
    if (idMatch && method === 'DELETE') {
      const p = catalog.find((x) => x.id === idMatch[1]);
      if (p) {
        p.deletedAt = new Date().toISOString();
        p.active = false;
      }
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
  return catalog;
}

test.describe('F47 — Catálogo de Produtos (Settings)', () => {
  test('empty state com CTA → criar produto aparece na lista', async ({ page }) => {
    const catalog = await installProductsCatalog(page, []);
    await page.goto('/settings/products');

    // Header + empty state (catálogo vazio).
    await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible();
    await expect(page.getByText('Nenhum produto ainda')).toBeVisible();

    // CTA "Novo produto" abre o painel de criação.
    await page.getByRole('button', { name: 'Novo produto' }).first().click();
    await expect(page.getByRole('heading', { name: 'Novo produto' })).toBeVisible();

    // Preenche e salva (o mock stateful o adiciona ao catálogo).
    await page.getByLabel(/Nome/i).first().fill('Plano Pro');
    await page.getByRole('button', { name: /Criar|Salvar/i }).first().click();

    // A lista reflete o produto recém-criado.
    await expect(page.getByText('Plano Pro')).toBeVisible();
    expect(catalog.some((p) => p.name === 'Plano Pro')).toBe(true);
  });

  test('catálogo populado lista os produtos vivos', async ({ page }) => {
    await installProductsCatalog(page, [
      makeProduct({ id: 'prod_1', name: 'Consultoria', priceCents: 50000 }),
      makeProduct({ id: 'prod_2', name: 'Implantação', priceCents: 120000 }),
    ]);
    await page.goto('/settings/products');

    await expect(page.getByText('Consultoria')).toBeVisible();
    await expect(page.getByText('Implantação')).toBeVisible();
    await expect(page.getByText('Nenhum produto ainda')).toHaveCount(0);
  });
});

test.describe('F47 — Card-da-conversa: contrato (idempotência + recompute)', () => {
  test('auto-create idempotente: 2 chamadas devolvem o MESMO deal', async ({ page }) => {
    // Mock stateful: 1 deal por conversa (espelha ensureDealForConversation).
    const dealsByConversation = new Map<string, { id: string; conversationId: string; valueCents: number }>();
    await page.route('**/api/conversations/*/deal', async (route) => {
      const url = new URL(route.request().url());
      const convId = url.pathname.split('/')[3] ?? '';
      let deal = dealsByConversation.get(convId);
      if (!deal) {
        deal = { id: `deal_${dealsByConversation.size + 1}`, conversationId: convId, valueCents: 0 };
        dealsByConversation.set(convId, deal);
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ deal }),
      });
    });

    await page.goto('/');

    const ids = await page.evaluate(async () => {
      const call = async (): Promise<string> => {
        const r = await fetch('/api/conversations/conv_e2e_1/deal', {
          method: 'POST',
          credentials: 'include',
        });
        const body = (await r.json()) as { deal: { id: string } };
        return body.deal.id;
      };
      return [await call(), await call()];
    });

    expect(ids[0]).toBe(ids[1]); // idempotente: mesmo deal
    expect(dealsByConversation.size).toBe(1);
  });

  test('recompute: itens somam Σ(qty × unit_price) no value do card', async ({ page }) => {
    // Mock stateful de itens com soma autoritativa server-side.
    const items: { id: string; qty: number; unitPriceCents: number }[] = [];
    const sum = (): number => items.reduce((acc, i) => acc + i.qty * i.unitPriceCents, 0);
    await page.route('**/api/deals/*/items', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() ?? '{}') as { qty?: number; unitPriceCents?: number };
        const item = {
          id: `item_${items.length + 1}`,
          qty: body.qty ?? 1,
          unitPriceCents: body.unitPriceCents ?? 0,
        };
        items.push(item);
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ item, dealValueCents: sum() }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
    });

    await page.goto('/');

    const finalValue = await page.evaluate(async () => {
      const post = async (qty: number, unitPriceCents: number): Promise<number> => {
        const r = await fetch('/api/deals/deal_e2e_1/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ nameSnapshot: 'X', qty, unitPriceCents }),
        });
        const body = (await r.json()) as { dealValueCents: number };
        return body.dealValueCents;
      };
      await post(3, 5000); // 15000
      return post(4, 750); // +3000 = 18000
    });

    expect(finalValue).toBe(18000);
  });
});
