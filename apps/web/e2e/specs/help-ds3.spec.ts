/**
 * F72-S08 (sub-lote a) — DS 3.0 na Central de Ajuda e no painel `?` de ajuda.
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock`: categorias e artigo da F38), roda o axe sem violação séria/crítica,
 * mede o contraste do texto (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s08/<tela>-<largura>-<tema>.png`.
 *
 * Mais: atalho `/` foca a busca (UX §2.10) sem roubar o `/` de quem digita, e falha de
 * rede no artigo é erro com "tentar de novo", não "artigo não encontrado".
 *
 * AMBIENTE: rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { waitForHydration } from '../pages/pom';
import { capture, expectNoSeriousAxe, expectTextContrast, useTheme, type Theme } from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f72-s08';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

/** `/agents` com lista vazia (o fallback `{}` do mock não é uma lista de agentes). */
async function agentsEmpty(page: Page): Promise<void> {
  await page.route('**/api/agents', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"agents":[]}' })
      : route.fallback(),
  );
}

/** Espera toda animação/transição em curso terminar (o axe e o contraste leem cor computada). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  await page.waitForTimeout(100);
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });

interface Screen {
  name: string;
  path: string;
  setup?: (page: Page) => Promise<void>;
  ready: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  scope?: string;
  full?: boolean;
}

const SCREENS: Screen[] = [
  {
    name: 'ajuda-central',
    path: '/help',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Central de Ajuda')).toBeVisible();
      await expect(page.getByRole('link', { name: /Primeiros passos/ })).toBeVisible();
    },
  },
  {
    name: 'ajuda-busca',
    path: '/help',
    ready: async (page) => {
      await expect(h1(page, 'Central de Ajuda')).toBeVisible();
      await waitForHydration(page.getByLabel('Buscar artigos de ajuda'));
    },
    open: async (page) => {
      await page.getByLabel('Buscar artigos de ajuda').fill('agente');
      await expect(page.getByRole('list', { name: 'Resultados da busca' })).toBeVisible();
      await expect(page.getByText('1 artigo encontrado')).toBeVisible();
    },
  },
  {
    name: 'ajuda-categoria',
    path: '/help?category=cat_e2e_1',
    ready: async (page) => {
      await expect(h1(page, 'Primeiros passos')).toBeVisible();
      await expect(page.getByRole('link', { name: /Como criar um agente/ })).toBeVisible();
    },
  },
  {
    name: 'ajuda-artigo',
    path: '/help/como-criar-um-agente',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Como criar um agente')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Passo a passo' })).toBeVisible();
    },
  },
  {
    name: 'ajuda-painel',
    path: '/agents',
    setup: agentsEmpty,
    ready: async (page) => {
      await waitForHydration(page.getByRole('button', { name: 'Ajuda: Agentes' }));
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Ajuda: Agentes' }).click();
      await expect(page.getByRole('complementary', { name: 'Agentes' })).toBeVisible();
    },
    scope: '[role="complementary"]',
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Ajuda DS 3.0 — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          test.setTimeout(90_000);
          await useTheme(page, theme);
          await screen.setup?.(page);
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page);
          await screen.open?.(page);
          // Entrada concluída antes de medir (o axe lê cor computada).
          await settled(page);

          const label = `${screen.name} ${size.width} ${theme}`;
          await expectNoSeriousAxe(page, { label });
          await expectTextContrast(page, screen.scope ?? 'main', label);
          await capture(page, SHOTS, screen.name, theme, { full: Boolean(screen.full) && !screen.scope });
        });
      }
    });
  }
}

test.describe('Central de Ajuda — teclado e erro', () => {
  test('"/" foca a busca; dentro de um campo, "/" é texto', async ({ page }) => {
    await page.goto('/help');
    const search = page.getByLabel('Buscar artigos de ajuda');
    await waitForHydration(search);
    await expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await page.keyboard.type('a/b');
    await expect(search).toHaveValue('a/b');
  });

  test('falha de rede no artigo: erro com "Tentar novamente", não "não encontrado"', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/help/articles/quebrado', (route) => {
      calls += 1;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
    });
    await page.goto('/help/quebrado');
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert.getByText('Não foi possível abrir o artigo')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Artigo não encontrado')).toHaveCount(0);
    const before = calls;
    await alert.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect.poll(() => calls).toBeGreaterThan(before);
  });

  test('artigo inexistente: "Artigo não encontrado" com volta à Central', async ({ page }) => {
    await page.route('**/api/help/articles/sumiu', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' }),
    );
    await page.goto('/help/sumiu');
    await expect(page.getByText('Artigo não encontrado')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Voltar à Central de Ajuda' })).toHaveAttribute('href', '/help');
  });
});
