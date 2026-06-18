/**
 * Mobile — Tabela→Cards + filtros em sheet + fechar sheet por Esc (F36-S14,
 * MOBILE_UX §2 "Tabela densa" / §4 + §3.1 Sheet).
 *
 * Fluxo-chave em viewport mobile (Pixel): a tabela densa de contatos vira LISTA
 * DE CARDS escaneáveis (ResponsiveTable). Os filtros inline do desktop vão para
 * um bottom-`Sheet` de filtros (botão "Filtros" com badge de contagem). Um filtro
 * ativo vira chip removível acima da lista. O Sheet fecha por `Esc` (equivalente
 * por toque do swipe-down/backdrop — gesto sempre tem equivalente, §6/§4).
 *
 * HERMÉTICO: registra rotas locais de contatos + tags (precedência sobre o
 * fallback genérico). Viewport mobile por `test.use`.
 *
 * AMBIENTE: ver nota de hidratação em `mobile-navigation.spec.ts` — execução e2e
 * pendente de host que hidrata.
 */

import { devices } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { ME } from './fixtures/seed';

test.use({ ...devices['Pixel 5'] });

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function contact(id: string, displayName: string, phone: string) {
  return {
    id,
    workspaceId: ME.workspace.id,
    displayName,
    phone,
    email: null,
    avatarUrl: null,
    notes: null,
    language: null,
    source: 'whatsapp',
    marketingOptIn: true,
    optInMethod: null,
    optInSource: null,
    optInAt: '2026-06-01T00:00:00.000Z',
    optOutAt: null,
    optOutReason: null,
    ownerId: null,
    customFields: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
  };
}

const TAGS = [
  { id: 'tag_vip', name: 'VIP', color: '#1fff13' },
  { id: 'tag_lead', name: 'Lead', color: '#7c3aed' },
];

/**
 * Rotas locais. `tagId` no querystring filtra os contatos server-side (espelha a
 * API real) — para validar que o filtro do sheet realmente afeta a lista.
 */
async function installContactsRoutes(page: Page) {
  const ALL = [
    contact('contact_1', 'Ana Souza', '+55 11 90000-0001'),
    contact('contact_2', 'Bruno Lima', '+55 11 90000-0002'),
  ];
  // contact_1 é VIP; contact_2 não tem tag (filtro por VIP deixa só a Ana).
  const taggedVip = new Set(['contact_1']);

  await page.route(/\/api\/contacts(\?.*)?$/, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const tagId = url.searchParams.get('tagId');
    const rows = tagId === 'tag_vip' ? ALL.filter((c) => taggedVip.has(c.id)) : ALL;
    return json(route, {
      contacts: rows,
      page: 1,
      pageSize: 25,
      total: rows.length,
      totalPages: 1,
    });
  });

  await page.route(/\/api\/tags(\?.*)?$/, (route: Route) => json(route, { tags: TAGS }));
}

test.describe('Mobile — tabela densa vira cards', () => {
  test('contatos renderizam como lista de cards (não tabela)', async ({ page }) => {
    await installContactsRoutes(page);
    await page.goto('/contacts');

    // A lista de cards tem aria-label "Lista" (CardList); a tabela densa NÃO monta.
    await expect(page.getByRole('list', { name: 'Lista' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    // O card é a ação primária (botão), com rowLabel a11y; tocá-lo abre o detalhe.
    const card = page.getByRole('button', { name: 'Abrir contato Ana Souza' });
    await expect(card).toBeVisible();
    await expect(page.getByText('Bruno Lima')).toBeVisible();
  });

  test('filtros vão para um bottom-sheet; aplicar um filtro afeta a lista', async ({ page }) => {
    await installContactsRoutes(page);
    await page.goto('/contacts');
    await expect(page.getByText('Bruno Lima')).toBeVisible();

    // No mobile os filtros não são inline: há um botão "Filtros" que abre o Sheet.
    await page.getByRole('button', { name: 'Abrir filtros' }).click();
    const sheet = page.getByRole('dialog', { name: 'Filtrar contatos' });
    await expect(sheet).toBeVisible();

    // Seleciona a tag VIP dentro do sheet e aplica.
    await sheet.getByLabel('Filtrar por tag').selectOption({ label: 'VIP' });
    await sheet.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByRole('dialog', { name: 'Filtrar contatos' })).toHaveCount(0);

    // A lista respeita o filtro: só a Ana (VIP) permanece; o Bruno some.
    await expect(page.getByText('Ana Souza')).toBeVisible();
    await expect(page.getByText('Bruno Lima')).toHaveCount(0);

    // O filtro ativo vira chip removível acima da lista (escaneável).
    await expect(page.getByText('Tag: VIP')).toBeVisible();
  });

  test('o Sheet de filtros fecha por Esc (equivalente por toque do swipe/backdrop)', async ({
    page,
  }) => {
    await installContactsRoutes(page);
    await page.goto('/contacts');

    await page.getByRole('button', { name: 'Abrir filtros' }).click();
    const sheet = page.getByRole('dialog', { name: 'Filtrar contatos' });
    await expect(sheet).toBeVisible();

    // Esc é um dos caminhos de fechar do Sheet (Esc/swipe-down/backdrop/X).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filtrar contatos' })).toHaveCount(0);

    // Reabre e fecha pelo backdrop (clique fora do painel) — outro caminho de toque.
    await page.getByRole('button', { name: 'Abrir filtros' }).click();
    await expect(page.getByRole('dialog', { name: 'Filtrar contatos' })).toBeVisible();
    // O backdrop cobre o topo da tela (o painel é bottom-sheet ancorado embaixo).
    await page.mouse.click(10, 10);
    await expect(page.getByRole('dialog', { name: 'Filtrar contatos' })).toHaveCount(0);
  });
});
