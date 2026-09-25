/**
 * Sessão expirada volta ao login (F70-S28).
 *
 * Relato de produção (25/09): com a sessão encerrada o app não ia ao login e, no PWA,
 * não havia como logar. A checagem de sessão do middleware roda NO SERVIDOR web
 * (`GET <API_PROXY_TARGET>/api/me`), fora do alcance do `page.route` do Playwright.
 * Por isso esta spec sobe uma "API de sessão" mínima na porta que o `webServer` usa
 * como `API_PROXY_TARGET` (ver `playwright.config.ts`): `e2e-token` é válido, qualquer
 * outro token é sessão morta (401). As outras specs não dependem dela — sem este
 * servidor no ar, a checagem falha aberta e o `e2e-token` segue passando.
 */
import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/pom';

const SESSION_API_PORT = Number(process.env['E2E_SESSION_API_PORT'] ?? 3199);
const DEAD_TOKEN = 'token-morto-de-ontem';

let sessionApi: Server | null = null;

// Um worker só para o arquivo: a API de sessão ocupa uma porta fixa.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  sessionApi = createServer((req, res) => {
    const cookie = req.headers.cookie ?? '';
    const valid = req.url === '/api/me' && cookie.includes('hm_session=e2e-token');
    res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valid ? { member: {} } : { message: 'Não autenticado.' }));
  });
  await new Promise<void>((resolve, reject) => {
    sessionApi?.once('error', reject);
    sessionApi?.listen(SESSION_API_PORT, '127.0.0.1', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    sessionApi ? sessionApi.close(() => resolve()) : resolve(),
  );
});

test.describe('Sessão expirada', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    const { hostname } = new URL(baseURL ?? 'http://localhost:3100');
    await context.addCookies([
      {
        name: 'hm_session',
        value: DEAD_TOKEN,
        domain: hostname,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  });

  test('cookie morto → redirect de servidor para o login, com aviso e cookie apagado', async ({
    page,
    context,
  }) => {
    const response = await page.goto('/hoje');

    await expect(page).toHaveURL(/\/login\?next=%2Fhoje&motivo=sessao-expirada$/);
    // Redirect de SERVIDOR: a primeira resposta da navegação já veio do /login —
    // o shell do app nunca chegou a renderizar.
    expect(response?.request().redirectedFrom()?.url()).toMatch(/\/hoje$/);
    await expect(page.getByText('Sua sessão terminou. Entre de novo.')).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'hm_session')).toBeUndefined();
  });

  test('login na primeira tentativa volta para a tela de antes', async ({ page, mock }) => {
    // `mock` liga os mocks de `/auth/login` e `/api/me` do navegador (fixture).
    expect(mock).toBeDefined();
    await page.goto('/conversations');
    await expect(page).toHaveURL(/\/login\?next=%2Fconversations/);

    const login = new LoginPage(page);
    await login.login('ana@empresa.com', 'senha-forte-123');

    await expect(page).toHaveURL(/\/conversations$/);
  });

  test('`next` externo é ignorado (sem open redirect)', async ({ page, mock }) => {
    expect(mock).toBeDefined();
    await page.goto('/login?next=%2F%2Fevil.example%2Fphish');

    const login = new LoginPage(page);
    await login.login('ana@empresa.com', 'senha-forte-123');

    await expect(page).toHaveURL((url) => url.hostname !== 'evil.example' && url.pathname === '/');
  });
});
