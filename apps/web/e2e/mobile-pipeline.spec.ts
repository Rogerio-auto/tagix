/**
 * Mobile — pipeline / kanban (F36-S14, MOBILE_UX §2 "Kanban").
 *
 * Fluxo-chave em viewport mobile (Pixel): o kanban horizontal+drag (desktop) é
 * inviável no toque → vira SELETOR DE ESTÁGIO (chips role=tab) + lista vertical
 * de cards do estágio ativo. Mover é ação EXPLÍCITA ("Mover para…" em
 * bottom-`Sheet`), equivalente por toque do drag (§2.2). Tocar o card abre o
 * detalhe (§2.1).
 *
 * O efeito de negócio (move-stage) é exercido pela UI de mover (sheet) e
 * conferido no backend simulado — sem depender de gesto de drag (frágil headless).
 *
 * HERMÉTICO: registra rotas locais de pipeline/deals (precedência sobre o
 * fallback genérico). Viewport mobile por `test.use`.
 *
 * AMBIENTE: ver nota de hidratação em `mobile-navigation.spec.ts` — execução e2e
 * pendente de host que hidrata.
 */

import { devices } from '@playwright/test';
import type { Page, Route, Request } from '@playwright/test';
import { test, expect } from './fixtures/test';

test.use({ ...devices['Pixel 5'] });

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function parseBody(request: Request): Record<string, unknown> {
  const raw = request.postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const PIPELINE = {
  id: 'pipe_m',
  name: 'Vendas',
  description: null,
  industry: 'generic',
  isDefault: true,
  isActive: true,
  settings: { custom_fields: [] as unknown[] },
};

function stage(id: string, name: string, position: number, color: string) {
  return {
    id,
    pipelineId: PIPELINE.id,
    name,
    color,
    icon: null,
    position,
    isWon: name === 'Ganho',
    isLost: false,
    probability: null,
    automationRules: [] as unknown[],
    transitionRules: {},
  };
}

const STAGES = [
  stage('stage_lead', 'Lead', 0, '#7c3aed'),
  stage('stage_negotiation', 'Negociação', 1, '#2563eb'),
  stage('stage_won', 'Ganho', 2, '#16a34a'),
];

interface MockDeal {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  title: string;
  valueCents: number;
  currency: string;
  ownerId: string | null;
  position: number;
  customFields: Record<string, unknown>;
  closedAt: string | null;
  closedWon: boolean | null;
}

/** Rotas locais do pipeline mobile. Estado mutável dos deals p/ asserção do move. */
async function installPipelineRoutes(page: Page) {
  const deals: MockDeal[] = [
    {
      id: 'deal_m_1',
      pipelineId: PIPELINE.id,
      stageId: 'stage_lead',
      contactId: 'contact_m_1',
      title: 'Negócio com Ana',
      valueCents: 19900,
      currency: 'BRL',
      ownerId: 'mem_owner_e2e',
      position: 0,
      customFields: {},
      closedAt: null,
      closedWon: null,
    },
  ];

  // GET /api/pipelines → { data, meta } (contrato atual do usePipelines).
  await page.route(/\/api\/pipelines$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, { data: [PIPELINE], meta: { limit: 3, current: 1 } });
  });

  // GET /api/pipelines/:id → detalhe + stages.
  await page.route(/\/api\/pipelines\/[^/?]+$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, { pipeline: PIPELINE, stages: STAGES });
  });

  // GET /api/deals?pipelineId=… → deals do pipeline.
  await page.route(/\/api\/deals(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, { deals });
  });

  // POST /api/deals/:id/move-stage → muta o estado e devolve o deal atualizado.
  await page.route(/\/api\/deals\/[^/]+\/move-stage$/, (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const dealId = new URL(request.url()).pathname.split('/').slice(-2)[0] ?? '';
    const body = parseBody(request);
    const stageId = typeof body['stageId'] === 'string' ? body['stageId'] : '';
    const deal = deals.find((d) => d.id === dealId);
    if (deal && stageId) deal.stageId = stageId;
    return json(route, { deal: deal ?? { id: dealId, stageId } });
  });

  return { deals };
}

test.describe('Mobile — pipeline (seletor de estágio + mover por ação)', () => {
  test('renderiza o seletor de estágio (chips role=tab) e a lista do estágio ativo', async ({
    page,
  }) => {
    await installPipelineRoutes(page);
    await page.goto('/pipeline');

    // No mobile o board é tablist de estágios (não colunas lado a lado).
    const tablist = page.getByRole('tablist', { name: 'Estágios da pipeline' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /Lead/ })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /Ganho/ })).toBeVisible();

    // O estágio inicial (Lead) está ativo e seu deal aparece na lista vertical.
    await expect(tablist.getByRole('tab', { name: /Lead/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Negócio com Ana')).toBeVisible();
  });

  test('mover por ação explícita (sheet "Mover para") atualiza o backend simulado', async ({
    page,
  }) => {
    const ctx = await installPipelineRoutes(page);
    await page.goto('/pipeline');
    await expect(page.getByText('Negócio com Ana')).toBeVisible();

    // Abre o sheet "Mover para…" pelo botão de mover do card (equivalente do drag, §2.2).
    await page.getByRole('button', { name: /Mover "Negócio com Ana" para outro estágio/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Mover para' });
    await expect(sheet).toBeVisible();

    // Escolhe "Ganho" como destino → POST move-stage.
    await sheet.getByRole('button', { name: /Ganho/ }).click();

    // Efeito de negócio: o deal foi para stage_won no backend simulado e o sheet fechou.
    await expect(page.getByRole('dialog', { name: 'Mover para' })).toHaveCount(0);
    expect(ctx.deals.find((d) => d.id === 'deal_m_1')?.stageId).toBe('stage_won');
  });

  test('trocar de estágio no seletor mostra o vazio do estágio sem cards', async ({ page }) => {
    await installPipelineRoutes(page);
    await page.goto('/pipeline');

    const tablist = page.getByRole('tablist', { name: 'Estágios da pipeline' });
    await tablist.getByRole('tab', { name: /Negociação/ }).click();

    // Negociação não tem deals → empty contextual do estágio (não tela toda vazia).
    await expect(page.getByText(/Nenhum negócio em Negociação/)).toBeVisible();
  });
});
