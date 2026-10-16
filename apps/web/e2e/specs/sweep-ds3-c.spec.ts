/**
 * F72-S07 (sub-lote c) — varredura DS 3.0: flow-builder (lista de flows, criação, backup,
 * editor com o canvas e o painel de propriedades de um nó).
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s07/<tela>-<largura>-<tema>.png`.
 *
 * Canvas: nós, arestas, handles, fundo, controles e minimapa pintados por token. A prova
 * aqui é que o fundo e a aresta do React Flow resolvem para as cores dos tokens do tema
 * (e trocam com ele) — nenhum hex do CSS padrão do @xyflow sobra.
 *
 * Mais: empresa em só leitura → criar flow, publicar/pausar/arquivar/excluir na linha,
 * reordenar manuais, importar backup e salvar/publicar no editor ficam focáveis,
 * `aria-disabled` e descritos pela explicação; o clique não escreve nada.
 *
 * Locale e fuso fixos: o código formata com o `lang` do documento (regra F59); o navegador
 * de teste é o usuário brasileiro que a captura precisa provar.
 *
 * AMBIENTE: rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { ME } from '../fixtures/seed';
import { capture, expectNoSeriousAxe, expectTextContrast, useTheme, type Theme } from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f72-s07';
const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

// ── Dados ─────────────────────────────────────────────────────────────────────

function flow(
  id: string,
  name: string,
  status: string,
  triggerType: string,
  manualPosition: number | null,
  age: number,
  description: string | null = null,
) {
  return {
    id,
    workspaceId: ME.workspace.id,
    name,
    description,
    status,
    triggerType,
    triggerConfig: {},
    channelIds: null,
    manualPosition,
    createdAt: iso(age),
    updatedAt: iso(age / 2),
  };
}

const FLOWS = [
  flow('fl_1', 'Boas-vindas WhatsApp', 'active', 'keyword', null, 30 * DAY, 'Responde quem chega pelo anúncio'),
  flow('fl_2', 'Pós-venda', 'draft', 'new_message', null, 3 * DAY),
  flow('fl_3', 'Cobrança amigável', 'active', 'manual', 0, 12 * DAY),
  flow('fl_4', 'Reagendar consulta', 'paused', 'manual', 1, 20 * DAY),
  flow('fl_5', 'Campanha antiga', 'archived', 'new_lead', null, 90 * DAY),
];

const EDITOR_ID = 'fl_1';
const EDITOR_FLOW = {
  ...FLOWS[0],
  triggerConfig: { keywords: ['oi', 'quero saber mais'] },
  nodes: [
    { id: 'n_trigger', type: 'trigger', position: { x: 260, y: 0 }, data: {} },
    { id: 'n_msg', type: 'message', position: { x: 260, y: 150 }, data: { text: 'Oi! Que bom te ver por aqui.' } },
    {
      id: 'n_cond',
      type: 'condition',
      position: { x: 260, y: 300 },
      data: { operator: 'MSG_CONTAINS', variable: 'trigger.message', value: 'preço' },
    },
    {
      id: 'n_http',
      type: 'http_request',
      position: { x: 0, y: 470 },
      data: { method: 'POST', url: 'https://crm.exemplo.com/leads' },
    },
    { id: 'n_switch', type: 'switch', position: { x: 520, y: 470 }, data: { variable: 'contact.plan', cases: ['pro', 'free'] } },
    { id: 'n_tag', type: 'add_tag', position: { x: 0, y: 660 }, data: {} },
    { id: 'n_wait', type: 'wait', position: { x: 520, y: 660 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'n_trigger', target: 'n_msg', sourceHandle: null },
    { id: 'e2', source: 'n_msg', target: 'n_cond', sourceHandle: null },
    { id: 'e3', source: 'n_cond', target: 'n_http', sourceHandle: 'true' },
    { id: 'e4', source: 'n_cond', target: 'n_switch', sourceHandle: 'false' },
    { id: 'e5', source: 'n_http', target: 'n_tag', sourceHandle: 'success' },
    { id: 'e6', source: 'n_switch', target: 'n_wait', sourceHandle: 'pro' },
  ],
};

const EXECUTIONS = {
  executions: [
    { id: 'exec_8f21c0', status: 'running', currentNodeId: 'n_cond', startedAt: iso(4 * 60_000), completedAt: null },
    { id: 'exec_77ad19', status: 'waiting', currentNodeId: 'n_wait', startedAt: iso(40 * 60_000), completedAt: null },
    { id: 'exec_1b2c3d', status: 'completed', currentNodeId: null, startedAt: iso(DAY), completedAt: iso(DAY - 60_000) },
  ],
};

/** Rotas de dados das telas da varredura (precedem o roteador genérico da fixture). */
async function installSweepRoutes(page: Page): Promise<void> {
  await page.route(/\/api\/flows(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { flows: FLOWS }) : route.fallback(),
  );
  await page.route(/\/api\/flows\/fl_[^/?]+$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, { flow: EDITOR_FLOW, versions: [{ id: 'fv_1', version: 3, publishedAt: iso(DAY) }] });
  });
  await page.route(/\/api\/flows\/fl_[^/]+\/executions(\?.*)?$/, (route) => json(route, EXECUTIONS));
  for (const seg of ['agents', 'tags', 'conversion-types', 'workspace/members', 'departments']) {
    const key = (seg.split('/').pop() ?? seg).replace(/-/g, '_');
    await page.route(new RegExp(`/api/${seg}(\\?.*)?$`), (route) =>
      route.request().method() === 'GET' ? json(route, { [key]: [] }) : route.fallback(),
    );
  }
}

// ── Telas ─────────────────────────────────────────────────────────────────────

interface Screen {
  name: string;
  path: string;
  /** Espera o conteúdo real (não o skeleton). */
  ready: (page: Page, mobile: boolean) => Promise<void>;
  /** Ação depois de carregar (abrir painel/sheet). A captura e o axe são do estado final. */
  open?: (page: Page, mobile: boolean) => Promise<void>;
  /** Escopo do axe/contraste quando a tela é um overlay. */
  scope?: (mobile: boolean) => string | undefined;
  /** Captura inteira do `<main>` (telas que rolam). */
  full?: boolean;
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

const editorReady = async (page: Page): Promise<void> => {
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(EDITOR_FLOW.nodes.length);
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
};

const SCREENS: Screen[] = [
  {
    name: 'flows',
    path: '/flows',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Flows')).toBeVisible();
      await expect(page.getByText('Reagendar consulta').first()).toBeVisible();
    },
  },
  {
    name: 'flow-criar',
    path: '/flows',
    ready: async (page) => {
      await expect(page.getByText('Pós-venda').first()).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Criar flow' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Novo flow' })).toBeVisible();
    },
    scope: () => '[role="dialog"]',
  },
  {
    name: 'flows-backup',
    path: '/flows/backup',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Backup de Flows')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Exportar e baixar' })).toBeVisible();
    },
  },
  {
    name: 'flow-editor',
    path: `/flows/${EDITOR_ID}`,
    ready: async (page) => {
      await editorReady(page);
      await expect(page.getByText('Em execução').first()).toBeVisible();
    },
  },
  {
    name: 'flow-editor-no',
    path: `/flows/${EDITOR_ID}`,
    ready: async (page) => {
      await editorReady(page);
    },
    open: async (page, mobile) => {
      if (mobile) {
        // Celular: a lista de nós abre o inspector como sheet (UX §2.3).
        await page.getByRole('button', { name: /^Condição/ }).first().click();
        // O sheet leva o nome do nó (título do sheet).
        await expect(page.getByRole('dialog', { name: 'Condição' })).toBeVisible();
      } else {
        await page.locator('.react-flow__node').filter({ hasText: 'Condição' }).click();
        const panel = page.getByRole('complementary', { name: 'Propriedades do nó' });
        await expect(panel.getByRole('heading', { name: 'Condição' })).toBeVisible();
      }
    },
    scope: (mobile) => (mobile ? '[role="dialog"]' : undefined),
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Varredura DS 3.0 (c) — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await useTheme(page, theme);
        await installSweepRoutes(page);
      });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          const mobile = size.width < 768;
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page, mobile);
          await screen.open?.(page, mobile);
          // Movimento de entrada concluído antes de medir (o axe lê cor computada).
          await page.waitForTimeout(350);

          const scope = screen.scope?.(mobile);
          await expectNoSeriousAxe(page, { label: `${screen.name} ${size.width} ${theme}` });
          await expectTextContrast(page, scope ?? 'main', `${screen.name} ${size.width} ${theme}`);
          await capture(page, SHOTS, screen.name, theme, { full: Boolean(screen.full) && !scope });
        });
      }
    });
  }
}

// ── Canvas nos tokens ─────────────────────────────────────────────────────────

test.describe('Varredura DS 3.0 (c) — canvas pintado pelos tokens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`fundo, aresta e nó resolvem para os tokens do tema — ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await useTheme(page, theme);
      await installSweepRoutes(page);
      await page.goto(`/flows/${EDITOR_ID}`);
      await editorReady(page);

      const colors = await page.evaluate(() => {
        // Resolve um token para rgb() pelo próprio navegador (sem hex no teste).
        const probe = document.createElement('i');
        document.body.appendChild(probe);
        const resolve = (v: string): string => {
          probe.style.color = `var(${v})`;
          return getComputedStyle(probe).color;
        };
        const flowEl = document.querySelector('.react-flow');
        const edge = document.querySelector('.react-flow__edge-path');
        const node = document.querySelector('.react-flow__node > div');
        const out = {
          bg: resolve('--bg'),
          textLow: resolve('--text-low'),
          surface: resolve('--surface'),
          canvasBg: flowEl ? getComputedStyle(flowEl).backgroundColor : '',
          edgeStroke: edge ? getComputedStyle(edge).stroke : '',
          nodeBg: node ? getComputedStyle(node).backgroundColor : '',
        };
        probe.remove();
        return out;
      });
      expect(colors.canvasBg).toBe(colors.bg);
      expect(colors.edgeStroke).toBe(colors.textLow);
      expect(colors.nodeBg).toBe(colors.surface);
    });
  }

  test('nó focado por teclado mostra o anel de foco', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await page.goto(`/flows/${EDITOR_ID}`);
    await editorReady(page);
    const node = page.locator('.react-flow__node-message');
    await node.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(node).toBeFocused();
    const outline = await node.locator('> div').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
  });
});

// ── Só leitura ───────────────────────────────────────────────────────────────

/** `/api/me` de uma empresa com a assinatura expirada (modo só leitura). */
async function mockReadOnlyWorkspace(page: Page): Promise<void> {
  await page.route('**/api/me', (route) =>
    json(route, {
      member: { ...ME.member, status: 'active' },
      workspace: { id: ME.workspace.id, name: 'Clínica Aurora', subscriptionStatus: 'expired', trialEndsAt: null },
      memberships: [
        { workspaceId: ME.workspace.id, name: 'Clínica Aurora', slug: 'aurora', role: 'OWNER', subscriptionStatus: 'expired' },
      ],
    }),
  );
  await page.route('**/api/me/invites', (route) => json(route, { invites: [] }));
}

/** Registra toda escrita (não-GET) em `/api/flows…` para provar que nada saiu. */
function recordFlowWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(flows|flow-executions)/.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}

test.describe('Varredura DS 3.0 (c) — empresa em só leitura', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`flows: "Criar flow" focável, aria-disabled, descrito e sem efeito — ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await useTheme(page, theme);
      await installSweepRoutes(page);
      await mockReadOnlyWorkspace(page);
      await page.goto('/flows');
      await expect(page.getByText('Boas-vindas WhatsApp').first()).toBeVisible();

      const create = page.getByRole('button', { name: 'Criar flow' });
      await expect(create).toHaveAttribute('aria-disabled', 'true');
      // `aria-disabled`, nunca `disabled`: continua no Tab. (O `toBeEnabled` do Playwright
      // conta `aria-disabled` como desabilitado, então a prova é o atributo + o foco abaixo.)
      await expect(create).not.toHaveAttribute('disabled');
      await expect(create).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);

      // Foco por teclado mostra a explicação (não só para leitor de tela).
      await create.focus();
      await expect(create).toBeFocused();
      const tipId = await create.getAttribute('aria-describedby');
      const tip = page.locator(`[id="${tipId ?? ''}"]`);
      await expect(tip).toHaveAttribute('role', 'tooltip');
      await expect(tip).toHaveText(READ_ONLY_TOOLTIP);
      await expect(tip).toHaveCSS('opacity', '1');
      await capture(page, SHOTS, 'flows-so-leitura', theme, { full: false });

      // Clique e Enter não abrem a criação.
      // `force`: o Playwright recusa clicar em `aria-disabled`; a pessoa, não.
      await create.click({ force: true });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Novo flow' })).toHaveCount(0);

      await expectNoSeriousAxe(page, { label: `só leitura flows ${theme}` });
    });
  }

  test('flows: publicar, pausar, arquivar, excluir e reordenar na lista não escrevem nada', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    const writes = recordFlowWrites(page);
    await page.goto('/flows');
    await expect(page.getByText('Boas-vindas WhatsApp').first()).toBeVisible();

    const names = [
      'Publicar Pós-venda',
      'Pausar Boas-vindas WhatsApp',
      'Arquivar Boas-vindas WhatsApp',
      'Excluir Pós-venda',
      'Reordenar Cobrança amigável',
    ];
    for (const name of names) {
      const button = page.getByRole('button', { name });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).not.toHaveAttribute('disabled');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    // `force`: o Playwright recusa clicar em `aria-disabled`; a pessoa, não.
    await page.getByRole('button', { name: 'Publicar Pós-venda' }).click({ force: true });
    await page.getByRole('button', { name: 'Excluir Pós-venda' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Excluir flow?' })).toHaveCount(0);
    // O clique no botão guardado também não abre o editor (a linha não recebe o clique).
    await expect(page).toHaveURL(/\/flows$/);
    expect(writes).toEqual([]);
  });

  test('backup: exportar segue livre (leitura); importar fica aria-disabled', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    await page.goto('/flows/backup');
    await expect(h1(page, 'Backup de Flows')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Exportar e baixar' })).not.toHaveAttribute('aria-disabled');
    const pick = page.getByRole('button', { name: 'Selecionar arquivo…' });
    await expect(pick).toHaveAttribute('aria-disabled', 'true');
    await expect(pick).not.toHaveAttribute('disabled');
    await expect(pick).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    // O clique não abre o seletor de arquivo.
    const chooser = page.waitForEvent('filechooser', { timeout: 1_000 }).then(
      () => true,
      () => false,
    );
    await pick.click({ force: true });
    expect(await chooser).toBe(false);
  });

  test('editor: salvar e publicar guardados, palette explica e Ctrl+S não salva', async ({ page }) => {
    test.setTimeout(90_000);
    await useTheme(page, 'dark');
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    const writes = recordFlowWrites(page);
    await page.goto(`/flows/${EDITOR_ID}`);
    await editorReady(page);

    for (const name of ['Salvar', 'Publicar']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).not.toHaveAttribute('disabled');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    const palette = page.getByRole('complementary', { name: 'Componentes do flow' });
    await expect(palette.getByText(READ_ONLY_TOOLTIP)).toBeVisible();
    await expect(palette.getByRole('button', { name: /^Adicionar / })).toHaveCount(0);

    await page.getByRole('button', { name: 'Publicar', exact: true }).click({ force: true });
    await page.keyboard.press('Control+s');

    // Propriedades do nó travadas (fieldset desabilitado) e com a explicação.
    await page.locator('.react-flow__node').filter({ hasText: 'Condição' }).click();
    const panel = page.getByRole('complementary', { name: 'Propriedades do nó' });
    await expect(panel.getByText(READ_ONLY_TOOLTIP)).toBeVisible();
    await expect(panel.getByRole('combobox').first()).toBeDisabled();
    await capture(page, SHOTS, 'flow-editor-so-leitura', 'dark', { full: false });

    await expectNoSeriousAxe(page, { label: 'só leitura editor' });
    expect(writes).toEqual([]);
  });
});
