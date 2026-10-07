/**
 * Cadastro (F71-S09): o aceite dos Termos é obrigatório e vai para a API com a versão;
 * a tela "verifique seu email" permite reenviar com a contagem de 60 s.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Cadastro', () => {
  async function fill(page: Page): Promise<void> {
    await page.goto('/signup');
    const name = page.getByLabel('Seu nome');
    await expect(name).toBeVisible();
    await name.fill('Ana Souza');
    await page.getByLabel('Email').fill('ana@empresa.com');
    await page.getByLabel('Nome do workspace').fill('Acme');
    await page.getByLabel('Senha').fill('senha-forte-123');
  }

  test('bloqueia o envio sem o aceite dos termos', async ({ page }) => {
    let signupCalls = 0;
    await page.route('**/auth/signup', (route) => {
      signupCalls += 1;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'verification_sent' }),
      });
    });
    await fill(page);
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByText(/Aceite os Termos de uso/)).toBeVisible();
    expect(signupCalls).toBe(0);
    await expect(page.getByRole('link', { name: 'Termos de uso' })).toHaveAttribute(
      'href',
      '/termos',
    );
    await expect(page.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
      'href',
      '/privacidade',
    );
  });

  test('com o aceite envia a versão e mostra o reenvio com contagem', async ({ page }) => {
    let body: Record<string, unknown> = {};
    await page.route('**/auth/signup', (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'verification_sent' }),
      });
    });
    await fill(page);
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByText('Verifique seu email')).toBeVisible();
    expect(body).toMatchObject({ acceptTerms: true, termsVersion: '2026-09-14' });
    // Recém-enviado: o reenvio já nasce em contagem.
    await expect(page.getByRole('button', { name: /Reenviar em \d+ s/ })).toBeDisabled();
  });
});
