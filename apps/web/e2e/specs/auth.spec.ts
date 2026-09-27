/**
 * Login flow (F10-S03). Diferente das outras specs, esta NÃO reusa o storageState
 * autenticado — começa deslogada para exercitar o formulário real (LoginForm.tsx)
 * e o redirect pós-login. Os mocks de `/auth/login` e `/api/me` vêm da fixture.
 */

import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/pom';

// Sessão limpa: sem cookie de auth, para testar o login de verdade.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Autenticação', () => {
  test('deslogado é redirecionado para /login', async ({ page }) => {
    await page.goto('/conversations');
    // O destino volta como `next` (validado no login). Sem cookie não há motivo:
    // quem nunca entrou não "teve a sessão encerrada".
    await expect(page).toHaveURL(/\/login\?next=%2Fconversations$/);
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  });

  test('login válido entra no app', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('ana@empresa.com', 'senha-forte-123');

    // O LoginForm faz router.push('/') no sucesso → cai no dashboard.
    await expect(page).toHaveURL((url) => !url.pathname.startsWith('/login'));
    // O TopBar repete o título num <h1> próprio; o da página é o do <main>.
    await expect(page.getByRole('main').getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('credenciais inválidas mostram erro e mantêm na tela de login', async ({ page }) => {
    // Sobrescreve o login para devolver 401 (precede o handler genérico).
    await page.route('**/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Credenciais inválidas' }),
      }),
    );

    const login = new LoginPage(page);
    await login.goto();
    await login.login('errado@empresa.com', 'senha-errada-123');

    // 401 é credencial errada, não falha genérica. O aviso inline fica no formulário
    // (o toast repete o texto fora do `main`).
    await expect(
      page.getByRole('main').getByRole('alert').getByText('Email ou senha incorretos'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('validação client-side bloqueia senha curta', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.waitForHydration();
    await login.email().fill('ana@empresa.com');
    await login.password().fill('123');
    await login.submit().click();

    await expect(page.getByText('A senha tem no mínimo 8 caracteres')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
