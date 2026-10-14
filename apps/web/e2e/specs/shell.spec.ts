/**
 * F72-S03 — casca do desktop (Sidebar 248px, TopBar 68px, ⌘K), nos dois temas.
 * Rede 100% mockada pela fixture. Ver nota de ambiente em `mobile-nav.spec.ts`.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';

test.use({ viewport: { width: 1440, height: 900 } });

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Navegação principal' });

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Shell desktop — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('hm:theme', t), theme);
    });

    test('sidebar de 248px e topbar de 68px, hairlines alinhadas', async ({ page }) => {
      await page.goto('/');
      const aside = sidebar(page);
      await expect(aside).toBeVisible();
      const width = await aside.evaluate((el) => Math.round(el.getBoundingClientRect().width));
      expect(width).toBe(248);
      const height = await page
        .locator('[data-topbar]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().height));
      expect(height).toBe(68);
    });

    test('grupos de navegação e um único item ativo com aria-current', async ({ page }) => {
      await page.goto('/conversations');
      const aside = sidebar(page);
      for (const group of ['Visão geral', 'Operação', 'Automação', 'Gestão']) {
        await expect(aside.getByText(group, { exact: true }).first()).toBeVisible();
      }
      await expect(aside.getByRole('link', { name: /^Inbox/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(aside.locator('[aria-current="page"]')).toHaveCount(1);
    });

    test('teclado: o link recebe anel de foco visível (outline, não só sombra)', async ({
      page,
    }) => {
      await page.goto('/');
      const link = sidebar(page).getByRole('link', { name: 'Home' });
      await page.keyboard.press('Tab'); // modalidade teclado => :focus-visible
      await link.focus();
      await expect(link).toBeFocused();
      const ring = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
      });
      expect(ring.style).toBe('solid');
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.color).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('Ctrl/Cmd+K e o gatilho abrem a paleta; Esc fecha e devolve o foco', async ({ page }) => {
      await page.goto('/');
      await page.keyboard.press('ControlOrMeta+k');
      const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
      await expect(palette).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(palette).toHaveCount(0);

      const trigger = page.getByRole('button', { name: 'Buscar ou ir para' });
      await trigger.click();
      await expect(palette).toBeVisible();
      await page.keyboard.type('agen');
      await expect(palette.getByRole('option', { name: /Agenda/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('recolher a sidebar mantém os links com nome acessível', async ({ page }) => {
      await page.goto('/');
      await sidebar(page).getByRole('button', { name: 'Recolher menu' }).click();
      await expect(sidebar(page)).toHaveAttribute('data-collapsed', 'true');
      await expect(sidebar(page).getByRole('link', { name: 'Inbox' })).toBeVisible();
    });

    test('captura 1440', async ({ page }) => {
      await page.goto('/conversations');
      await expect(sidebar(page)).toBeVisible();
      await expect(sidebar(page).getByRole('link', { name: /^Inbox/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.screenshot({ path: `e2e/.artifacts/f72-s03/shell-${theme}.png`, animations: 'disabled' });
    });
  });
}

test.describe('Shell — prefers-reduced-motion', () => {
  test('recolher a sidebar não anima (transições zeradas)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const aside = sidebar(page);
    const link = aside.getByRole('link', { name: 'Home' });
    // `motion-reduce:transition-none` zera a propriedade (a duração fica declarada).
    const property = await link.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(property).toBe('none');
    const label = link.locator('span').first();
    const labelProperty = await label.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(labelProperty).toBe('none');
  });
});

test.describe('Shell — regra do §07', () => {
  test('a casca não expõe custo de LLM ou infraestrutura', async ({ page }) => {
    await page.goto('/');
    const chrome = [
      await sidebar(page).innerText(),
      await page.locator('[data-topbar]').innerText(),
    ]
      .join(' ')
      .toLowerCase();
    expect(chrome).not.toMatch(/custo|cost|llm|infra|\btokens?\b/);
  });
});
