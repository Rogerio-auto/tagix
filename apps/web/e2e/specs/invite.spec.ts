/**
 * F71-S07 — aceite de convite SEM conta (API mockada). Começa deslogada. O ponto de
 * segurança que esta spec prova: a prova de posse do email chega no FRAGMENTO, sai da
 * URL na hora, viaja só no corpo do POST e nunca na query nem no storage.
 */

import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/test';

test.use({ storageState: { cookies: [], origins: [] } });

const TOKEN = 'tok_abc123XYZ';
const PROOF_HASH = 'pkce_abcdef123456';

const PREVIEW_NEW_ACCOUNT = {
  workspaceName: 'Acme Ltda',
  inviterName: 'Ana Souza',
  role: 'AGENT',
  emailMasked: 'b***@acme.com',
  requiresEmailProof: true,
  expiresAt: '2030-01-01T00:00:00.000Z',
};

async function mockPublicInvite(page: Page, preview: object | null): Promise<void> {
  // Sem sessão: a tela só precisa saber que ninguém está logado.
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"session_invalid"}' }),
  );
  await page.route('**/auth/invite/preview', (route) =>
    preview
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview) })
      : route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invite_not_found', message: 'Convite não encontrado.' }),
        }),
  );
}

test.describe('Convite — aceite sem conta', () => {
  test('com o fragmento do email: limpa a URL, cria nome e senha, envia a prova no corpo', async ({
    page,
  }) => {
    await mockPublicInvite(page, PREVIEW_NEW_ACCOUNT);
    let accepted: Request | null = null;
    await page.route('**/auth/invite/accept', (route) => {
      accepted = route.request();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ next: '/login?email=bia%40acme.com' }),
      });
    });

    await page.goto(`/convite/${TOKEN}#token_hash=${PROOF_HASH}&type=invite`);

    await expect(page.getByRole('heading', { level: 1, name: 'Acme Ltda' })).toBeVisible();
    await expect(page.getByText('Atendente')).toBeVisible();
    // O fragmento some da barra de endereço assim que a página lê a prova.
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    expect(page.url()).not.toContain('token_hash');

    await page.getByLabel('Seu nome').fill('Bia Lima');
    await page.getByLabel('Crie uma senha').fill('senha-forte-2026');
    await page.getByRole('button', { name: 'Criar conta e entrar' }).click();

    await expect(page.getByText('Conta criada', { exact: true })).toBeVisible();
    // A tela anexa `from=invite` ao `next` da API: o login sabe que a conta acabou de nascer.
    const enter = page.getByRole('link', { name: 'Entrar' });
    await expect(enter).toHaveAttribute('href', '/login?email=bia%40acme.com&from=invite');

    expect(accepted).not.toBeNull();
    const req = accepted as unknown as Request;
    expect(req.url()).not.toContain(PROOF_HASH);
    expect(req.url()).not.toContain(TOKEN);
    expect(req.postDataJSON()).toEqual({
      token: TOKEN,
      name: 'Bia Lima',
      password: 'senha-forte-2026',
      emailProof: { tokenHash: PROOF_HASH, type: 'invite' },
    });
    // Nada de token em storage.
    const stored = await page.evaluate(() =>
      JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
    );
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(PROOF_HASH);

    // Integração S07↔S09: o login abre com o email preenchido e o aviso de conta criada.
    await enter.click();
    await expect(page).toHaveURL(/\/login\?email=bia%40acme\.com&from=invite$/);
    await expect(page.getByText('Conta criada. Entre com sua senha.')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('bia@acme.com');
  });

  test('senha fraca é barrada no formulário, sem chamar a API', async ({ page }) => {
    await mockPublicInvite(page, PREVIEW_NEW_ACCOUNT);
    let called = false;
    await page.route('**/auth/invite/accept', (route) => {
      called = true;
      return route.abort();
    });
    await page.goto(`/convite/${TOKEN}#token_hash=${PROOF_HASH}&type=invite`);
    await page.getByLabel('Seu nome').fill('Bia Lima');
    await page.getByLabel('Crie uma senha').fill('curta');
    await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
    await expect(page.getByText('A senha precisa de ao menos 10 caracteres')).toBeVisible();
    expect(called).toBe(false);
  });

  test('sem o fragmento (link copiado): pede o email de confirmação e orienta', async ({ page }) => {
    await mockPublicInvite(page, PREVIEW_NEW_ACCOUNT);
    let sentBody: unknown = null;
    await page.route('**/auth/invite/send-email', (route) => {
      sentBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, emailMasked: 'b***@acme.com' }),
      });
    });

    await page.goto(`/convite/${TOKEN}`);
    await page.getByRole('button', { name: 'Receber email de confirmação' }).click();

    await expect(page.getByText('Email enviado')).toBeVisible();
    await expect(page.getByText('Aceitar convite')).toBeVisible();
    // Cooldown de 1 minuto antes de reenviar.
    await expect(page.getByRole('button', { name: /Reenviar em \d+s/ })).toBeDisabled();
    expect(sentBody).toEqual({ token: TOKEN });
  });

  test('convite inválido ou expirado: estado claro, sem detalhar o motivo', async ({ page }) => {
    await mockPublicInvite(page, null);
    await page.goto(`/convite/${TOKEN}`);
    await expect(
      page.getByRole('heading', { name: 'Este convite não está mais disponível' }),
    ).toBeVisible();
    await expect(page.getByText(/Peça um novo convite/)).toBeVisible();
  });
});
