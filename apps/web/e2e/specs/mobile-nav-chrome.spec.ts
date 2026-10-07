/**
 * F72-S03 — cromo da navegação mobile: contraste do item ativo nos dois temas
 * (era 1,36:1 no claro, F71-S08; piso WCAG AA 4,5:1) e TopBar sob a faixa de conta
 * (o `pt-safe` não pode repetir, F71-S16). Rede 100% mockada pela fixture.
 * Ver nota de ambiente em `mobile-nav.spec.ts`.
 */

import type { Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';

test.use({ viewport: { width: 375, height: 812 } });

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`rótulo da aba ativa tem contraste >= 4,5:1 — tema ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    await page.goto('/conversations');
    const ratio = await page.evaluate(() => {
      const link = document.querySelector(
        'nav[aria-label="Navegação principal"] a[aria-current="page"]',
      );
      if (!link) return 0;
      const channel = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const parse = (css: string): number[] => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r = 0, g = 0, b = 0]: number[]): number =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      // A barra é `surface-glass` sobre o conteúdo; mede contra `--surface` (opaco).
      const probe = document.createElement('span');
      probe.style.color = 'var(--surface)';
      document.body.appendChild(probe);
      const bg = parse(getComputedStyle(probe).color);
      probe.remove();
      const fg = parse(getComputedStyle(link).color);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

test('com faixa de conta, a TopBar não repete o recuo de safe-area', async ({ page }) => {
  await page.route('**/api/me', (route) =>
    fulfillJson(route, {
      member: { id: 'mem_1', workspaceId: 'ws_1', name: 'Ana QA', role: 'OWNER', status: 'active' },
      workspace: {
        id: 'ws_1',
        name: 'Clínica Aurora',
        subscriptionStatus: 'expired',
        trialEndsAt: null,
      },
      memberships: [],
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-banner]').first()).toBeVisible();
  const topbar = page.locator('[data-topbar]');
  await expect(topbar).toBeVisible();
  await expect.poll(() => topbar.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
});

for (const theme of ['dark', 'light'] as const) {
  test(`captura 375 com o sheet Mais — ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    await page.goto('/conversations');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(nav.getByRole('link')).toHaveCount(3);
    await page.screenshot({ path: `e2e/.artifacts/f72-s03/mobile-${theme}.png`, animations: 'disabled' });
    const sheet = page.getByRole('dialog', { name: 'Mais' });
    await expect(async () => {
      await nav.getByRole('button', { name: 'Mais' }).click();
      await expect(sheet).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await page.waitForTimeout(500); // fim da animação do sheet
    await page.screenshot({ path: `e2e/.artifacts/f72-s03/mobile-more-${theme}.png`, animations: 'disabled' });
  });
}
