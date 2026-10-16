/**
 * F72-S08 (sub-lote a) — DS 3.0 nas telas de acesso e nas páginas públicas: login,
 * cadastro, verificação, redefinição de senha, convite, termos, privacidade e exclusão
 * de dados.
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s08/<tela>-<largura>-<tema>.png`.
 *
 * Mais: o H1 acompanha o estado (cadastro → "Verifique seu email", ressalva da F71-S09;
 * fases da verificação; senha), e o título novo recebe o foco quando a mesma rota troca
 * de tela.
 *
 * Sessão limpa: estas telas são de quem ainda não entrou.
 *
 * AMBIENTE: rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { waitForHydration } from '../pages/pom';
import { capture, expectNoSeriousAxe, expectTextContrast, useTheme, type Theme } from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f72-s08';

test.use({ storageState: { cookies: [], origins: [] } });
// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const TOKEN = 'tok_abc123XYZ';
const PROOF_HASH = 'pkce_abcdef123456';
const PREVIEW = {
  workspaceName: 'Clínica Aurora',
  inviterName: 'Ana Souza',
  role: 'AGENT',
  emailMasked: 'b***@aurora.test',
  requiresEmailProof: true,
  expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
};

interface Scenario {
  /** Resposta de `POST /auth/verify`: aceito ou recusado. */
  verify?: 'ok' | 'expired';
  /** `POST /auth/login` devolve 401. */
  badLogin?: boolean;
  /** Preview do convite; `null` = 404 (inválido/expirado). */
  invite?: object | null;
}

/** Rotas deste spec (precedem o roteador genérico da fixture). */
async function installRoutes(page: Page, scenario: Scenario = {}): Promise<void> {
  await page.route('**/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/verify') {
      return scenario.verify === 'expired'
        ? json(route, { message: 'Link inválido ou expirado.' }, 400)
        : json(route, { ok: true });
    }
    if (path === '/auth/login' && scenario.badLogin) {
      return json(route, { message: 'Credenciais inválidas' }, 401);
    }
    if (path === '/auth/signup') return json(route, { status: 'verification_sent' }, 202);
    if (path === '/auth/invite/preview' && scenario.invite !== undefined) {
      return scenario.invite
        ? json(route, scenario.invite)
        : json(route, { error: 'invite_not_found', message: 'Convite não encontrado.' }, 404);
    }
    if (path === '/auth/invite/send-email') return json(route, { ok: true, emailMasked: 'b***@aurora.test' });
    return route.fallback();
  });
  if (scenario.invite !== undefined) {
    // Convite sem sessão: a tela só precisa saber que ninguém está logado.
    await page.route('**/api/me', (route) => json(route, { error: 'session_invalid' }, 401));
  }
  await page.route('**/api/meta/data-deletion/**', (route) =>
    json(route, {
      status: 'completed',
      requestedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      completedAt: new Date(Date.now() - 86_400_000).toISOString(),
    }),
  );
}

/** Espera toda animação/transição em curso terminar (o axe e o contraste leem cor computada). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  await page.waitForTimeout(100);
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });

/** Espera o formulário responder ao React antes de interagir (ver `waitForHydration`). */
async function hydrated(page: Page, button: string): Promise<void> {
  await waitForHydration(page.getByRole('button', { name: button, exact: true }));
}

interface Screen {
  name: string;
  path: string;
  scenario?: Scenario;
  ready: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  /** Telas públicas rolam: captura também a página inteira. */
  full?: boolean;
}

const SCREENS: Screen[] = [
  {
    name: 'login',
    path: '/login',
    ready: async (page) => {
      await expect(h1(page, 'Entrar')).toBeVisible();
      await hydrated(page, 'Entrar');
    },
  },
  {
    name: 'login-sessao-expirada',
    path: '/login?motivo=sessao-expirada',
    ready: async (page) => {
      await expect(page.getByText('Sua sessão terminou. Entre de novo.')).toBeVisible();
    },
  },
  {
    name: 'login-erro',
    path: '/login',
    scenario: { badLogin: true },
    ready: async (page) => {
      await expect(h1(page, 'Entrar')).toBeVisible();
      await hydrated(page, 'Entrar');
    },
    open: async (page) => {
      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByLabel('Senha').fill('senha-errada-123');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.getByRole('main').getByRole('alert').getByText('Email ou senha incorretos')).toBeVisible();
    },
  },
  {
    name: 'cadastro',
    path: '/signup',
    ready: async (page) => {
      await expect(h1(page, 'Criar conta')).toBeVisible();
      await hydrated(page, 'Criar conta');
    },
  },
  {
    name: 'cadastro-verifique',
    path: '/signup',
    ready: async (page) => {
      await expect(h1(page, 'Criar conta')).toBeVisible();
      await hydrated(page, 'Criar conta');
    },
    open: async (page) => {
      await page.getByLabel('Seu nome').fill('Ana Souza');
      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByLabel('Nome do workspace').fill('Clínica Aurora');
      await page.getByLabel('Senha').fill('senha-forte-123');
      await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
      await expect(h1(page, 'Verifique seu email')).toBeVisible();
    },
  },
  {
    name: 'verificacao-confirmado',
    path: '/verify?token=tok_ok',
    scenario: { verify: 'ok' },
    ready: async (page) => {
      await expect(h1(page, 'Email confirmado')).toBeVisible();
    },
  },
  {
    name: 'verificacao-expirado',
    path: '/verify?token=tok_velho',
    scenario: { verify: 'expired' },
    ready: async (page) => {
      await expect(h1(page, 'Link inválido ou expirado')).toBeVisible();
      await expect(page.getByLabel('Email da sua conta')).toBeVisible();
    },
  },
  {
    name: 'verificacao-incompleto',
    path: '/verify',
    ready: async (page) => {
      await expect(h1(page, 'Link incompleto')).toBeVisible();
    },
  },
  {
    name: 'senha-pedido',
    path: '/reset-password',
    ready: async (page) => {
      await expect(h1(page, 'Redefinir senha')).toBeVisible();
      await hydrated(page, 'Enviar instruções');
    },
  },
  {
    name: 'senha-enviado',
    path: '/reset-password',
    ready: async (page) => {
      await expect(h1(page, 'Redefinir senha')).toBeVisible();
      await hydrated(page, 'Enviar instruções');
    },
    open: async (page) => {
      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByRole('button', { name: 'Enviar instruções' }).click();
      await expect(h1(page, 'Confira sua caixa de entrada')).toBeVisible();
      // Resposta uniforme: nunca diz se a conta existe.
      await expect(page.getByText(/Se houver uma conta com esse email/)).toBeVisible();
    },
  },
  {
    name: 'senha-nova',
    path: '/reset-password?token=tok_reset',
    ready: async (page) => {
      await expect(h1(page, 'Definir nova senha')).toBeVisible();
      await expect(page.getByLabel('Confirme a nova senha')).toBeVisible();
    },
  },
  {
    name: 'convite-criar-senha',
    path: `/convite/${TOKEN}#token_hash=${PROOF_HASH}&type=invite`,
    scenario: { invite: PREVIEW },
    ready: async (page) => {
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await expect(page.getByLabel('Crie uma senha')).toBeVisible();
    },
  },
  {
    name: 'convite-email-enviado',
    path: `/convite/${TOKEN}`,
    scenario: { invite: PREVIEW },
    ready: async (page) => {
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await hydrated(page, 'Receber email de confirmação');
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Receber email de confirmação' }).click();
      await expect(page.getByText('Email enviado')).toBeVisible();
    },
  },
  {
    name: 'convite-invalido',
    path: `/convite/${TOKEN}`,
    scenario: { invite: null },
    ready: async (page) => {
      await expect(h1(page, 'Este convite não está mais disponível')).toBeVisible();
    },
  },
  {
    name: 'publica-termos',
    path: '/termos',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Termos de uso')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Nesta página' })).toBeVisible();
    },
  },
  {
    name: 'publica-privacidade',
    path: '/privacidade',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Política de privacidade')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Privacidade', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    },
  },
  {
    name: 'publica-exclusao',
    path: '/exclusao-de-dados/DEL-7F3A9C',
    ready: async (page) => {
      await expect(h1(page, 'Exclusão de dados')).toBeVisible();
      await expect(page.getByText('DEL-7F3A9C')).toBeVisible();
      await expect(page.getByText('Concluído', { exact: true }).first()).toBeVisible();
    },
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Acesso e públicas DS 3.0 — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          test.setTimeout(90_000);
          await useTheme(page, theme);
          await installRoutes(page, screen.scenario);
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page);
          await screen.open?.(page);
          // Entrada concluída antes de medir (o axe lê cor computada).
          await settled(page);

          const label = `${screen.name} ${size.width} ${theme}`;
          await expectNoSeriousAxe(page, { label });
          // `body`: nas telas de acesso o painel editorial (lg+) fica fora do `<main>`.
          await expectTextContrast(page, 'body', label);
          await capture(page, SHOTS, screen.name, theme, { full: Boolean(screen.full) });
        });
      }
    });
  }
}

// ── O título acompanha o estado ──────────────────────────────────────────────

test.describe('Acesso — o H1 é o estado da tela', () => {
  test('cadastro: o H1 vira "Verifique seu email" e recebe o foco', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/signup');
    await hydrated(page, 'Criar conta');
    await page.getByLabel('Seu nome').fill('Ana Souza');
    await page.getByLabel('Email').fill('ana@aurora.test');
    await page.getByLabel('Nome do workspace').fill('Clínica Aurora');
    await page.getByLabel('Senha').fill('senha-forte-123');
    await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

    const title = h1(page, 'Verifique seu email');
    await expect(title).toBeVisible();
    await expect(title).toBeFocused();
    // Um H1 só: o título antigo saiu.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // "Errei o email" volta ao formulário, com o título original.
    await page.getByRole('button', { name: 'Errei o email — voltar ao cadastro' }).click();
    await expect(h1(page, 'Criar conta')).toBeVisible();
  });

  test('verificação recusada: o H1 é o problema, e só há um H1', async ({ page }) => {
    await installRoutes(page, { verify: 'expired' });
    await page.goto('/verify?token=tok_velho');
    const title = h1(page, 'Link inválido ou expirado');
    await expect(title).toBeVisible();
    // Chegou depois da fase "Confirmando": o foco vai para o título novo.
    await expect(title).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('verificação aceita: H1 "Email confirmado" e o CTA leva ao login', async ({ page }) => {
    await installRoutes(page, { verify: 'ok' });
    await page.goto('/verify?token=tok_ok');
    await expect(h1(page, 'Email confirmado')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir para o login' })).toHaveAttribute(
      'href',
      '/login?from=verify',
    );
  });

  test('token na URL não vaza no Referer: no-referrer no grupo de acesso', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/reset-password?token=tok_reset');
    await expect(h1(page, 'Definir nova senha')).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    // A navegação real ao rodapé sai sem Referer.
    const termos = page.waitForRequest((req) => new URL(req.url()).pathname === '/termos');
    await page.getByRole('link', { name: 'Termos', exact: true }).click();
    const req = await termos;
    expect(await req.headerValue('referer')).toBeNull();
  });

  test('exclusão de dados: estado desconhecido da API vira o aviso de erro', async ({ page }) => {
    await page.route('**/api/meta/data-deletion/**', (route) =>
      json(route, { status: 'arquivado', requestedAt: new Date().toISOString(), completedAt: null }),
    );
    await page.goto('/exclusao-de-dados/DEL-7F3A9C');
    await expect(page.getByRole('alert').getByText('Consulta indisponível')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Estado do pedido' })).toHaveCount(0);
  });

  test('marca: logotipo SVG, sem a família Orbitron', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('svg[viewBox="0 0 32 32"]').first()).toBeVisible();
    const families = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *')).map((el) => getComputedStyle(el).fontFamily),
    );
    expect(families.some((f) => /orbitron/i.test(f))).toBe(false);
  });
});
