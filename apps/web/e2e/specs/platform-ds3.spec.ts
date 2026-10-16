/**
 * F72-S08 (sub-lote b) — DS 3.0 no painel de plataforma (super-admin): hub, tenants,
 * Workspace 360, planos, assinaturas, modelos, políticas, segredos, uso, monitoramento,
 * playground, ver como, suporte e CMS da Central de Ajuda.
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s08/platform-<tela>-<largura>-<tema>.png`.
 *
 * Mais (é o painel de super-admin): segredos nunca chegam à tela (a lista só tem
 * metadados e o campo de rotação é `password`); "Ver como" exige motivo antes de qualquer
 * POST; o gráfico de uso usa a marca de TEXTO a 40% (não o verde cheio).
 *
 * GUARD DE SERVIDOR: o layout `(platform)` resolve o admin no SERVIDOR web
 * (`<API_INTERNAL_URL|localhost:3001>/api/me`, `features/platform-admin/lib/guard.ts`),
 * fora do alcance do `page.route`. Este spec sobe ali uma API mínima que reconhece o
 * `e2e-token` como platform admin. Porta: a de `API_INTERNAL_URL` quando definida (rode
 * com `API_INTERNAL_URL=http://127.0.0.1:3199` para dividir a porta com a checagem de
 * sessão do middleware), senão a 3001 do padrão do guard.
 *
 * AMBIENTE: rodar com `--workers=1` (porta fixa; ver `mobile-nav.spec.ts`).
 */

import { createServer, type Server } from 'node:http';
import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { capture, expectNoSeriousAxe, expectTextContrast, useTheme, type Theme } from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f72-s08';

// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
test.describe.configure({ mode: 'default' });

// ── API de servidor (guard do layout) ────────────────────────────────────────

const GUARD_API = new URL(process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001');
const GUARD_PORT = Number(GUARD_API.port || 80);

const ADMIN = { id: 'mem_platform_admin', email: 'rogerio@leadium.test', name: 'Rogério Viana', isPlatformAdmin: true };

let guardApi: Server | null = null;

test.beforeAll(async () => {
  guardApi = createServer((req, res) => {
    const valid = req.url === '/api/me' && (req.headers.cookie ?? '').includes('hm_session=e2e-token');
    res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valid ? { member: ADMIN } : { message: 'Não autenticado.' }));
  });
  await new Promise<void>((resolve, reject) => {
    guardApi?.once('error', (err) =>
      reject(new Error(`Porta ${GUARD_PORT} ocupada para a API do guard de plataforma: ${String(err)}`)),
    );
    // Sem host: escuta IPv4 e IPv6 (o guard pede `localhost`, que pode resolver para ::1).
    guardApi?.listen(GUARD_PORT, () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => (guardApi ? guardApi.close(() => resolve()) : resolve()));
});

// ── Dados ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const isoAhead = (ms: number): string => new Date(NOW + ms).toISOString();

const WS = 'ws_aurora';

const TENANTS = [
  { id: WS, name: 'Clínica Aurora', slug: 'clinica-aurora', subscriptionStatus: 'active', planKey: 'pro', planName: 'Pro', memberCount: 6, monthCostUsd: 184.37 },
  { id: 'ws_bento', name: 'Bento Móveis', slug: 'bento-moveis', subscriptionStatus: 'trial', planKey: 'starter', planName: 'Starter', memberCount: 2, monthCostUsd: 12.4 },
  { id: 'ws_casa', name: 'Casa Norte Imóveis', slug: 'casa-norte', subscriptionStatus: 'past_due', planKey: 'pro', planName: 'Pro', memberCount: 9, monthCostUsd: 402.91 },
  { id: 'ws_dente', name: 'Dente Feliz', slug: 'dente-feliz', subscriptionStatus: 'canceled', planKey: null, planName: null, memberCount: 1, monthCostUsd: 0 },
  { id: 'ws_eco', name: 'Eco Solar Instalações', slug: 'eco-solar', subscriptionStatus: 'expired', planKey: 'starter', planName: 'Starter', memberCount: 3, monthCostUsd: 3.05 },
].map((t, i) => ({ ...t, trialEndsAt: t.subscriptionStatus === 'trial' ? isoAhead(9 * DAY) : null, createdAt: iso((120 - i * 17) * DAY) }));

const W360 = {
  summary: {
    id: WS,
    name: 'Clínica Aurora',
    slug: 'clinica-aurora',
    industry: 'Saúde',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    createdAt: iso(120 * DAY),
    planKey: 'pro',
    planName: 'Pro',
    owner: { id: 'mem_ana', name: 'Ana Souza', email: 'ana@aurora.test' },
  },
  usage: { monthCostUsd: 184.37, monthTokens: 12_480_331, capUsd: 250, pctOfCap: 0.737 },
  members: [
    { id: 'mem_ana', name: 'Ana Souza', email: 'ana@aurora.test', role: 'OWNER', lastSeenAt: iso(2 * HOUR) },
    { id: 'mem_bruno', name: 'Bruno Lima', email: 'bruno@aurora.test', role: 'SUPERVISOR', lastSeenAt: iso(DAY) },
    { id: 'mem_carla', name: 'Carla Dias', email: 'carla@aurora.test', role: 'AGENT', lastSeenAt: null },
  ],
  channels: [
    { id: 'ch_wa', provider: 'meta_whatsapp', name: 'WhatsApp Recepção', isActive: true },
    { id: 'ch_ig', provider: 'meta_instagram', name: 'Instagram Aurora', isActive: false },
  ],
  agents: [
    { id: 'ag_sdr', name: 'SDR Aurora', model: 'anthropic/claude-sonnet-4.5', status: 'active' },
    { id: 'ag_pos', name: 'Pós-venda', model: 'openai/gpt-4.1-mini', status: 'inactive' },
  ],
  health: { failedWebhookDeliveries: 2, openConversations: 37, openDeals: 14, capExceeded: false, trialExpired: false },
  recentAudit: [
    { id: 'au_1', action: 'agent.updated', resourceType: 'agent', actorType: 'member', createdAt: iso(3 * HOUR) },
    { id: 'au_2', action: 'subscription.changed', resourceType: 'workspace', actorType: 'platform', createdAt: iso(2 * DAY) },
    { id: 'au_3', action: 'channel.connected', resourceType: 'channel', actorType: 'member', createdAt: iso(5 * DAY) },
  ],
};

const PLANS = [
  { id: 'pl_starter', key: 'starter', name: 'Starter', description: null, priceMonthlyCents: 19_900, priceYearlyCents: 199_000, limits: { max_agents: 1, max_channels: 1, max_members: 3 }, features: { flows: true, calendar: true }, isActive: true, position: 0, createdAt: iso(300 * DAY) },
  { id: 'pl_pro', key: 'pro', name: 'Pro', description: null, priceMonthlyCents: 49_900, priceYearlyCents: 499_000, limits: { max_agents: 5, max_channels: 3, max_members: 10, max_monthly_messages: 20_000 }, features: { flows: true, calendar: true, campaigns: true, instagram: true, knowledge_base: true }, isActive: true, position: 1, createdAt: iso(300 * DAY) },
  { id: 'pl_legacy', key: 'legacy-2025', name: 'Legado 2025', description: null, priceMonthlyCents: 9_900, priceYearlyCents: 0, limits: { max_agents: 1 }, features: {}, isActive: false, position: 2, createdAt: iso(500 * DAY) },
];

const SUBSCRIPTION = {
  workspaceId: WS,
  planId: 'pl_pro',
  status: 'active',
  trialEndsAt: null,
  billingCycle: 'monthly',
  entitlements: {
    workspaceId: WS,
    planId: 'pl_pro',
    planKey: 'pro',
    planName: 'Pro',
    limits: { max_agents: 8, max_channels: 3, max_members: 10, max_monthly_messages: 20_000 },
    features: { flows: true, calendar: true, campaigns: true, instagram: true, knowledge_base: true, api_access: true },
    planLimits: { max_agents: 5, max_channels: 3, max_members: 10, max_monthly_messages: 20_000 },
    planFeatures: { flows: true, calendar: true, campaigns: true, instagram: true, knowledge_base: true },
    overrideLimits: { max_agents: 8 },
    overrideFeatures: { api_access: true },
  },
};

function model(id: string, slug: string, displayName: string, provider: string, ctx: number, inP: number, outP: number, extra: object = {}) {
  return {
    id,
    slug,
    displayName,
    upstreamProvider: provider,
    contextLength: ctx,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    pricingPromptPer1m: inP,
    pricingCompletionPer1m: outP,
    isActive: true,
    defaultPlanKeys: ['pro'],
    notes: null,
    syncedAt: iso(DAY),
    ...extra,
  };
}

const MODELS = [
  model('m1', 'anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5', 'anthropic', 200_000, 3, 15, { supportsVision: true }),
  model('m2', 'openai/gpt-4.1-mini', 'GPT-4.1 mini', 'openai', 1_047_576, 0.4, 1.6, { supportsVision: true }),
  model('m3', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash', 'google', 1_048_576, 0.3, 2.5),
  model('m4', 'meta-llama/llama-3.3-70b', 'Llama 3.3 70B', 'meta-llama', 131_072, 0.13, 0.4, { isActive: false, supportsTools: false }),
];

const POLICY = {
  workspaceId: WS,
  allowedModels: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4.1-mini'],
  defaultChatModel: 'anthropic/claude-sonnet-4.5',
  allowStreaming: true,
  allowInterrupts: false,
  allowParallelTools: true,
  allowVision: true,
  allowTranscription: true,
  allowPersistentCheckpoints: false,
  allowAgentConversions: true,
  agentConversionRequireApproval: true,
  maxIterations: 12,
  maxToolsPerAgent: 20,
  maxTokensPerCall: 4096,
  maxMonthlyCostUsd: '250',
  maxDailyInvocations: null,
  allowedToolCategories: [],
  updatedBy: null,
  updatedAt: iso(3 * DAY),
};

/** Metadados SÓ. O valor de um segredo nunca vem da API — e o teste prova que não aparece. */
const SECRETS = [
  { key: 'openrouter_api_key', keyVersion: 4, updatedAt: iso(12 * DAY), isSet: true },
  { key: 'openai_api_key', keyVersion: 2, updatedAt: iso(40 * DAY), isSet: true },
  { key: 'meta_app_id', keyVersion: 1, updatedAt: iso(90 * DAY), isSet: true },
  { key: 'meta_app_secret', keyVersion: 3, updatedAt: iso(20 * DAY), isSet: true },
  { key: 'meta_webhook_verify_token', keyVersion: 0, updatedAt: null, isSet: false },
];

const BUCKETS_BY_DAY = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(NOW - (13 - i) * DAY);
  const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const cost = 18 + ((i * 37) % 23) + (i % 4 === 0 ? 14 : 0);
  return { key: d.toISOString().slice(0, 10), label, costUsd: cost + 0.37, totalTokens: cost * 61_000, requests: cost * 41 };
});

const SPENDERS = [
  { workspaceId: 'ws_casa', workspaceName: 'Casa Norte Imóveis', costUsd: 402.91, totalTokens: 27_100_220 },
  { workspaceId: WS, workspaceName: 'Clínica Aurora', costUsd: 184.37, totalTokens: 12_480_331 },
  { workspaceId: 'ws_bento', workspaceName: 'Bento Móveis', costUsd: 12.4, totalTokens: 811_045 },
];

const CAP_ALERTS = [
  { workspaceId: 'ws_casa', workspaceName: 'Casa Norte Imóveis', monthCostUsd: 402.91, capUsd: 400, pctOfCap: 1.007 },
  { workspaceId: WS, workspaceName: 'Clínica Aurora', monthCostUsd: 184.37, capUsd: 220, pctOfCap: 0.838 },
];

const SYNC_HEALTH = {
  generatedAt: iso(20_000),
  mq: { reachable: true },
  queues: [
    { name: 'messages.outbound', messages: 12, ready: 12, unacked: 3, consumers: 4 },
    { name: 'media.download', messages: 0, ready: 0, unacked: 0, consumers: 2 },
    { name: 'flows.execute', messages: 7, ready: 7, unacked: 0, consumers: 0 },
  ],
  dlq: { name: 'messages.dlq', messages: 3 },
  retryInFlight: 5,
  pending: { messages: 12, mediaFailed: 0 },
  channels: [
    { id: 'ch1', name: 'WhatsApp Recepção', provider: 'meta_whatsapp', phoneNumber: '+55 11 99876-5432', isActive: true, hasToken: true, qualityRating: 'GREEN', status: 'connected' },
    { id: 'ch2', name: 'WhatsApp Vendas', provider: 'meta_whatsapp', phoneNumber: '+55 11 91234-0000', isActive: true, hasToken: true, qualityRating: 'YELLOW', status: 'warning' },
    { id: 'ch3', name: 'WAHA Suporte', provider: 'waha', phoneNumber: null, isActive: true, hasToken: false, qualityRating: null, status: 'unlinked' },
  ],
};

const SESSIONS = [
  { id: 'imp_1', adminMemberId: ADMIN.id, targetWorkspaceId: WS, mode: 'view', reason: 'Investigar mensagem não entregue (ticket #482)', startedAt: iso(25 * 60_000), expiresAt: isoAhead(35 * 60_000) },
];

const THREADS = [
  { id: 'th_1', workspaceId: WS, subject: 'Webhook do WhatsApp parou de chegar', status: 'open', priority: 'high', assignedTo: null, lastMessageAt: iso(40 * 60_000), createdAt: iso(3 * HOUR) },
  { id: 'th_2', workspaceId: 'ws_bento', subject: 'Como importar contatos por CSV?', status: 'pending', priority: 'normal', assignedTo: ADMIN.id, lastMessageAt: iso(5 * HOUR), createdAt: iso(DAY) },
  { id: 'th_3', workspaceId: 'ws_casa', subject: 'Fatura de outubro', status: 'resolved', priority: 'low', assignedTo: null, lastMessageAt: iso(3 * DAY), createdAt: iso(4 * DAY) },
];

const MESSAGES = [
  { id: 'msg_1', threadId: 'th_1', senderType: 'member', senderId: 'mem_ana', body: 'Desde ontem às 18h as mensagens do WhatsApp não chegam na inbox.', createdAt: iso(3 * HOUR) },
  { id: 'msg_2', threadId: 'th_1', senderType: 'platform', senderId: ADMIN.id, body: 'Oi, Ana! Vi que o token do canal expirou. Pode reconectar em Canais? Acompanho daqui.', createdAt: iso(2 * HOUR) },
  { id: 'msg_3', threadId: 'th_1', senderType: 'member', senderId: 'mem_ana', body: 'Reconectei, mas ainda nada.', createdAt: iso(40 * 60_000) },
];

const CATEGORIES = [
  { id: 'cat_1', slug: 'primeiros-passos', title: 'Primeiros passos', description: null, icon: null, order: 0 },
  { id: 'cat_2', slug: 'agentes', title: 'Agentes IA', description: null, icon: null, order: 1 },
];

const ARTICLES = [
  { id: 'art_1', categoryId: 'cat_2', slug: 'como-criar-um-agente', title: 'Como criar um agente', excerpt: 'Do template ao primeiro atendimento.', status: 'published', order: 0, anchorKey: 'agents.create' },
  { id: 'art_2', categoryId: 'cat_2', slug: 'politica-de-modelos', title: 'Política de modelos', excerpt: null, status: 'draft', order: 1, anchorKey: null },
  { id: 'art_3', categoryId: 'cat_1', slug: 'conectar-whatsapp', title: 'Conectar o WhatsApp', excerpt: 'Coexistência e número novo.', status: 'published', order: 0, anchorKey: null },
];

const ARTICLE_BODY = '## Antes de começar\n\nVocê precisa de um **canal conectado**.\n\n1. Abra *Agentes*\n2. Clique em `Criar agente`\n';

// ── Rotas ────────────────────────────────────────────────────────────────────

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Recorder {
  /** Escritas (não-GET) que chegaram à API de plataforma. */
  writes: string[];
}

async function installRoutes(page: Page): Promise<Recorder> {
  const rec: Recorder = { writes: [] };

  await page.route('**/api/platform/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method !== 'GET') rec.writes.push(`${method} ${path}`);

    if (path === '/api/platform/tenants') {
      const status = url.searchParams.get('status');
      const rows = status ? TENANTS.filter((t) => t.subscriptionStatus === status) : TENANTS;
      return json(route, { tenants: rows, total: rows.length, limit: 25, offset: 0 });
    }
    if (path === `/api/platform/tenants/${WS}/subscription`) return json(route, SUBSCRIPTION);
    if (path.startsWith('/api/platform/tenants/')) {
      const id = path.split('/')[4] ?? '';
      if (id === WS) return json(route, W360);
      return json(route, { message: 'Tenant não encontrado.' }, 404);
    }
    if (path === '/api/platform/plans') return json(route, { plans: PLANS });
    if (path === '/api/platform/models') return json(route, { models: MODELS });
    if (path === '/api/platform/workspaces') {
      return json(route, { workspaces: TENANTS.map(({ id, name, slug }) => ({ id, name, slug })) });
    }
    if (path.endsWith('/agent-policy')) return json(route, { policy: POLICY });
    if (path === '/api/platform/secrets') return json(route, { secrets: SECRETS });
    if (path === '/api/platform/usage/summary') {
      const by = url.searchParams.get('groupBy');
      if (by === 'workspace') {
        return json(route, {
          buckets: SPENDERS.map((s) => ({ key: s.workspaceId, label: s.workspaceName, costUsd: s.costUsd, totalTokens: s.totalTokens, requests: 900 })),
        });
      }
      return json(route, { buckets: BUCKETS_BY_DAY });
    }
    if (path === '/api/platform/usage/top-spenders') return json(route, { spenders: SPENDERS });
    if (path === '/api/platform/usage/cap-alerts') return json(route, { alerts: CAP_ALERTS });
    if (path === '/api/platform/impersonation') {
      if (method === 'POST') return json(route, { message: 'bloqueado no teste' }, 500);
      return json(route, { sessions: SESSIONS });
    }
    if (path === '/api/platform/support/threads') return json(route, { threads: THREADS });
    if (path.startsWith('/api/platform/support/threads/')) {
      const id = path.split('/')[5] ?? '';
      const thread = THREADS.find((t) => t.id === id);
      return thread
        ? json(route, { thread, messages: MESSAGES.filter((m) => m.threadId === id) })
        : json(route, { message: 'not found' }, 404);
    }
    if (path === '/api/platform/help/categories') return json(route, { categories: CATEGORIES });
    if (path === '/api/platform/help/articles') {
      const cat = url.searchParams.get('categoryId');
      return json(route, { articles: cat ? ARTICLES.filter((a) => a.categoryId === cat) : ARTICLES });
    }
    if (path.startsWith('/api/platform/help/articles/')) {
      const id = path.split('/')[5] ?? '';
      const a = ARTICLES.find((x) => x.id === id);
      return a
        ? json(route, { article: { ...a, bodyMd: ARTICLE_BODY, publishedAt: iso(DAY), updatedAt: iso(DAY) } })
        : json(route, { message: 'not found' }, 404);
    }
    return json(route, { message: `rota de plataforma sem mock: ${path}` }, 404);
  });

  await page.route('**/api/monitoring/sync-health', (route) => json(route, SYNC_HEALTH));
  return rec;
}

/** Espera toda animação/transição em curso terminar (o axe e o contraste leem cor computada). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  await page.waitForTimeout(150);
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });

/**
 * `<select>` dentro do `<label>` (FieldLabel): o nome acessível nativo inclui a opção
 * escolhida ("Agente Selecione…"), então o rótulo é casado pelo início.
 */
const field = (page: Page, label: string) =>
  page.getByRole('combobox', { name: new RegExp(`^${label}(\\s|$)`) });

// ── Telas ────────────────────────────────────────────────────────────────────

interface Screen {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: 'hub',
    path: '/platform',
    ready: async (page) => {
      await expect(h1(page, 'Plataforma')).toBeVisible();
      await expect(page.getByRole('link', { name: /Workspace 360|Tenants/ }).first()).toBeVisible();
    },
  },
  {
    name: 'tenants',
    path: '/platform/tenants',
    ready: async (page) => {
      await expect(h1(page, 'Tenants')).toBeVisible();
      await expect(page.getByText('Casa Norte Imóveis').first()).toBeVisible();
      await expect(page.getByText('Inadimplente').first()).toBeVisible();
    },
  },
  {
    name: 'tenant-360',
    path: `/platform/tenants/${WS}`,
    ready: async (page) => {
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await expect(page.getByText('Custo de IA (mês)')).toBeVisible();
      await expect(page.getByText('Sinais de risco')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Auditoria recente' })).toBeVisible();
    },
  },
  {
    name: 'planos',
    path: '/platform/plans',
    ready: async (page) => {
      await expect(h1(page, 'Planos')).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Pro', exact: true })).toBeVisible();
    },
  },
  {
    name: 'assinaturas',
    path: `/platform/subscriptions?workspace=${WS}`,
    ready: async (page) => {
      await expect(h1(page, 'Assinaturas')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Entitlements efetivos' })).toBeVisible();
    },
  },
  {
    name: 'modelos',
    path: '/platform/models',
    ready: async (page) => {
      await expect(h1(page, 'Modelos')).toBeVisible();
      await expect(page.getByText('Claude Sonnet 4.5').first()).toBeVisible();
    },
  },
  {
    name: 'politicas',
    path: '/platform/policies',
    ready: async (page) => {
      await expect(h1(page, 'Políticas de agente')).toBeVisible();
      await expect(field(page, 'Workspace')).toBeVisible();
    },
    open: async (page) => {
      await field(page, 'Workspace').selectOption(WS);
      await expect(page.getByRole('heading', { name: 'Features de agente' })).toBeVisible();
    },
  },
  {
    name: 'segredos',
    path: '/platform/secrets',
    ready: async (page) => {
      await expect(h1(page, 'Segredos')).toBeVisible();
      await expect(page.getByText('openrouter_api_key').first()).toBeVisible();
    },
  },
  {
    name: 'uso',
    path: '/platform/usage',
    ready: async (page) => {
      await expect(h1(page, 'Uso e custo de IA')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Maiores gastos do mês' })).toBeVisible();
      await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
    },
  },
  {
    name: 'monitoramento',
    path: '/platform/monitoring',
    ready: async (page) => {
      await expect(h1(page, 'Saúde da sincronização')).toBeVisible();
      await expect(page.getByText('flows.execute').first()).toBeVisible();
    },
  },
  {
    name: 'playground',
    path: `/platform/playground?workspace=${WS}`,
    ready: async (page) => {
      await expect(h1(page, 'Playground')).toBeVisible();
      await expect(field(page, 'Agente')).toBeEnabled();
    },
    open: async (page) => {
      await field(page, 'Agente').selectOption('ag_sdr');
      await expect(page.getByRole('textbox', { name: 'Mensagem de teste' })).toBeEnabled();
    },
  },
  {
    name: 'ver-como',
    path: `/platform/impersonation?workspace=${WS}`,
    ready: async (page) => {
      await expect(h1(page, 'Ver como')).toBeVisible();
      await expect(page.getByText('Investigar mensagem não entregue (ticket #482)').first()).toBeVisible();
    },
  },
  {
    name: 'suporte',
    path: '/platform/support',
    ready: async (page) => {
      await expect(h1(page, 'Suporte')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Webhook do WhatsApp parou de chegar/ })).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: /^Webhook do WhatsApp parou de chegar/ }).click();
      await expect(page.getByText('Reconectei, mas ainda nada.')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Resposta da equipe' })).toBeVisible();
    },
  },
  {
    name: 'ajuda',
    path: '/platform/help',
    ready: async (page) => {
      await expect(h1(page, 'Central de Ajuda')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Como criar um agente/ })).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: /^Como criar um agente/ }).click();
      await expect(page.getByRole('heading', { name: 'Editar artigo' })).toBeVisible();
      await expect(page.getByLabel('Título')).toHaveValue('Como criar um agente');
    },
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    test.describe(`Plataforma DS 3.0 — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      for (const screen of SCREENS) {
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          test.setTimeout(90_000);
          await useTheme(page, theme);
          await installRoutes(page);
          await page.goto(screen.path);
          // O guard de servidor deixou entrar (sem ele, o layout redireciona para `/`).
          await expect(page).toHaveURL(new RegExp(`${screen.path.split('?')[0]}`));
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page);
          await screen.open?.(page);
          await settled(page);

          const label = `${screen.name} ${size.width} ${theme}`;
          await expectNoSeriousAxe(page, { label });
          await expectTextContrast(page, 'body', label);
          await capture(page, SHOTS, `platform-${screen.name}`, theme);
          // O painel rola no documento (não no <main>): a página inteira vai à parte.
          // Viewport esticada (não `fullPage`): o bottom-sheet fechado da navegação mobile mora
          // logo abaixo da dobra e o `fullPage` o fotografaria como se estivesse aberto.
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          if (height > size.height + 4) {
            await page.setViewportSize({ width: size.width, height: Math.min(height, 6000) });
            await page.waitForTimeout(150);
            await page.screenshot({
              path: `${SHOTS}/platform-${screen.name}-${size.width}-${theme}-inteira.png`,
              animations: 'disabled',
            });
            await page.setViewportSize({ width: size.width, height: size.height });
          }
        });
      }
    });
  }
}

// ── Comportamento e segurança ────────────────────────────────────────────────

test.describe('Plataforma — chrome e segurança', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('shell: modo plataforma visível, navegação agrupada e item ativo', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/platform/models');
    await expect(h1(page, 'Modelos')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navegação de plataforma' });
    await expect(nav.getByRole('link', { name: 'Modelos' })).toHaveAttribute('aria-current', 'page');
    for (const group of ['Workspaces', 'IA', 'Operação']) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Modo plataforma')).toBeVisible();
    await expect(page.getByText(ADMIN.name)).toBeVisible();
  });

  test('tenants: clicar na linha abre o Workspace 360', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/platform/tenants');
    await page.getByRole('row', { name: 'Abrir 360 de Clínica Aurora' }).click();
    await expect(page).toHaveURL(new RegExp(`/platform/tenants/${WS}$`));
    await expect(h1(page, 'Clínica Aurora')).toBeVisible();
  });

  test('360: atalhos levam a assinatura, playground e view-as do tenant', async ({ page }) => {
    await installRoutes(page);
    await page.goto(`/platform/tenants/${WS}`);
    const actions = page.getByRole('navigation', { name: 'Ações do tenant' });
    await expect(actions.getByRole('link', { name: 'Assinatura' })).toHaveAttribute('href', `/platform/subscriptions?workspace=${WS}`);
    await expect(actions.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', `/platform/playground?workspace=${WS}`);
    await expect(actions.getByRole('link', { name: 'Ver como' })).toHaveAttribute('href', `/platform/impersonation?workspace=${WS}`);
  });

  test('360: tenant inexistente vira erro em 3 partes com volta à lista', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/platform/tenants/ws_sumiu');
    await expect(h1(page, 'Tenant não encontrado')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Tenants', exact: true })).toHaveAttribute(
      'href',
      '/platform/tenants',
    );
  });

  test('segredos: só metadados na tela; rotação pede valor oculto + confirmação', async ({ page }) => {
    const rec = await installRoutes(page);
    await page.goto('/platform/secrets');
    await expect(page.getByText('openrouter_api_key').first()).toBeVisible();
    // Nada com cara de chave aparece (a API nem manda valor; a tela não inventa).
    await expect(page.locator('body')).not.toContainText(/sk-[A-Za-z0-9]|sk-or-/);

    await page.getByRole('button', { name: 'Rotacionar openrouter_api_key' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rotacionar openrouter_api_key' });
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel('Novo valor');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    const go = dialog.getByRole('button', { name: 'Rotacionar agora' });
    await expect(go).toBeDisabled();
    await field.fill('sk-or-v1-segredo-de-teste');
    // Valor sozinho não basta: falta o "Entendo…".
    await expect(go).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /Entendo que um valor errado/ }).check();
    await expect(go).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    expect(rec.writes).toEqual([]);
  });

  test('ver como: motivo curto bloqueia antes de qualquer POST; Esc fecha', async ({ page }) => {
    const rec = await installRoutes(page);
    await page.goto(`/platform/impersonation?workspace=${WS}`);
    await page.getByRole('button', { name: 'Ver como', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ver como o tenant (somente leitura)' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Motivo (obrigatório)').fill('abc');
    await dialog.getByRole('button', { name: 'Iniciar view-as' }).click();
    await expect(dialog.getByRole('alert')).toContainText('pelo menos 5 caracteres');
    expect(rec.writes).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('uso: barras na marca de texto a 40% (nunca o verde cheio)', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/platform/usage');
    const bar = page.locator('.recharts-bar-rectangle path').first();
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('fill', 'var(--brand-text)');
    await expect(bar).toHaveAttribute('fill-opacity', '0.4');
  });
});
