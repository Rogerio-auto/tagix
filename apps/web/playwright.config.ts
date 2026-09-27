import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config do @hm/web (F10-S03; servidor e rede revistos na F70-S29).
 *
 * Determinismo é a regra: TODA a rede que sai do browser (a API @hm/api proxiada
 * em `/api` e `/auth`, o handshake socket.io em `/socket.io`, e qualquer recurso
 * de WAHA/agent-runtime/Meta) é interceptada pela fixture `mock`, que é automática
 * (`e2e/fixtures/test.ts`) — nenhum serviço real precisa estar de pé.
 *
 * ## Qual servidor (F70-S29)
 *
 * - `E2E_SERVER=start` (padrão no CI): `next start` sobre o build de produção que o
 *   job já gerou. É o que chega ao usuário, não recompila e não recarrega a página no
 *   meio do teste. Com `next dev`, o CI recompilava sem parar (centenas de
 *   "Compiled in …" com o código parado), cada rodada trazia um reload completo da
 *   página e `SyntaxError: Unexpected end of JSON input` no render do servidor — o
 *   teste clicava numa tela que sumia por baixo dele.
 * - `E2E_SERVER=dev` (padrão local): `next dev`, para iterar num spec sem rebuild.
 *
 * O build do modo `start` precisa ser feito com o mesmo `API_PROXY_TARGET` daqui:
 * os rewrites de `/api`, `/auth` e `/socket.io` ficam gravados no build
 * (`.next/routes-manifest.json`), não são lidos em runtime.
 *
 * `PLAYWRIGHT_BASE_URL` aponta para um servidor já no ar e desliga o `webServer`.
 */

const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 3100);
const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;
const REUSE_SERVER = !process.env['CI'] && !process.env['PLAYWRIGHT_BASE_URL'];

const SERVER_MODE = process.env['E2E_SERVER'] ?? (process.env['CI'] ? 'start' : 'dev');
if (SERVER_MODE !== 'start' && SERVER_MODE !== 'dev') {
  throw new Error(`E2E_SERVER inválido: "${SERVER_MODE}" (use "start" ou "dev").`);
}

/**
 * API vista pelo SERVIDOR web (middleware da F70-S28 e rewrites). Porta própria,
 * nunca a 3001 da API de dev: sem ninguém ouvindo, a checagem de sessão do
 * middleware falha aberta e o que escapar do mock do navegador falha alto, em vez de
 * ler dado real. `specs/session-expired.spec.ts` sobe ali uma API de sessão mínima.
 */
const API_PROXY_TARGET = process.env['E2E_API_PROXY_TARGET'] ?? 'http://127.0.0.1:3199';

export default defineConfig({
  testDir: './e2e',
  // Onde o global-setup grava o storageState de auth reaproveitado entre specs.
  outputDir: './e2e/.artifacts/test-results',
  // Os mocks tornam tudo rápido; um teto generoso evita flake em CI lento.
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  // Em CI, falha o build se alguém esquecer um `.only`.
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI']
    ? [['list'], ['html', { outputFolder: './e2e/.artifacts/report', open: 'never' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    // Trace/screenshot/vídeo só quando algo quebra — barato e útil para repro.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Mocks são síncronos e locais; ações não precisam de paciência longa.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    // O build de produção registra o service worker (F61-S01) em localhost, e ele
    // fica LIGADO de propósito: é o que o usuário roda. Não esconde nada do mock —
    // `/api`, `/auth`, `/socket.io`, documentos e RSC são `network-only` SEM
    // `respondWith` (`public/sw-strategy.js`), então o pedido sai do próprio
    // navegador e o `page.route` o intercepta.
  },

  projects: [
    // Prepara o storageState autenticado uma única vez (cookie de sessão).
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: './e2e/.auth/state.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command:
      SERVER_MODE === 'start'
        ? `pnpm --filter @hm/web exec next start -p ${PORT}`
        : `pnpm --filter @hm/web exec next dev -p ${PORT}`,
    // F70-S28: o middleware valida a sessão no SERVIDOR (`<API_PROXY_TARGET>/api/me`),
    // fora do alcance do `page.route`. Ver `API_PROXY_TARGET` acima.
    env: { API_PROXY_TARGET },
    url: BASE_URL,
    reuseExistingServer: REUSE_SERVER,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
