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

  test('login de conta não confirmada oferece reenviar sem perder o email', async ({ page }) => {
    await page.route('**/auth/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'email_unverified',
          message: 'Confirme seu email para entrar.',
        }),
      }),
    );
    let resendBody: unknown = null;
    await page.route('**/auth/resend-verification', (route) => {
      resendBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const login = new LoginPage(page);
    await login.goto();
    await login.login('ana@empresa.com', 'senha-forte-123');

    await expect(page.getByRole('main').getByText('Confirme seu email para entrar.')).toBeVisible();
    // O email digitado continua no campo.
    await expect(login.email()).toHaveValue('ana@empresa.com');

    await page.getByRole('button', { name: 'Reenviar confirmação' }).click();
    await expect(page.getByText(/Se houver uma conta aguardando confirmação/)).toBeVisible();
    expect(resendBody).toMatchObject({ email: 'ana@empresa.com' });
    // Contagem de 60 s entre reenvios.
    await expect(page.getByRole('button', { name: /Reenviar em \d+ s/ })).toBeDisabled();
  });

  test('?email= pré-preenche o login e mostra o aviso de conta criada', async ({ page }) => {
    await page.goto('/login?email=ana%40empresa.com&from=invite');
    const login = new LoginPage(page);
    await login.waitForHydration();
    await expect(login.email()).toHaveValue('ana@empresa.com');
    await expect(page.getByText('Conta criada. Entre com sua senha.')).toBeVisible();
    await expect(login.password()).toBeFocused();
  });

  test('link de confirmação expirado oferece reenviar em vez de beco', async ({ page }) => {
    await page.route('**/auth/verify', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Link inválido ou expirado.' }),
      }),
    );
    await page.goto('/verify?token=expirado');
    await expect(page.getByText('Link inválido ou expirado')).toBeVisible();
    await expect(page.getByLabel('Email da sua conta')).toBeVisible();
    await page.getByLabel('Email da sua conta').fill('ana@empresa.com');
    await expect(page.getByRole('button', { name: 'Reenviar email' })).toBeEnabled();
  });
});
