/**
 * Inbox / conversa (F10-S03) — envio, otimismo e bloqueio de janela 24h.
 */

import { test, expect } from '../fixtures/test';
import { ConversationsPage, expectOutboundBubble } from '../pages/pom';
import { CONVERSATION } from '../fixtures/seed';

test.describe('Conversas', () => {
  test('lista conversas e abre uma pelo item', async ({ page }) => {
    const inbox = new ConversationsPage(page);
    await inbox.goto();
    await expect(inbox.chatItem(CONVERSATION.remoteId)).toBeVisible();
    await inbox.chatItem(CONVERSATION.remoteId).click();
    await expect(page).toHaveURL(new RegExp(`/conversations/${CONVERSATION.id}$`));
  });

  test('enviar texto insere a bolha do atendente', async ({ page, mock }) => {
    const inbox = new ConversationsPage(page);
    await inbox.open(CONVERSATION.id);

    const before = mock.messages.length;
    await inbox.sendText('Mensagem de teste');
    await expectOutboundBubble(page, 'Mensagem de teste');
    expect(mock.messages.length).toBeGreaterThan(before);
  });

  test('composer limpa após enviar', async ({ page }) => {
    const inbox = new ConversationsPage(page);
    await inbox.open(CONVERSATION.id);
    await inbox.sendText('Vai limpar');
    await expect(inbox.composer()).toHaveValue('');
  });

  test('janela 24h fechada bloqueia o composer', async ({ page }) => {
    // Sobrescreve o estado da janela: WhatsApp fora da janela exige template.
    await page.route('**/api/conversations/*/window', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          window: {
            provider: 'meta_whatsapp',
            isOpen: false,
            expiresAt: '2026-06-11T13:00:00.000Z',
            requiresTemplate: true,
            messageTag: null,
          },
        }),
      }),
    );

    const inbox = new ConversationsPage(page);
    await inbox.open(CONVERSATION.id);

    // O placeholder muda e o textarea fica desabilitado.
    const blocked = page.getByPlaceholder(/Janela de 24h encerrada/);
    await expect(blocked).toBeVisible();
    await expect(blocked).toBeDisabled();
  });

  test('falha de envio mostra erro e faz rollback otimista', async ({ page }) => {
    await page.route('**/api/conversations/*/messages', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Falha no provedor', ref: 'xyz789' }),
        });
      }
      return route.fallback();
    });

    const inbox = new ConversationsPage(page);
    await inbox.open(CONVERSATION.id);
    await inbox.sendText('Vai falhar');

    await expect(page.getByText('Não foi possível enviar')).toBeVisible();
    // Rollback: a bolha otimista some.
    await expect(page.locator('[data-direction="outbound"]').filter({ hasText: 'Vai falhar' })).toHaveCount(0);
  });
});
