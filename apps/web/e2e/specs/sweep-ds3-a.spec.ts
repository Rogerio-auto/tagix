/**
 * F72-S07 (sub-lote a) — varredura DS 3.0: contatos, produtos, conversões (lista e tipos),
 * conhecimento, notificações, uso, cobrança, desenvolvedores, suporte e Meta (conexão +
 * leads dos anúncios).
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto no `<main>` (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s07/<tela>-<largura>-<tema>.png`.
 *
 * Mais: empresa em só leitura → o botão principal de contatos e de produtos fica focável,
 * `aria-disabled` e descrito pela explicação; o clique não abre nada.
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

// ── Dados ────────────────────────────────────────────────────────────────────

function contact(id: string, displayName: string, phone: string | null, email: string | null, optIn: boolean, age: number) {
  return {
    id,
    workspaceId: ME.workspace.id,
    displayName,
    phone,
    email,
    avatarUrl: null,
    notes: null,
    language: 'pt-BR',
    source: phone ? 'whatsapp' : 'site',
    marketingOptIn: optIn,
    optInMethod: optIn ? 'checkbox' : null,
    optInSource: null,
    optInAt: optIn ? iso(age) : null,
    optOutAt: null,
    optOutReason: null,
    ownerId: null,
    customFields: {},
    address: {},
    document: null,
    createdAt: iso(age),
    updatedAt: null,
    deletedAt: null,
  };
}

const CONTACTS = [
  contact('ct_1', 'Ana Souza', '+55 11 90000-0001', null, true, 2 * DAY),
  contact('ct_2', 'Bruno Lima', '+55 21 98888-1234', null, false, 5 * DAY),
  contact('ct_3', 'Carla Mendes', null, 'carla@estudio.com.br', true, 9 * DAY),
  contact('ct_4', 'Diego Ramos', '+55 31 97777-4321', null, true, 14 * DAY),
  contact('ct_5', 'Elisa Prado', '+55 41 96666-9876', null, false, 30 * DAY),
];

// Cor de tag é DADO do cliente (cadastrada na API), não estilo do componente.
const TAGS = [
  { id: 'tag_vip', name: 'VIP', color: 'rgb(31 255 19)' },
  { id: 'tag_lead', name: 'Lead quente', color: 'rgb(255 98 95)' },
];

const CONTACT_DETAIL = {
  contact: CONTACTS[0],
  tags: [TAGS[0]],
  conversations: [
    { id: 'conv_e2e_1', status: 'open', lastMessagePreview: 'Oi, quero saber sobre o plano.', lastMessageAt: iso(3_600_000), createdAt: iso(2 * DAY) },
  ],
  deals: [
    { id: 'deal_1', title: 'Plano Pro anual', valueCents: 238_800, currency: 'BRL', stageId: 's', closedAt: iso(DAY), closedWon: true, createdAt: iso(2 * DAY) },
    { id: 'deal_2', title: 'Consultoria de implantação', valueCents: 120_000, currency: 'BRL', stageId: 's', closedAt: null, closedWon: null, createdAt: iso(DAY) },
  ],
  conversions: [
    { id: 'cv_1', conversionTypeId: 't_venda', typeLabel: 'Venda fechada', valueCents: 238_800, currency: 'BRL', occurredAt: iso(DAY), cancelledAt: null },
  ],
  consent: [{ kind: 'opt_in', at: iso(2 * DAY), method: 'checkbox', source: 'site' }],
  marketingOptIn: true,
};

function product(id: string, name: string, sku: string | null, priceCents: number, active = true) {
  return {
    id,
    workspaceId: ME.workspace.id,
    name,
    sku,
    description: null,
    priceCents,
    currency: 'BRL',
    active,
    createdAt: iso(10 * DAY),
    updatedAt: null,
    deletedAt: null,
  };
}

const PRODUCTS = [
  product('p_1', 'Plano Pro anual', 'PRO-12M', 238_800),
  product('p_2', 'Consultoria de implantação', 'CONS-IMP', 120_000),
  product('p_3', 'Treinamento da equipe', null, 45_000),
  product('p_4', 'Plano Essencial mensal', 'ESS-1M', 9_900, false),
];

const CONVERSION_TYPES = [
  { id: 't_venda', key: 'venda_fechada', label: 'Venda fechada', color: 'rgb(37 240 24)', icon: null, valueRequired: true, valueLabel: null, currency: 'BRL', isDefault: true, position: 0, isActive: true },
  { id: 't_visita', key: 'visita_agendada', label: 'Visita agendada', color: 'rgb(103 183 255)', icon: null, valueRequired: false, valueLabel: null, currency: 'BRL', isDefault: false, position: 1, isActive: true },
];

const CONVERSIONS = [
  { id: 'cv_1', conversionTypeId: 't_venda', contactId: 'ct_1', dealId: 'deal_1', valueCents: 238_800, currency: 'BRL', note: null, source: 'deal_won', occurredAt: iso(DAY), cancelledAt: null },
  { id: 'cv_2', conversionTypeId: 't_visita', contactId: 'ct_2', dealId: null, valueCents: null, currency: 'BRL', note: null, source: 'manual', occurredAt: iso(2 * DAY), cancelledAt: null },
  { id: 'cv_3', conversionTypeId: 't_venda', contactId: 'ct_4', dealId: null, valueCents: 120_000, currency: 'BRL', note: null, source: 'manual', occurredAt: iso(4 * DAY), cancelledAt: null },
  { id: 'cv_4', conversionTypeId: 't_venda', contactId: 'ct_5', dealId: null, valueCents: 45_000, currency: 'BRL', note: null, source: 'api', occurredAt: iso(6 * DAY), cancelledAt: iso(5 * DAY) },
];

function kbDoc(id: string, title: string, category: string | null, priority: number, status: 'active' | 'draft' | 'archived', visible = true) {
  return {
    id,
    workspaceId: ME.workspace.id,
    title,
    source: 'upload',
    sourceUrl: null,
    category,
    tags: [],
    language: 'pt-BR',
    priority,
    status,
    visibleToAgents: visible,
    version: 1,
    createdAt: iso(7 * DAY),
    updatedAt: iso(DAY),
  };
}

const KB_DOCS = [
  kbDoc('kb_1', 'Política de reembolso', 'Suporte', 8, 'active'),
  kbDoc('kb_2', 'Tabela de preços 2026', 'Comercial', 10, 'active'),
  kbDoc('kb_3', 'Roteiro de onboarding do cliente', 'Operação', 5, 'draft'),
  kbDoc('kb_4', 'FAQ antigo', null, 2, 'active', false),
];

const USAGE_TOTALS = {
  today: { costUsd: 1.82, totalTokens: 182_400, requests: 214 },
  month: { costUsd: 41.37, totalTokens: 4_120_900, requests: 5_872 },
};
const USAGE_SUMMARY = {
  buckets: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(NOW - (13 - i) * DAY);
    const key = d.toISOString().slice(0, 10);
    return { key, label: key.slice(5), costUsd: 1 + ((i * 37) % 23) / 10, totalTokens: 90_000 + i * 4_000, requests: 150 + i * 6 };
  }),
};

const BILLING_SUBSCRIPTION = {
  subscription: {
    status: 'active',
    billingCycle: 'monthly',
    paymentProvider: 'abacatepay',
    paymentMethod: 'card',
    currentPeriodStart: iso(10 * DAY),
    currentPeriodEnd: new Date(NOW + 20 * DAY).toISOString(),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    plan: { id: 'plan_pro', key: 'pro', name: 'Pro', priceMonthlyCents: 19_900, priceYearlyCents: 199_000 },
  },
  history: [
    { id: 'pe_1', eventType: 'subscription.renewed', status: 'paid', amountCents: 19_900, receivedAt: iso(10 * DAY), processedAt: iso(10 * DAY) },
    { id: 'pe_2', eventType: 'subscription.completed', status: 'paid', amountCents: 19_900, receivedAt: iso(40 * DAY), processedAt: iso(40 * DAY) },
    { id: 'pe_3', eventType: 'pix.charge', status: 'pending', amountCents: 19_900, receivedAt: iso(70 * DAY), processedAt: null },
  ],
};
const BILLING_PLANS = {
  plans: [
    { id: 'plan_essencial', key: 'essencial', name: 'Essencial', priceMonthlyCents: 9_900, priceYearlyCents: 99_000 },
    { id: 'plan_pro', key: 'pro', name: 'Pro', priceMonthlyCents: 19_900, priceYearlyCents: 199_000 },
    { id: 'plan_scale', key: 'scale', name: 'Scale', priceMonthlyCents: 49_900, priceYearlyCents: 499_000 },
  ],
};

const SUPPORT_THREADS = [
  { id: 'sup_1', subject: 'Não consigo conectar o WhatsApp', status: 'open', priority: 'high', assignedTo: null, lastMessageAt: iso(3_600_000), createdAt: iso(DAY) },
  { id: 'sup_2', subject: 'Dúvida sobre a fatura', status: 'resolved', priority: 'normal', assignedTo: null, lastMessageAt: iso(5 * DAY), createdAt: iso(6 * DAY) },
];

const LEAD_SOURCES = {
  sources: [
    { id: 'ls_1', pageId: 'pg_1', pageName: 'Clínica Aurora', status: 'active', delivery: 'webhook', subscribeError: null, subscribedAt: iso(9 * DAY), lastReconciledAt: iso(900_000) },
    { id: 'ls_2', pageId: 'pg_2', pageName: 'Aurora Estética', status: 'active', delivery: 'reconciliation', subscribeError: 'A Meta ainda não liberou a permissão de leads para esta página.', subscribedAt: iso(2 * DAY), lastReconciledAt: iso(600_000) },
  ],
  available: [{ connectionId: 'mc_1', pageId: 'pg_3', pageName: 'Studio Vértice' }],
  recent: [
    { id: 'ld_1', pageId: 'pg_1', status: 'processed', error: null, attempts: 1, conversationId: 'conv_e2e_1', dealId: null, createdAt: iso(1_800_000) },
    { id: 'ld_2', pageId: 'pg_2', status: 'failed', error: 'O formulário veio sem telefone nem e-mail.', attempts: 3, conversationId: null, dealId: null, createdAt: iso(7_200_000) },
    { id: 'ld_3', pageId: 'pg_1', status: 'received', error: null, attempts: 0, conversationId: null, dealId: null, createdAt: iso(60_000) },
  ],
};

const NOTIFICATIONS = [
  { eventId: 'ev_1', contactId: 'ct_1', conversationId: 'conv_e2e_1', title: 'Ligar para a Ana sobre a proposta', type: 'call', priority: 'high', startAt: new Date(NOW + 600_000).toISOString(), receivedAt: NOW, seen: false },
  { eventId: 'ev_2', contactId: 'ct_2', conversationId: null, title: 'Enviar proposta revisada', type: 'proposal', priority: 'medium', startAt: new Date(NOW + 3_600_000).toISOString(), receivedAt: NOW - 1000, seen: true },
];

/** Rotas de dados das telas da varredura (precedem o roteador genérico da fixture). */
async function installSweepRoutes(page: Page): Promise<void> {
  await page.route(/\/api\/contacts(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? json(route, { contacts: CONTACTS, page: 1, pageSize: 25, total: CONTACTS.length, totalPages: 1 })
      : route.fallback(),
  );
  await page.route(/\/api\/contacts\/ct_[^/?]+$/, (route) =>
    route.request().method() === 'GET' ? json(route, CONTACT_DETAIL) : route.fallback(),
  );
  await page.route(/\/api\/tags(\?.*)?$/, (route) => json(route, { tags: TAGS }));
  await page.route(/\/api\/products(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? json(route, { products: PRODUCTS, page: 1, pageSize: 20, total: PRODUCTS.length, totalPages: 1 })
      : route.fallback(),
  );
  await page.route(/\/api\/conversion-types(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { conversionTypes: CONVERSION_TYPES }) : route.fallback(),
  );
  await page.route(/\/api\/conversions(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { conversions: CONVERSIONS }) : route.fallback(),
  );
  await page.route(/\/api\/knowledge\/documents(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? json(route, { documents: KB_DOCS, total: KB_DOCS.length, limit: 50, offset: 0 })
      : route.fallback(),
  );
  await page.route(/\/api\/usage\/totals(\?.*)?$/, (route) => json(route, USAGE_TOTALS));
  await page.route(/\/api\/usage\/summary(\?.*)?$/, (route) => json(route, USAGE_SUMMARY));
  await page.route(/\/api\/billing\/subscription(\?.*)?$/, (route) => json(route, BILLING_SUBSCRIPTION));
  await page.route(/\/api\/billing\/plans(\?.*)?$/, (route) => json(route, BILLING_PLANS));
  await page.route(/\/api\/support\/threads(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, { threads: SUPPORT_THREADS }) : route.fallback(),
  );
  await page.route(/\/api\/meta\/use-cases(\?.*)?$/, (route) =>
    json(route, {
      useCases: [
        { id: 'leads', label: 'Leads dos anúncios', permissions: [] },
        { id: 'ads_read', label: 'Ver resultado dos anúncios', permissions: [] },
        { id: 'instagram', label: 'Responder no Instagram', permissions: [] },
      ],
    }),
  );
  await page.route(/\/api\/meta\/connections(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? json(route, {
          connections: [
            {
              id: 'mc_1',
              metaUserName: 'Ana QA',
              status: 'active',
              health: 'missing_permissions',
              useCases: [
                { id: 'leads', label: 'Leads dos anúncios', missing: [] },
                { id: 'ads_read', label: 'Ver resultado dos anúncios', missing: ['ads_read'] },
              ],
              assets: { pages: [{ id: 'pg_1', name: 'Clínica Aurora', instagram: null }], adAccounts: [] },
              tokenExpiresAt: null,
              lastCheckedAt: iso(3_600_000),
            },
          ],
        })
      : route.fallback(),
  );
  await page.route(/\/api\/meta\/lead-sources(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? json(route, LEAD_SOURCES) : route.fallback(),
  );
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
  before?: (page: Page) => Promise<void>;
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

const SCREENS: Screen[] = [
  {
    name: 'contatos',
    path: '/contacts',
    ready: async (page) => {
      await expect(h1(page, 'Contatos')).toBeVisible();
      await expect(page.getByText('Carla Mendes').first()).toBeVisible();
    },
  },
  {
    name: 'contato-detalhe',
    path: '/contacts',
    ready: async (page) => {
      await expect(page.getByText('Ana Souza').first()).toBeVisible();
    },
    open: async (page, mobile) => {
      if (mobile) await page.getByRole('button', { name: 'Abrir contato Ana Souza' }).click();
      else await page.getByRole('row', { name: 'Abrir contato Ana Souza' }).click();
      const dialog = page.getByRole('dialog', { name: /Ana Souza|Detalhe do contato/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Resumo financeiro')).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'produtos',
    path: '/settings/products',
    ready: async (page) => {
      await expect(h1(page, 'Produtos')).toBeVisible();
      await expect(page.getByText('Consultoria de implantação').first()).toBeVisible();
    },
  },
  {
    name: 'conversoes',
    path: '/conversions',
    ready: async (page) => {
      await expect(h1(page, 'Conversões')).toBeVisible();
      await expect(page.getByText('Visita agendada').first()).toBeVisible();
    },
  },
  {
    name: 'tipos-de-conversao',
    path: '/settings/conversions',
    ready: async (page) => {
      await expect(h1(page, 'Tipos de conversão')).toBeVisible();
      await expect(page.getByText('visita_agendada')).toBeVisible();
    },
  },
  {
    name: 'conhecimento',
    path: '/knowledge',
    ready: async (page) => {
      await expect(h1(page, 'Conhecimento')).toBeVisible();
      await expect(page.getByText('Política de reembolso').first()).toBeVisible();
    },
  },
  {
    name: 'notificacoes',
    path: '/contacts',
    before: async (page) => {
      await page.addInitScript((list) => localStorage.setItem('hm:notifications', list), JSON.stringify(NOTIFICATIONS));
    },
    ready: async (page) => {
      await expect(h1(page, 'Contatos')).toBeVisible();
    },
    open: async (page) => {
      await page
        .getByRole('button', { name: /^Notificações, 1 não lida/ })
        .locator('visible=true')
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'Notificações' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Ligar para a Ana sobre a proposta')).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'uso',
    path: '/settings/usage',
    ready: async (page) => {
      await expect(h1(page, 'Uso e custo de IA')).toBeVisible();
      await expect(page.getByText('Custo no mês')).toBeVisible();
    },
  },
  {
    name: 'cobranca',
    path: '/settings/billing',
    ready: async (page) => {
      await expect(h1(page, 'Cobrança')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Histórico de cobranças' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Mudar de plano' })).toBeVisible();
    },
  },
  {
    name: 'desenvolvedores',
    path: '/help/developers',
    ready: async (page) => {
      await expect(h1(page, 'Leadium API')).toBeVisible();
      await expect(page.getByText('/api/v1/contacts', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'suporte',
    path: '/help',
    ready: async (page) => {
      await expect(page.getByRole('button', { name: /falar com o suporte/i })).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: /falar com o suporte/i }).click();
      const dialog = page.getByRole('dialog', { name: /suporte leadium/i });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Não consigo conectar o WhatsApp')).toBeVisible();
    },
    scope: '[role="dialog"][aria-label="Suporte Leadium"]',
  },
  {
    name: 'meta',
    path: '/settings/meta',
    ready: async (page) => {
      await expect(h1(page, 'Meta — Facebook e Instagram')).toBeVisible();
      await expect(page.getByText('Leads dos anúncios').first()).toBeVisible();
      await expect(page.getByText('O formulário veio sem telefone nem e-mail.')).toBeVisible();
    },
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Varredura DS 3.0 (a) — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await useTheme(page, theme);
        await installSweepRoutes(page);
      });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          await screen.before?.(page);
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page);
          await screen.open?.(page, size.width < 768);
          // Movimento de entrada concluído antes de medir (o axe lê cor computada).
          await page.waitForTimeout(350);

          await expectNoSeriousAxe(page, { label: `${screen.name} ${size.width} ${theme}` });
          await expectTextContrast(
            page,
            screen.scope ?? 'main',
            `${screen.name} ${size.width} ${theme}`,
          );
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

test.describe('Varredura DS 3.0 (a) — empresa em só leitura', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`contatos: "Novo contato" focável, aria-disabled, descrito e sem efeito — ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await useTheme(page, theme);
      await installSweepRoutes(page);
      await mockReadOnlyWorkspace(page);
      await page.goto('/contacts');
      await expect(page.getByText('Ana Souza').first()).toBeVisible();

      const create = page.getByRole('button', { name: 'Novo contato' });
      await expect(create).toHaveAttribute('aria-disabled', 'true');
      await expect(create).toBeEnabled(); // `aria-disabled`, nunca `disabled`: continua no Tab.
      await expect(create).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);

      // Foco por teclado mostra a explicação (não só para leitor de tela).
      await create.focus();
      await expect(create).toBeFocused();
      const tip = page.getByRole('tooltip', { name: READ_ONLY_TOOLTIP });
      await expect(tip).toBeVisible();
      await capture(page, SHOTS, 'contatos-so-leitura', theme, { full: false });

      // Clique e Enter não abrem o formulário.
      await create.click();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Novo contato' })).toHaveCount(0);

      await expectNoSeriousAxe(page, { label: `só leitura ${theme}` });
    });
  }

  test('produtos: criar e arquivar ficam aria-disabled com a explicação', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    await page.goto('/settings/products');
    await expect(page.getByText('Consultoria de implantação').first()).toBeVisible();

    for (const button of [
      page.getByRole('button', { name: 'Novo produto' }),
      page.getByRole('button', { name: 'Arquivar Plano Pro anual' }),
    ]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    await page.getByRole('button', { name: 'Arquivar Plano Pro anual' }).click();
    await expect(page.getByRole('dialog', { name: 'Arquivar produto?' })).toHaveCount(0);
  });

  test('cobrança segue liberada em só leitura (é o caminho para voltar a editar)', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page);
    await mockReadOnlyWorkspace(page);
    await page.goto('/settings/billing');
    // O plano atual vem selecionado; escolher outro libera o checkout.
    await page.getByRole('button', { name: /^Scale/ }).click();
    const cta = page.getByRole('button', { name: 'Continuar para pagamento' });
    await expect(cta).toBeVisible();
    await expect(cta).not.toHaveAttribute('aria-disabled', 'true');
  });
});
