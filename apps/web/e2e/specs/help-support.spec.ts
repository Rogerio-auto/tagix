/**
 * F38 — Central de Ajuda + Suporte (happy paths). Cobre o leitor /help (home,
 * categoria, artigo com render Markdown sanitizado e feedback) e o chat de
 * suporte do membro (abrir thread, listar). A rede /api/** e mockada pelo
 * fixture (api-mock.ts) — inclui as rotas F38.
 *
 * NOTA(host): a app nao hidrata no headless-shell deste host Windows (memoria
 * de e2e-no-hydration); estas specs sao escritas para o CI. Validacao local da
 * fase: pnpm typecheck + lint + build + unit (ver tasks/COMMS.md).
 */
import { test, expect } from '../fixtures/test';

test.describe('F38 — Central de Ajuda (leitor)', () => {
  test('home lista categorias e busca; artigo renderiza + feedback', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Central de Ajuda' })).toBeVisible();
    await expect(page.getByText('Primeiros passos')).toBeVisible();

    // Abre o artigo direto por slug.
    await page.goto('/help/como-criar-um-agente');
    await expect(page.getByRole('heading', { name: 'Como criar um agente' })).toBeVisible();
    // Render Markdown: o ## vira um heading (nao texto cru com '##').
    await expect(page.getByRole('heading', { name: 'Passo a passo' })).toBeVisible();
    // Feedback "isso ajudou?".
    await page.getByRole('button', { name: /sim/i }).click();
    await expect(page.getByText(/obrigado pelo seu feedback/i)).toBeVisible();
  });

  test('navega por categoria a partir da home', async ({ page }) => {
    await page.goto('/help?category=cat_e2e_1');
    await expect(page.getByText('Como criar um agente')).toBeVisible();
  });
});

test.describe('F38 — Chat de suporte do membro', () => {
  test('abre uma conversa de suporte pelo launcher', async ({ page }) => {
    await page.goto('/help');
    await page.getByRole('button', { name: /falar com o suporte/i }).click();
    // Overlay aberto.
    await expect(page.getByRole('dialog', { name: /suporte leadium/i })).toBeVisible();
    // Nova conversa.
    await page.getByRole('button', { name: /nova/i }).first().click();
    await page.getByLabel(/assunto/i).fill('Nao consigo conectar o WhatsApp');
    await page.getByLabel(/mensagem/i).fill('Da erro ao escanear o QR.');
    await page.getByRole('button', { name: /enviar/i }).click();
    // Entrou na thread (mensagem do membro visivel).
    await expect(page.getByText('Da erro ao escanear o QR.')).toBeVisible();
  });
});
