/**
 * Mobile — casca/nav (F36-S14, MOBILE_UX §1/§2 "Casca/nav").
 *
 * Fluxo-chave: em viewport mobile (Pixel) o app monta a BOTTOM TAB BAR (zona do
 * polegar), não a Sidebar. Os destinos primários navegam; o overflow vive num
 * `Sheet` "Mais". A bottom nav é gated por role (a fonte é `visibleNavItems`).
 *
 * HERMÉTICO: estende a fixture `test` (auth via storageState + mocks base já
 * ligados ANTES da navegação). O viewport mobile é fixado por `test.use`. Estas
 * rotas locais (quando há) vencem o fallback genérico da fixture por precedência.
 *
 * AMBIENTE (honestidade — memória `e2e-no-hydration-this-host`): neste host
 * Windows o bundle cliente do Next NÃO hidrata no headless-shell, então NENHUM
 * spec e2e do projeto fica verde aqui (inclusive os antigos de desktop). Este
 * spec é validado por `pnpm typecheck`/`tsc` e deve rodar verde num host onde o
 * app hidrata. NÃO marcamos verde de execução localmente.
 */

import { devices } from '@playwright/test';
import { test, expect } from './fixtures/test';

// Viewport mobile real (Pixel 5 → 393×851, < md=768 → padrões mobile ativos).
test.use({ ...devices['Pixel 5'] });

test.describe('Mobile — bottom nav (thumb-first)', () => {
  test('monta a bottom tab bar (e não a sidebar) no viewport mobile', async ({ page }) => {
    await page.goto('/');

    // A nav primária mobile é a bottom tab bar com aria-label estável.
    const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(bottomNav).toBeVisible();

    // Destinos sempre visíveis ao OWNER: Dashboard + Conversas estão entre os
    // primeiros 4 slots (BOTTOM_NAV_PRIMARY_COUNT) — aparecem com label, não só ícone.
    await expect(bottomNav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Conversas' })).toBeVisible();
  });

  test('navega por um destino primário (Conversas)', async ({ page }) => {
    await page.goto('/');
    const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' });

    await bottomNav.getByRole('link', { name: 'Conversas' }).click();
    await expect(page).toHaveURL(/\/conversations$/);

    // O destino ativo é marcado com aria-current (feedback de localização).
    await expect(bottomNav.getByRole('link', { name: 'Conversas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('botão "Mais" abre o Sheet de overflow e navega por um destino secundário', async ({
    page,
  }) => {
    await page.goto('/');
    const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' });

    // Ao OWNER há mais destinos que os 4 slots → existe o botão "Mais" (Sheet de overflow).
    const more = bottomNav.getByRole('button', { name: 'Mais' });
    await expect(more).toBeVisible();
    await more.click();

    // O overflow abre num Sheet (role=dialog) com os destinos restantes.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();

    // "Configurações" é o último item da nav → sempre cai no overflow. Navega e fecha.
    await sheet.getByRole('link', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a sidebar do desktop NÃO está montada no mobile (regressão de estrutura)', async ({
    page,
  }) => {
    await page.goto('/');
    // A estrutura troca por `isMobile` (AppLayout): no mobile a Sidebar não monta.
    // Sentinela: a nav primária visível é a bottom tab bar; não há landmark de nav
    // duplicado com a Sidebar (que tem o mesmo aria-label) coexistindo.
    const navs = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(navs).toHaveCount(1);
    await expect(navs).toBeVisible();
  });
});
