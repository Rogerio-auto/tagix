import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config do @hm/web (F10-S03).
 *
 * Determinismo é a regra: TODA a rede que sai do browser (a API @hm/api proxiada
 * em `/api` e `/auth`, o handshake socket.io em `/socket.io`, e qualquer recurso
 * de WAHA/agent-runtime/Meta) é interceptada nas fixtures — nenhum serviço real
 * precisa estar de pé para os specs rodarem.
 *
 * O alvo é o próprio Next dev server. Em ambiente sem servidor já no ar, o
 * `webServer` sobe `next dev` e espera o `baseURL`. Pode ser desligado apontando
 * `PLAYWRIGHT_BASE_URL` para um servidor já rodando (CI ou dev local).
 */

const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 3100);
const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;
const REUSE_SERVER = !process.env['CI'] && !process.env['PLAYWRIGHT_BASE_URL'];

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
    // `next dev` na porta de teste. O proxy de /api é irrelevante: as fixtures
    // interceptam tudo antes de sair do browser, então a API pode estar offline.
    command: `pnpm --filter @hm/web exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: REUSE_SERVER,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
