/**
 * F38 — Portal do Desenvolvedor (Leadium API). Happy path: a Referencia
 * renderiza a partir do OpenAPI live (mockado em api-mock.ts) agrupada por
 * recurso, e as secoes/exemplos estao presentes. Branding "Leadium API".
 *
 * NOTA(host): nao hidrata no headless-shell local; spec para o CI.
 */
import { test, expect } from '../fixtures/test';

test.describe('F38 — Portal do Desenvolvedor', () => {
  test('renderiza a Leadium API + referencia do OpenAPI', async ({ page }) => {
    await page.goto('/help/developers');
    await expect(page.getByRole('heading', { name: 'Leadium API' })).toBeVisible();

    // Secoes presentes.
    await expect(page.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Autenticacao' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Referencia' })).toBeVisible();

    // Referencia agrupada por recurso (do OpenAPI mockado: contacts, deals).
    await expect(page.getByText('/api/v1/contacts')).toBeVisible();
    await expect(page.getByText('/api/v1/deals')).toBeVisible();
    // Scope extraido da descricao.
    await expect(page.getByText('contacts:read')).toBeVisible();
  });

  test('exemplo copy-paste copia para o clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/help/developers');
    const copyBtn = page.getByRole('button', { name: /copiar/i }).first();
    await copyBtn.click();
    await expect(page.getByText(/copiado/i).first()).toBeVisible();
  });
});
