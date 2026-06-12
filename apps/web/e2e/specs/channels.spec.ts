/**
 * Canais (F10-S03) — wizard de conexão e estados. Reusa o storageState
 * autenticado (OWNER → vê o botão "Conectar canal").
 */

import { test, expect } from '../fixtures/test';
import { ChannelsPage } from '../pages/pom';

test.describe('Canais', () => {
  test('lista o canal seedado', async ({ page }) => {
    const channels = new ChannelsPage(page);
    await channels.goto();
    await expect(channels.channelRow('WhatsApp Vendas')).toBeVisible();
  });

  test('estado vazio quando não há canais', async ({ page }) => {
    // Sobrescreve o GET para devolver lista vazia.
    await page.route('**/api/channels', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ channels: [] }),
        });
      }
      return route.fallback();
    });

    const channels = new ChannelsPage(page);
    await channels.goto();
    await expect(page.getByText('Nenhum canal conectado')).toBeVisible();
  });

  test('voltar no wizard troca o tipo de provider', async ({ page }) => {
    const channels = new ChannelsPage(page);
    await channels.goto();
    await channels.connectButton().click();

    await page.getByRole('button', { name: /WhatsApp \(WAHA\)/ }).click();
    await expect(page.getByLabel('ID da sessão WAHA')).toBeVisible();

    await page.getByRole('button', { name: 'Trocar tipo' }).click();
    // De volta ao passo 1 — os três providers reaparecem.
    await expect(page.getByRole('button', { name: /WhatsApp \(Meta\)/ })).toBeVisible();
  });

  test('submit fica desabilitado até preencher os campos obrigatórios', async ({ page }) => {
    const channels = new ChannelsPage(page);
    await channels.goto();
    await channels.connectButton().click();
    await page.getByRole('button', { name: /WhatsApp \(WAHA\)/ }).click();

    const submit = page.getByRole('dialog').getByRole('button', { name: 'Conectar canal' });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Nome do canal').fill('X');
    await page.getByLabel('ID da sessão WAHA').fill('s');
    await page.getByLabel('Chave de API').fill('k');
    await expect(submit).toBeEnabled();
  });

  test('erro da API ao conectar mostra toast e mantém o wizard', async ({ page }) => {
    await page.route('**/api/channels/connect', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Sessão WAHA inválida', ref: 'abc123' }),
      }),
    );

    const channels = new ChannelsPage(page);
    await channels.goto();
    await channels.connectWaha('Falha WAHA', 'bad', 'bad');

    await expect(page.getByText('Falha ao conectar')).toBeVisible();
    await expect(page.getByText(/Sessão WAHA inválida/)).toBeVisible();
  });
});
