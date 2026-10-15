/**
 * F72-S07 (sub-lote b) — varredura DS 3.0: campanhas (lista, detalhe/monitoramento,
 * editor novo e de rascunho) e agentes (lista, detalhe nas abas Configuração, Versões,
 * Ferramentas, Métricas e Playground, e o assistente de criação).
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto no `<main>` (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s07/<tela>-<largura>-<tema>.png`.
 *
 * Mais: empresa em só leitura → criar campanha, pausar, criar agente e desativar ficam
 * focáveis, `aria-disabled` e descritos pela explicação; o clique não faz nada.
 *
 * Locale e fuso fixos: o código formata com o `lang` do documento (regra F59); o navegador
 * de teste é o usuário brasileiro que a captura precisa provar.
 *
 * AMBIENTE: rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { CHANNEL, ME } from '../fixtures/seed';
import { capture, expectNoSeriousAxe, expectTextContrast, useTheme, type Theme } from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f72-s07';
const READ_ONLY_TOOLTIP = 'Modo só leitura: escolha um plano para voltar a editar.';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

// ── Campanhas ─────────────────────────────────────────────────────────────────

function campaign(
  id: string,
  name: string,
  status: string,
  type: string,
  rate: number,
  daily: number | null,
  age: number,
) {
  return {
    id,
    workspaceId: ME.workspace.id,
    channelId: CHANNEL.id,
    name,
    type,
    status,
    timezone: 'UTC',
    startAt: null,
    endAt: null,
    sendWindows: { enabled: false },
    rateLimitPerMinute: rate,
    dailyLimit: daily,
    autoHandoffOnReply: true,
    aiHandoffAgentId: null,
    createdAt: iso(age),
    updatedAt: null,
  };
}

const CAMPAIGNS = [
  campaign('cp_1', 'Black Friday 2026', 'running', 'broadcast', 1200, 25_000, 2 * DAY),
  campaign('cp_2', 'Reativação de inativos', 'draft', 'drip', 30, null, DAY),
  campaign('cp_3', 'Pós-venda março', 'paused', 'drip', 60, 5_000, 9 * DAY),
  campaign('cp_4', 'Lançamento coleção', 'completed', 'broadcast', 600, 10_000, 40 * DAY),
];

const CAMPAIGN_DETAIL = (id: string) => {
  const c = CAMPAIGNS.find((x) => x.id === id) ?? CAMPAIGNS[0];
  return {
    campaign: c,
    steps: [
      {
        id: `st_${id}`,
        campaignId: id,
        position: 0,
        templateName: 'oferta_black_friday',
        languageCode: 'pt_BR',
        templateComponents: null,
        delaySeconds: 0,
        stopOnReply: true,
      },
    ],
    followups: [
      {
        id: `fu_${id}`,
        campaignId: id,
        triggerEvent: 'on_no_reply',
        delayMinutes: 1440,
        templateName: 'lembrete_oferta',
        languageCode: 'pt_BR',
        position: 0,
        isActive: true,
      },
    ],
  };
};

const CAMPAIGN_METRICS = {
  metrics: {
    campaignId: 'cp_1',
    totalRecipients: 12_480,
    messagesQueued: 120,
    messagesSent: 12_000,
    messagesDelivered: 11_520,
    messagesRead: 8_330,
    messagesReplied: 940,
    messagesFailed: 36,
    messagesBlocked: 4,
    deliveryRate: '96.00',
    readRate: '69.40',
    responseRate: '8.16',
    blockRate: '0.03',
    healthStatus: 'healthy',
    updatedAt: iso(2 * MIN),
  },
};

const CAMPAIGN_FAILURES = {
  deliveries: [
    { id: 'dl_1', campaignId: 'cp_1', status: 'failed', errorCode: '131026', errorMessage: 'O destinatário não tem WhatsApp neste número.', queuedAt: iso(40 * MIN), sentAt: null, failedAt: iso(38 * MIN) },
    { id: 'dl_2', campaignId: 'cp_1', status: 'failed', errorCode: '131049', errorMessage: 'A Meta limitou o envio para manter a qualidade do número.', queuedAt: iso(90 * MIN), sentAt: null, failedAt: iso(88 * MIN) },
  ],
};

// ── Agentes ───────────────────────────────────────────────────────────────────

function agent(id: string, name: string, status: string, model: string | null, description: string | null, age: number) {
  return {
    id,
    workspaceId: ME.workspace.id,
    templateId: null,
    name,
    description,
    systemPrompt: 'Você é o assistente de vendas da Clínica Aurora. Seja cordial e objetivo.',
    model,
    modelParams: { temperature: 0.4 },
    visionModel: null,
    transcriptionModel: null,
    status,
    aggregationEnabled: true,
    aggregationWindowSec: 8,
    maxBatchMessages: 10,
    replyIfIdleSec: null,
    allowHandoff: true,
    ignoreGroupMessages: true,
    enabledChannelIds: null,
    createdAt: iso(age),
    updatedAt: iso(age / 2),
    departments: [],
  };
}

const AGENTS = [
  agent('ag_1', 'Vendas WhatsApp', 'active', 'anthropic/claude-sonnet-4.5', 'Qualifica e fecha pedidos', 20 * DAY),
  agent('ag_2', 'Recepção', 'inactive', null, 'Agenda consultas', 10 * DAY),
  agent('ag_3', 'Suporte antigo', 'archived', 'openai/gpt-4o-mini', null, 90 * DAY),
];

function version(id: string, n: number, status: string, age: number, label: string | null) {
  return {
    id,
    agentId: 'ag_1',
    version: n,
    status,
    systemPrompt: `Você é o assistente de vendas da Clínica Aurora (v${n}).`,
    model: 'anthropic/claude-sonnet-4.5',
    modelParams: {},
    label,
    note: null,
    authorMemberId: null,
    rolledBackFrom: null,
    createdAt: iso(age),
    publishedAt: status === 'live' ? iso(age - DAY / 2) : null,
  };
}

const VERSIONS = {
  versions: [
    version('pv_3', 3, 'draft', DAY, 'tom mais consultivo'),
    version('pv_2', 2, 'live', 5 * DAY, null),
    version('pv_1', 1, 'archived', 20 * DAY, 'primeira versão'),
  ],
};

const AGENT_METRICS = {
  metrics: Array.from({ length: 5 }, (_, i) => ({
    period: 'day',
    periodStart: new Date(NOW - (i + 1) * DAY).toISOString(),
    totalTokens: 182_400 - i * 9_000,
    totalCostUsd: 1.8214 - i * 0.07,
    totalConversations: 41 - i,
    totalMessages: 388 - i * 11,
    errorCount: i === 2 ? 3 : 0,
    handoffCount: 5 - (i % 3),
    avgLatencyMs: 1420.4 + i * 37,
  })),
};

const TOOLS = {
  tools: [
    { id: 'tl_1', workspaceId: null, key: 'schedule_event', name: 'Agendar compromisso', description: 'Cria um evento na agenda da equipe.', category: 'calendar', schema: null, handlerConfig: null, isGlobal: true, isActive: true, isEnabled: true },
    { id: 'tl_2', workspaceId: null, key: 'move_deal', name: 'Mover negócio', description: 'Avança o negócio no funil.', category: 'crm', schema: null, handlerConfig: null, isGlobal: true, isActive: true, isEnabled: false },
  ],
};

const TEMPLATES = {
  templates: [
    { id: '7d0b2a4e-6a63-4c31-9d55-0d6b6f6b2a11', key: 'sales', name: 'Vendas', category: 'sales', description: 'Qualifica leads e conduz até o pedido.', defaultModel: 'anthropic/claude-sonnet-4.5', questions: [] },
    { id: '4b1f7d3c-2f8e-4a5b-8c6d-1e2f3a4b5c6d', key: 'reception', name: 'Recepção', category: 'reception', description: 'Responde dúvidas e agenda.', defaultModel: 'openai/gpt-4o-mini', questions: [] },
  ],
};

/** Rotas de dados das telas da varredura (precedem o roteador genérico da fixture). */
async function installSweepRoutes(page: Page): Promise<void> {
  await page.route(/\/api\/campaigns(\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const status = new URL(route.request().url()).searchParams.get('status');
    return json(route, { campaigns: status ? CAMPAIGNS.filter((c) => c.status === status) : CAMPAIGNS });
  });
  await page.route(/\/api\/campaigns\/cp_[^/?]+$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? 'cp_1';
    return json(route, CAMPAIGN_DETAIL(id));
  });
  await page.route(/\/api\/campaigns\/cp_[^/]+\/metrics(\?.*)?$/, (route) => json(route, CAMPAIGN_METRICS));
  await page.route(/\/api\/campaigns\/cp_[^/]+\/deliveries(\?.*)?$/, (route) => json(route, CAMPAIGN_FAILURES));

  await page.route(/\/api\/agents(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { agents: AGENTS }) : route.fallback(),
  );
  await page.route(/\/api\/agents\/ag_[^/?]+$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return json(route, { agent: AGENTS.find((a) => a.id === id) ?? AGENTS[0] });
  });
  await page.route(/\/api\/agents\/ag_[^/]+\/versions(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, VERSIONS) : route.fallback(),
  );
  await page.route(/\/api\/agents\/ag_[^/]+\/metrics(\?.*)?$/, (route) => json(route, AGENT_METRICS));
  await page.route(/\/api\/agents\/ag_[^/]+\/tools(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, TOOLS) : route.fallback(),
  );
  await page.route(/\/api\/agents\/models(\?.*)?$/, (route) =>
    json(route, {
      models: [
        { slug: 'anthropic/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', provider: 'Anthropic', contextWindow: 200_000, promptUsd: 3, completionUsd: 15, supportsTools: true, supportsVision: true, allowed: true },
        { slug: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini', provider: 'OpenAI', contextWindow: 128_000, promptUsd: 0.15, completionUsd: 0.6, supportsTools: true, supportsVision: true, allowed: true },
        { slug: 'openai/o3', displayName: 'o3', provider: 'OpenAI', contextWindow: 200_000, promptUsd: 10, completionUsd: 40, supportsTools: true, supportsVision: false, allowed: false },
      ],
    }),
  );
  await page.route(/\/api\/agents\/templates(\?.*)?$/, (route) => json(route, TEMPLATES));
  await page.route(/\/api\/departments(\?.*)?$/, (route) => json(route, { departments: [] }));
}

// ── Telas ─────────────────────────────────────────────────────────────────────

interface Screen {
  name: string;
  path: string;
  /** Espera o conteúdo real (não o skeleton). */
  ready: (page: Page) => Promise<void>;
  /** Ação depois de carregar (abrir painel/sheet). A captura e o axe são do estado final. */
  open?: (page: Page, mobile: boolean) => Promise<void>;
  /** Escopo do axe/contraste quando a tela é um overlay. */
  scope?: string;
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

const SCREENS: Screen[] = [
  {
    name: 'campanhas',
    path: '/campaigns',
    ready: async (page) => {
      await expect(h1(page, 'Campanhas')).toBeVisible();
      await expect(page.getByText('Pós-venda março').first()).toBeVisible();
    },
  },
  {
    name: 'campanha-detalhe',
    path: '/campaigns/cp_1',
    ready: async (page) => {
      await expect(h1(page, 'Black Friday 2026')).toBeVisible();
      await expect(page.getByText('Destinatários')).toBeVisible();
      await expect(page.getByText('131026').first()).toBeVisible();
    },
  },
  {
    name: 'campanha-nova',
    path: '/campaigns/new',
    ready: async (page) => {
      await expect(h1(page, 'Nova campanha')).toBeVisible();
      await expect(page.getByLabel('Nome')).toBeVisible();
    },
  },
  {
    name: 'campanha-editar',
    path: '/campaigns/cp_2/edit',
    ready: async (page) => {
      await expect(h1(page, 'Editar campanha')).toBeVisible();
      await expect(page.getByLabel('Nome')).toHaveValue('Reativação de inativos');
    },
  },
  {
    name: 'agentes',
    path: '/agents',
    ready: async (page) => {
      await expect(h1(page, 'Agentes')).toBeVisible();
      await expect(page.getByText('Vendas WhatsApp').first()).toBeVisible();
    },
  },
  {
    name: 'agente-configuracao',
    path: '/agents/ag_1',
    ready: async (page) => {
      await expect(h1(page, 'Vendas WhatsApp')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Identidade' })).toBeVisible();
    },
  },
  {
    name: 'agente-versoes',
    path: '/agents/ag_1?tab=versions',
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Versões do prompt' })).toBeVisible();
      await expect(page.getByText('tom mais consultivo')).toBeVisible();
    },
  },
  {
    name: 'agente-ferramentas',
    path: '/agents/ag_1?tab=tools',
    ready: async (page) => {
      await expect(page.getByText('Agendar compromisso')).toBeVisible();
    },
  },
  {
    name: 'agente-metricas',
    path: '/agents/ag_1?tab=metrics',
    ready: async (page) => {
      await expect(page.getByText('Custo total')).toBeVisible();
    },
  },
  {
    name: 'agente-playground',
    path: '/agents/ag_1?tab=playground',
    ready: async (page) => {
      await expect(page.getByText('Teste seu agente ao vivo')).toBeVisible();
    },
  },
  {
    name: 'agente-criar',
    path: '/agents',
    ready: async (page) => {
      await expect(page.getByText('Vendas WhatsApp').first()).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Criar agente' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Criar agente' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Qualifica leads e conduz até o pedido.')).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Varredura DS 3.0 (b) — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await useTheme(page, theme);
        await installSweepRoutes(page);
      });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page);
          await screen.open?.(page, size.width < 768);
          // Movimento de entrada concluído antes de medir (o axe lê cor computada).
          await page.waitForTimeout(350);

          await expectNoSeriousAxe(page, { label: `${screen.name} ${size.width} ${theme}` });
          await expectTextContrast(page, screen.scope ?? 'main', `${screen.name} ${size.width} ${theme}`);
          await capture(page, SHOTS, screen.name, theme, { full: !screen.scope });
        });
      }
    });
  }
}

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

test.describe('Varredura DS 3.0 (b) — empresa em só leitura', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`campanhas: "Nova campanha" focável, aria-disabled, descrita e sem efeito — ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await useTheme(page, theme);
      await installSweepRoutes(page);
      await mockReadOnlyWorkspace(page);
      await page.goto('/campaigns');
      await expect(page.getByText('Black Friday 2026').first()).toBeVisible();

      const create = page.getByRole('button', { name: 'Nova campanha' });
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
      await capture(page, SHOTS, 'campanhas-so-leitura', theme, { full: false });

      // Clique e Enter não navegam para o editor.
      // `force`: o Playwright recusa clicar em `aria-disabled`; a pessoa, não.
      await create.click({ force: true });
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/campaigns$/);

      await expectNoSeriousAxe(page, { label: `só leitura campanhas ${theme}` });
    });
  }

  test('campanhas: pausar e cancelar na linha ficam aria-disabled e não disparam nada', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/campaigns\//.test(r.url()) && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    });
    await page.goto('/campaigns');
    await expect(page.getByText('Black Friday 2026').first()).toBeVisible();

    for (const name of ['Pausar Black Friday 2026', 'Cancelar Black Friday 2026', 'Retomar Pós-venda março']) {
      const button = page.getByRole('button', { name });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    // `force`: o Playwright recusa clicar em `aria-disabled`; a pessoa, não.
    await page.getByRole('button', { name: 'Pausar Black Friday 2026' }).click({ force: true });
    await page.getByRole('button', { name: 'Cancelar Black Friday 2026' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Cancelar campanha?' })).toHaveCount(0);
    // O clique no botão guardado também não abre o detalhe (a linha não recebe o clique).
    await expect(page).toHaveURL(/\/campaigns$/);
    expect(writes).toEqual([]);
  });

  test('agentes: criar e desativar ficam aria-disabled com a explicação', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    await page.goto('/agents');
    await expect(page.getByText('Vendas WhatsApp').first()).toBeVisible();

    for (const button of [
      page.getByRole('button', { name: 'Criar agente' }),
      page.getByRole('button', { name: 'Desativar Vendas WhatsApp' }),
    ]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    await page.getByRole('button', { name: 'Criar agente' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Criar agente' })).toHaveCount(0);
  });

  test('agente: salvar configuração e publicar versão ficam aria-disabled', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    await page.goto('/agents/ag_1?tab=versions');
    await expect(page.getByText('tom mais consultivo')).toBeVisible();

    for (const button of [
      page.getByRole('button', { name: 'Desativar' }),
      page.getByRole('button', { name: 'Novo rascunho' }),
      page.getByRole('button', { name: 'Publicar v3' }),
      page.getByRole('button', { name: 'Restaurar v1' }),
    ]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    await page.getByRole('button', { name: 'Descartar rascunho v3' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Descartar rascunho?' })).toHaveCount(0);
  });
});
