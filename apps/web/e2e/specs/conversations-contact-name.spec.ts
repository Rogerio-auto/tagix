/**
 * F70-S37 — a inbox mostra o nome do contato, não o número.
 *
 * Hierarquia: nome no sistema → nome do perfil → telefone formatado. A API é mockada:
 * a rota da spec sobrescreve a lista com três contatos nos três níveis.
 *
 * NOTA(host): a app não hidrata no headless-shell deste host Windows; spec escrita para o CI.
 */
import { test, expect } from '../fixtures/test';
import { CONVERSATION } from '../fixtures/seed';

const rows = [
  { ...CONVERSATION, id: 'conv_a', remoteId: '5569999670030', contactDisplayName: 'Maria Souza', contactProfileName: 'Mari' },
  { ...CONVERSATION, id: 'conv_b', remoteId: '5511988887777', contactDisplayName: null, contactProfileName: 'João do Perfil' },
  { ...CONVERSATION, id: 'conv_c', remoteId: '5548991112222', contactDisplayName: null, contactProfileName: null },
];

test.describe('Inbox — nome do contato (F70-S37)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/conversations?*', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ conversations: rows }),
          })
        : route.fallback(),
    );
    await page.route(/\/api\/conversations$/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ conversations: rows }),
          })
        : route.fallback(),
    );
  });

  test('a lista exibe nome, nome do perfil e telefone formatado — nunca o id cru', async ({
    page,
  }) => {
    await page.goto('/conversations');
    const list = page.getByRole('navigation', { name: 'Conversas' });
    await expect(list.getByText('Maria Souza')).toBeVisible();
    await expect(list.getByText('João do Perfil')).toBeVisible();
    await expect(list.getByText('+55 (48) 99111-2222')).toBeVisible();
    await expect(list.getByText('5548991112222')).toHaveCount(0);
  });

  test('a busca avisa que casa por nome ou telefone', async ({ page }) => {
    await page.goto('/conversations');
    await expect(page.getByPlaceholder('Buscar por nome ou telefone…')).toBeVisible();
  });
});
