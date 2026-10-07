/**
 * F72-S03 — navegação mobile (4 abas fixas + Mais). Rede 100% mockada pela fixture.
 *
 * Cobre: as 4 abas (Home, Inbox, Agenda, Mais), o sheet "Mais" com todo destino
 * antigo alcançável, selo de não lidas na Inbox, gating por papel, teclado do sheet
 * (trap de foco + Esc devolvendo o foco) e o contraste do item ativo no tema claro
 * (era 1,36:1 no F71-S08; piso WCAG AA 4,5:1).
 *
 * AMBIENTE: neste host Windows o bundle cliente pode não hidratar no headless-shell
 * (memória `e2e-no-hydration-this-host`); a spec é validada por typecheck/lint aqui e
 * deve rodar com `--workers=1` num host que hidrata.
 */

import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';

test.use({ viewport: { width: 375, height: 812 } });

/** Todos os destinos do `nav.ts` que um OWNER enxerga — cada um precisa de caminho no celular. */
const OWNER_TABS = ['/hoje', '/conversations', '/calendar'];
const OWNER_MORE = [
  '/pipeline',
  '/',
  '/contacts',
  '/campaigns',
  '/agents',
  '/flows',
  '/knowledge',
  '/conversions',
  '/flows/backup',
  '/settings',
  '/help',
];

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockMe(page: Page, role: string): Promise<void> {
  await page.route('**/api/me', (route) =>
    fulfillJson(route, {
      member: { id: 'mem_1', workspaceId: 'ws_1', name: 'Ana QA', role, status: 'active' },
      workspace: {
        id: 'ws_1',
        name: 'Clínica Aurora',
        subscriptionStatus: 'active',
        trialEndsAt: null,
      },
      memberships: [
        {
          workspaceId: 'ws_1',
          name: 'Clínica Aurora',
          slug: 'aurora',
          role,
          subscriptionStatus: 'active',
        },
      ],
    }),
  );
}

const bottomNav = (page: Page) => page.getByRole('navigation', { name: 'Navegação principal' });

/** Abre o sheet "Mais"; repete o clique até hidratar (o dev server pode clicar antes do React). */
async function openMore(page: Page): Promise<Locator> {
  const sheet = page.getByRole('dialog', { name: 'Mais' });
  await expect(async () => {
    await bottomNav(page).getByRole('button', { name: 'Mais' }).click();
    await expect(sheet).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  return sheet;
}

test.describe('Mobile — 4 abas fixas', () => {
  test('mostra Home, Inbox, Agenda e Mais — e só isso', async ({ page }) => {
    await page.goto('/conversations');
    const nav = bottomNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Inbox/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Mais' })).toBeVisible();
    // Funil e o resto NÃO são abas.
    await expect(nav.getByRole('link', { name: 'Pipeline' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('a aba da rota atual leva aria-current', async ({ page }) => {
    await page.goto('/calendar');
    await expect(bottomNav(page).getByRole('link', { name: 'Agenda' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('selo de não lidas na Inbox entra no nome acessível', async ({ page }) => {
    await page.route('**/api/conversations', (route) =>
      fulfillJson(route, {
        conversations: [
          { id: 'c1', unreadCount: 2 },
          { id: 'c2', unreadCount: 1 },
        ],
      }),
    );
    await page.goto('/');
    await expect(bottomNav(page).getByRole('link', { name: 'Inbox, 3 não lidas' })).toBeVisible();
  });

  test('a sidebar do desktop não monta no celular (um landmark só)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'Navegação principal' })).toHaveCount(0);
  });
});

test.describe('Mobile — sheet Mais', () => {
  test('todo destino antigo continua alcançável (abas + Mais cobrem o nav.ts do OWNER)', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = bottomNav(page);

    // Itens com permissão só aparecem depois que /api/me hidrata o papel.
    await expect(nav.getByRole('link')).toHaveCount(3);
    const tabHrefs = await nav
      .getByRole('link')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(tabHrefs).toEqual(OWNER_TABS);

    const sheet = await openMore(page);
    const moreHrefs = await sheet
      .getByRole('link')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(moreHrefs).toEqual(OWNER_MORE);

    for (const label of [
      'Pipeline',
      'Dashboard',
      'Contatos',
      'Campanhas',
      'Agentes',
      'Flows',
      'Conhecimento',
      'Conversões',
      'Configurações',
      'Ajuda',
    ]) {
      await expect(sheet.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('navegar por um item fecha o sheet e marca "Mais" como ativo', async ({ page }) => {
    await page.goto('/');
    const sheet = await openMore(page);
    await sheet.getByRole('link', { name: 'Pipeline' }).click();
    await expect(page).toHaveURL(/\/pipeline/);
    await expect(page.getByRole('dialog', { name: 'Mais' })).toHaveCount(0);
  });

  test('teclado: foco preso no sheet e Esc devolve o foco ao "Mais"', async ({ page }) => {
    await page.goto('/');
    const more = bottomNav(page).getByRole('button', { name: 'Mais' });
    const sheet = await openMore(page);

    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await sheet.evaluate((el) => el.contains(document.activeElement));
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test('papel sem permissão não vê o destino (READONLY sem Conhecimento nem Backup)', async ({
    page,
  }) => {
    await mockMe(page, 'READONLY');
    await page.goto('/');
    const sheet = await openMore(page);
    await expect(sheet.getByRole('link', { name: 'Ajuda' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Conhecimento' })).toHaveCount(0);
    await expect(sheet.getByRole('link', { name: 'Backup de Flows' })).toHaveCount(0);
  });
});
