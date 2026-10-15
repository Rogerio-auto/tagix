/**
 * F72-S07 (sub-lote d) — varredura DS 3.0: Configurações (casca + seções pessoais, do
 * workspace, dados e dev), onboarding (wizard e "Primeiros passos"), canais e a Central de
 * Modelos de mensagem.
 *
 * Para cada tela, nos temas escuro e claro, em 375 e 1440: carrega com a rede mockada
 * (fixture `mock` + rotas deste spec, que têm precedência), roda o axe sem violação
 * séria/crítica, mede o contraste do texto (≥4,5:1) e salva a captura em
 * `e2e/.artifacts/f72-s07/<tela>-<largura>-<tema>.png`.
 *
 * Mais: empresa em só leitura → convidar membro, salvar o workspace, adicionar tag, nova API
 * key e conectar/desativar canal ficam focáveis, `aria-disabled` e descritos pela
 * explicação; o clique não escreve nada. O caminho de saída (perfil, sessões) segue livre.
 *
 * Locale e fuso fixos: o código formata com o `lang` do documento (regra F59); o navegador
 * de teste é o usuário brasileiro que a captura precisa provar.
 *
 * AMBIENTE: rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { CHANNEL, ME, ONBOARDING_STATE } from '../fixtures/seed';
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
const HOUR = 3_600_000;
const NOW = Date.now();
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const isoAhead = (ms: number): string => new Date(NOW + ms).toISOString();

// ── Dados ─────────────────────────────────────────────────────────────────────

const WS = ME.workspace.id;

/** `/api/me` completo (o painel pessoal lê e-mail, papel e preferências daqui). */
function meBody(subscriptionStatus: 'active' | 'expired') {
  return {
    member: {
      id: ME.member.id,
      workspaceId: WS,
      name: 'Ana QA',
      email: 'ana@aurora.test',
      role: 'OWNER',
      status: 'active',
      themePreference: 'dark',
      densityPreference: 'comfortable',
    },
    workspace: { id: WS, name: 'Clínica Aurora', subscriptionStatus, trialEndsAt: null },
    memberships: [{ workspaceId: WS, name: 'Clínica Aurora', slug: 'aurora', role: 'OWNER', subscriptionStatus }],
  };
}

function member(id: string, name: string | null, email: string, role: string, status: string, extra: object = {}) {
  return {
    id,
    email,
    name,
    role,
    status,
    avatarUrl: null,
    isOnline: status === 'active',
    lastSeenAt: null,
    createdAt: iso(90 * DAY),
    ...extra,
  };
}

const MEMBERS = [
  member(ME.member.id, 'Ana QA', 'ana@aurora.test', 'OWNER', 'active'),
  member('mem_bruno', 'Bruno Lima', 'bruno@aurora.test', 'SUPERVISOR', 'active'),
  member('mem_carla', 'Carla Dias', 'carla@aurora.test', 'AGENT', 'active'),
  member('mem_davi', 'Davi Rocha', 'davi@aurora.test', 'AGENT', 'blocked'),
  member('mem_eva', null, 'eva@aurora.test', 'AGENT', 'inactive'),
];

const INVITES = {
  invites: [
    {
      id: 'inv_1',
      email: 'fabio@aurora.test',
      role: 'AGENT',
      createdAt: iso(2 * DAY),
      expiresAt: isoAhead(5 * DAY),
      expired: false,
      lastSentAt: iso(3 * HOUR),
      sendCount: 2,
      resendsLeft: 3,
    },
    {
      id: 'inv_2',
      email: 'gabi@aurora.test',
      role: 'READONLY',
      createdAt: iso(10 * DAY),
      expiresAt: iso(3 * DAY),
      expired: true,
      lastSentAt: iso(10 * DAY),
      sendCount: 1,
      resendsLeft: 0,
    },
  ],
  seats: { used: 4, limit: 5 },
};

const DEPARTMENTS = [
  { id: 'dep_vendas', name: 'Vendas', description: 'Novos negócios', isActive: 'active' },
  { id: 'dep_suporte', name: 'Suporte', description: null, isActive: 'active' },
];

const TEAMS = [
  {
    id: 'team_sp',
    name: 'Vendas SP',
    description: null,
    departmentId: 'dep_vendas',
    autoAssignStrategy: 'round_robin',
    peerVisibility: 'shared',
    isActive: 'active',
    members: [
      { teamId: 'team_sp', memberId: 'mem_bruno', role: 'lead', name: 'Bruno Lima', email: 'bruno@aurora.test' },
      { teamId: 'team_sp', memberId: 'mem_carla', role: 'member', name: 'Carla Dias', email: 'carla@aurora.test' },
    ],
  },
];

const WORKSPACE = {
  workspace: {
    id: WS,
    name: 'Clínica Aurora',
    slug: 'aurora',
    industry: 'health',
    // Fuso salvo do workspace: DADO de teste (o componente lista os fusos do runtime).
    // eslint-disable-next-line no-restricted-syntax
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    logoUrl: null,
    settings: {
      auto_assign: { strategy: 'round_robin', fallbackToManual: true },
      business_hours: {
        enabled: true,
        awayMessage: 'Estamos fora do horário. Respondemos a partir das 9h.',
        days: [
          { open: false, from: '09:00', to: '18:00' },
          { open: true, from: '08:00', to: '18:00' },
          { open: true, from: '08:00', to: '18:00' },
          { open: true, from: '08:00', to: '18:00' },
          { open: true, from: '08:00', to: '18:00' },
          { open: true, from: '08:00', to: '17:00' },
          { open: true, from: '09:00', to: '13:00' },
        ],
      },
    },
  },
};

const TAGS = {
  tags: [
    // Cores escolhidas pelo usuário: DADO de teste no formato que a API exige (#RRGGBB).
    // eslint-disable-next-line no-restricted-syntax
    { id: 'tag_vip', name: 'VIP', color: '#F5B700', createdAt: iso(40 * DAY), usageCount: 1284 },
    // eslint-disable-next-line no-restricted-syntax
    { id: 'tag_ret', name: 'Retorno', color: '#3FA7FF', createdAt: iso(20 * DAY), usageCount: 37 },
    // eslint-disable-next-line no-restricted-syntax
    { id: 'tag_orc', name: 'Orçamento enviado', color: '#9B6CFF', createdAt: iso(5 * DAY), usageCount: 1 },
  ],
};

const AUDIT = {
  logs: [
    {
      id: 'au_1',
      actorMemberId: ME.member.id,
      actorName: 'Ana QA',
      actorEmail: 'ana@aurora.test',
      actorType: 'member',
      action: 'member.invite',
      resourceType: 'member',
      resourceId: 'inv_1',
      metadata: {},
      ipAddress: '189.44.12.7',
      createdAt: iso(3 * HOUR),
    },
    {
      id: 'au_2',
      actorMemberId: null,
      actorName: null,
      actorEmail: null,
      actorType: 'api',
      action: 'apikey.create',
      resourceType: 'api_key',
      resourceId: 'key_1',
      metadata: {},
      ipAddress: '34.95.0.12',
      createdAt: iso(2 * DAY),
    },
    {
      id: 'au_3',
      actorMemberId: null,
      actorName: null,
      actorEmail: null,
      actorType: 'system',
      action: 'workspace.ai_origin_lock',
      resourceType: 'workspace',
      resourceId: WS,
      metadata: {},
      ipAddress: null,
      createdAt: iso(6 * DAY),
    },
  ],
  page: 1,
  pageSize: 50,
  total: 3,
  totalPages: 1,
};

const API_KEYS = {
  apiKeys: [
    {
      id: 'key_1',
      name: 'Integração n8n',
      keyPrefix: 'hm_live_7Fq2',
      scopes: ['read:conversations', 'write:messages'],
      rateLimitPerMinute: 1200,
      isActive: true,
      lastUsedAt: iso(20 * 60_000),
      expiresAt: null,
      createdAt: iso(30 * DAY),
      revokedAt: null,
    },
    {
      id: 'key_2',
      name: 'Script antigo',
      keyPrefix: 'hm_live_a91C',
      scopes: ['write:contacts'],
      rateLimitPerMinute: 60,
      isActive: false,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: iso(120 * DAY),
      revokedAt: iso(60 * DAY),
    },
  ],
};

const WEBHOOKS = {
  availableEvents: ['message.received', 'conversation.closed', 'deal.won'],
  webhooks: [
    {
      id: 'wh_1',
      name: 'CRM externo',
      url: 'https://crm.aurora.test/hooks/leadium',
      events: ['message.received', 'deal.won'],
      isActive: true,
      createdAt: iso(14 * DAY),
      updatedAt: null,
    },
  ],
};

const SESSIONS = {
  sessions: [
    { id: 'current', current: true, userAgent: 'Chrome 141 · Windows', ipAddress: '189.44.12.7', createdAt: iso(2 * HOUR) },
    { id: 'ses_2', current: false, userAgent: 'Safari · iPhone', ipAddress: '177.32.8.90', createdAt: iso(3 * DAY) },
  ],
};

const CHANNELS = {
  channels: [
    { ...CHANNEL },
    {
      ...CHANNEL,
      id: 'chan_ig',
      provider: 'meta_instagram',
      name: 'Instagram da clínica',
      displayHandle: '@clinica.aurora',
      phoneNumber: null,
      igUsername: 'clinica.aurora',
      igAccountType: 'business',
      isDefault: false,
    },
    {
      ...CHANNEL,
      id: 'chan_waha',
      provider: 'waha',
      name: 'WhatsApp recepção',
      displayHandle: null,
      phoneNumber: null,
      wahaSessionId: null,
      isDefault: false,
    },
  ],
};

function template(id: string, name: string, category: string, status: string, rejectionReason: string | null = null) {
  return {
    id,
    channelId: CHANNEL.id,
    externalId: `ext_${id}`,
    name,
    language: 'pt_BR',
    category,
    status,
    components: [{ type: 'BODY', text: 'Olá, {{1}}. Sua consulta é amanhã às {{2}}.' }],
    rejectionReason,
    isAvailable: true,
    lastSyncedAt: iso(HOUR),
    createdAt: iso(20 * DAY),
    updatedAt: null,
  };
}

const TEMPLATES = {
  templates: [
    template('mt_1', 'lembrete_consulta', 'UTILITY', 'APPROVED'),
    template('mt_2', 'promo_clareamento', 'MARKETING', 'PENDING'),
    template('mt_3', 'pesquisa_satisfacao', 'MARKETING', 'REJECTED', 'O texto promocional não pode estar na categoria Serviço.'),
  ],
  pagination: { page: 1, limit: 25, total: 3, totalPages: 1 },
  syncState: {
    syncStatus: 'idle',
    lastAttemptAt: iso(HOUR),
    lastSuccessfulSyncAt: iso(HOUR),
    lastFailedAt: null,
    lastError: null,
    lastItemCount: 3,
  },
};

const CHECKLIST = {
  steps: [
    { key: 'connect_channel', label: 'Conectar o WhatsApp', done: true, href: '/settings/channels' },
    { key: 'activate_agent', label: 'Ativar um agente', done: true, href: '/agents' },
    { key: 'import_contacts', label: 'Importar contatos', done: false, href: '/contacts' },
    { key: 'publish_flow', label: 'Publicar um fluxo', done: false, href: '/flows' },
    { key: 'send_campaign', label: 'Enviar uma campanha', done: false, href: '/campaigns' },
  ],
};

const GET_ROUTES: Record<string, unknown> = {
  '/api/members/me/sessions': SESSIONS,
  '/api/workspace': WORKSPACE,
  '/api/members': { members: MEMBERS },
  '/api/members/invites': INVITES,
  '/api/departments': { departments: DEPARTMENTS },
  '/api/teams': { teams: TEAMS },
  '/api/sla': {
    rules: [{ id: 'sla_ws', scopeType: 'workspace', scopeId: null, firstResponseSecs: 900, resolutionSecs: 14_400, isActive: 'active' }],
  },
  '/api/org/inbox-visibility': { policy: { defaultPeerVisibility: 'shared', readonlySeesAll: true } },
  '/api/workspace/ai-origin-lock': {
    aiRequiresProvenOrigin: true,
    lastChange: { at: iso(4 * DAY), byName: 'Ana QA', byEmail: 'ana@aurora.test', previous: false, next: true },
  },
  '/api/tags': TAGS,
  '/api/audit': AUDIT,
  '/api/dev/api-keys': API_KEYS,
  '/api/dev/webhooks': WEBHOOKS,
  '/api/dashboard/config': {
    config: { requiredByRole: { AGENT: ['my_open_conversations'] }, alertLimits: { slaViolationCount: 5, llmCostUsdDaily: 40 } },
    catalog: { AGENT: ['my_open_conversations', 'my_response_time', 'my_conversions'], OWNER: [], ADMIN: [], SUPERVISOR: [], READONLY: [] },
  },
  '/api/channels': CHANNELS,
  [`/api/channels/${CHANNEL.id}/message-templates`]: TEMPLATES,
  '/api/onboarding/checklist': CHECKLIST,
};

interface Scenario {
  readOnly?: boolean;
  onboardingPending?: boolean;
}

/** Rotas de dados das telas da varredura (precedem o roteador genérico da fixture). */
async function installSweepRoutes(page: Page, scenario: Scenario = {}): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/me') return json(route, meBody(scenario.readOnly ? 'expired' : 'active'));
    if (path === '/api/me/invites') return json(route, { invites: [] });
    if (path === '/api/onboarding/state' && scenario.onboardingPending) {
      return json(route, {
        ...ONBOARDING_STATE,
        onboarding: { niche_key: null, applied_at: null, survey: null, setup_completed: false },
      });
    }
    if (/^\/api\/org\/members\/[^/]+\/visibility-overrides$/.test(path)) {
      const memberId = path.split('/')[4] ?? '';
      return json(route, {
        memberId,
        overrides: memberId === 'mem_bruno' ? [{ departmentId: 'dep_suporte', departmentName: 'Suporte' }] : [],
      });
    }
    if (path in GET_ROUTES) return json(route, GET_ROUTES[path]);
    return route.fallback();
  });
}

// ── Telas ─────────────────────────────────────────────────────────────────────

interface Screen {
  name: string;
  path: string;
  scenario?: Scenario;
  /** Espera o conteúdo real (não o esqueleto). */
  ready: (page: Page, mobile: boolean) => Promise<void>;
  /** Ação depois de carregar (abrir painel/diálogo). A captura e o axe são do estado final. */
  open?: (page: Page, mobile: boolean) => Promise<void>;
  /** Escopo do contraste quando a tela é um overlay. */
  scope?: string;
  /** Captura inteira do `<main>` (telas que rolam). */
  full?: boolean;
  /** Só em uma das larguras (ex.: o índice de seções é a view-base do celular). */
  only?: 'mobile' | 'desktop';
}

const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const sectionTitle = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });

/** Seção de configurações: o título da seção aparece (desktop e celular). */
function settings(name: string, id: string, label: string, content: (page: Page) => Promise<void>): Screen {
  return {
    name: `config-${name}`,
    path: `/settings?s=${id}`,
    full: true,
    ready: async (page) => {
      await expect(sectionTitle(page, label)).toBeVisible();
      await content(page);
    },
  };
}

const SCREENS: Screen[] = [
  {
    name: 'config-indice',
    path: '/settings',
    only: 'mobile',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Configurações')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Seções de configurações' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Membros/ })).toBeVisible();
    },
  },
  {
    name: 'config-busca',
    path: '/settings?s=perfil',
    only: 'desktop',
    ready: async (page) => {
      await expect(sectionTitle(page, 'Perfil')).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('combobox', { name: 'Buscar configuração' }).fill('fuso');
      await expect(page.getByRole('listbox', { name: 'Seções encontradas' })).toBeVisible();
    },
  },
  settings('perfil', 'perfil', 'Perfil', async (page) => {
    await expect(page.getByLabel('Nome de exibição')).toHaveValue('Ana QA');
  }),
  settings('preferencias', 'preferencias', 'Preferências', async (page) => {
    await expect(page.getByRole('button', { name: 'Salvar preferências' })).toBeVisible();
  }),
  settings('notificacoes', 'notificacoes', 'Notificações', async (page) => {
    await expect(page.getByRole('switch', { name: 'Notificações no app' })).toBeVisible();
  }),
  settings('sessoes', 'sessoes', 'Sessões', async (page) => {
    await expect(page.getByText('Safari · iPhone').first()).toBeVisible();
  }),
  settings('atalhos', 'atalhos', 'Atalhos', async (page) => {
    await expect(page.locator('main').getByText('Ir para Conversas')).toBeVisible();
  }),
  settings('conta', 'conta', 'Conta', async (page) => {
    await expect(page.getByText('ana@aurora.test')).toBeVisible();
  }),
  settings('dashboard', 'dashboard', 'Dashboard', async (page) => {
    await expect(page.getByText('my_response_time')).toBeVisible();
  }),
  settings('workspace', 'workspace', 'Workspace', async (page) => {
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Clínica Aurora');
  }),
  settings('membros', 'membros', 'Membros', async (page) => {
    await expect(page.getByText('4 de 5 vagas em uso')).toBeVisible();
    await expect(page.getByText('fabio@aurora.test').first()).toBeVisible();
    await expect(page.getByText('carla@aurora.test').first()).toBeVisible();
  }),
  settings('departamentos', 'departamentos', 'Departamentos', async (page) => {
    await expect(page.getByText('Suporte', { exact: true }).first()).toBeVisible();
  }),
  settings('times', 'times', 'Times', async (page) => {
    await expect(page.getByRole('heading', { name: 'Vendas SP' })).toBeVisible();
  }),
  settings('distribuicao', 'auto-assign', 'Auto-assign', async (page) => {
    await expect(page.getByRole('radio', { name: /Rodízio/ })).toBeChecked();
  }),
  settings('horario', 'horario', 'Horário comercial', async (page) => {
    await expect(page.getByLabel('Seg início')).toHaveValue('08:00');
  }),
  settings('ia', 'ia', 'IA', async (page) => {
    await expect(page.getByRole('switch', { name: /Responder só quem chegou/ })).toBeVisible();
  }),
  settings('tags', 'tags', 'Tags', async (page) => {
    await expect(page.getByText('Orçamento enviado').first()).toBeVisible();
  }),
  settings('slas', 'slas', 'SLAs', async (page) => {
    await expect(page.getByLabel('Primeira resposta (min)')).toHaveValue('15');
  }),
  settings('visibilidade', 'visibilidade', 'Visibilidade da inbox', async (page) => {
    await expect(page.getByRole('list', { name: 'Acessos extras de Bruno Lima' })).toContainText('Suporte');
  }),
  settings('auditoria', 'auditoria', 'Auditoria', async (page) => {
    await expect(page.getByText('apikey.create').first()).toBeVisible();
  }),
  settings('dev', 'dev', 'Dev', async (page) => {
    await expect(page.getByText('Integração n8n').first()).toBeVisible();
    await expect(page.getByText('CRM externo').first()).toBeVisible();
  }),
  {
    name: 'config-dev-log',
    path: '/settings?s=dev',
    ready: async (page) => {
      await expect(page.getByText('CRM externo').first()).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Ver o log de entregas de CRM externo' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Log de entregas' })).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'canais',
    path: '/settings/channels',
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Canais')).toBeVisible();
      await expect(page.getByText('Instagram da clínica')).toBeVisible();
      await expect(page.getByText('Desautorizado').first()).toBeVisible();
    },
  },
  {
    name: 'canais-conectar',
    path: '/settings/channels',
    ready: async (page) => {
      await expect(page.getByText('Instagram da clínica')).toBeVisible();
    },
    open: async (page) => {
      await page.getByRole('button', { name: 'Conectar canal' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: /WhatsApp \(WAHA\)/ })).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'canais-modelos',
    path: `/settings/channels/${CHANNEL.id}/message-templates`,
    full: true,
    ready: async (page) => {
      await expect(h1(page, 'Modelos de mensagem do WhatsApp')).toBeVisible();
      await expect(page.getByText('lembrete_consulta').first()).toBeVisible();
    },
  },
  {
    name: 'canais-modelo-detalhe',
    path: `/settings/channels/${CHANNEL.id}/message-templates`,
    ready: async (page) => {
      await expect(page.getByText('pesquisa_satisfacao').first()).toBeVisible();
    },
    open: async (page, mobile) => {
      // Desktop: a linha da tabela é a ação primária (UX §2.1); celular: o card.
      const name = 'Ver detalhes de Pesquisa satisfacao';
      await (mobile ? page.getByRole('button', { name }) : page.getByRole('row', { name })).first().click();
      await expect(page.getByRole('dialog', { name: 'Pesquisa satisfacao' })).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'onboarding-boas-vindas',
    path: '/',
    scenario: { onboardingPending: true },
    ready: async (page) => {
      await expect(page.getByRole('dialog', { name: 'Configuração inicial da Leadium' })).toBeVisible();
      await expect(page.getByText('Bem-vindo à Leadium')).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'onboarding-nicho',
    path: '/',
    scenario: { onboardingPending: true },
    ready: async (page) => {
      await expect(page.getByRole('dialog', { name: 'Configuração inicial da Leadium' })).toBeVisible();
    },
    open: async (page) => {
      const dialog = page.getByRole('dialog', { name: 'Configuração inicial da Leadium' });
      await dialog.getByRole('button', { name: 'Começar' }).click();
      await dialog.getByRole('button', { name: /Vender mais|Atender|Agendar/ }).first().click();
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      await expect(dialog.getByRole('heading', { name: 'Escolha o seu nicho' })).toBeVisible();
    },
    scope: '[role="dialog"]',
  },
  {
    name: 'onboarding-primeiros-passos',
    path: '/',
    ready: async (page) => {
      await expect(page.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Importar contatos/ })).toBeVisible();
    },
    scope: 'section[aria-labelledby="setup-checklist-title"]',
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    const mobile = size.width < 768;
    test.describe(`Varredura DS 3.0 (d) — ${size.width} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      for (const screen of SCREENS) {
        if (screen.only === 'mobile' && !mobile) continue;
        if (screen.only === 'desktop' && mobile) continue;
        test(`${screen.name}: axe sem violação séria, contraste ≥4,5 e captura`, async ({ page }) => {
          test.setTimeout(90_000);
          await useTheme(page, theme);
          await installSweepRoutes(page, screen.scenario);
          await page.goto(screen.path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await screen.ready(page, mobile);
          await screen.open?.(page, mobile);
          // Movimento de entrada concluído antes de medir (o axe lê cor computada).
          await page.waitForTimeout(350);

          await expectNoSeriousAxe(page, { label: `${screen.name} ${size.width} ${theme}` });
          await expectTextContrast(page, screen.scope ?? 'main', `${screen.name} ${size.width} ${theme}`);
          await capture(page, SHOTS, screen.name, theme, { full: Boolean(screen.full) && !screen.scope });
        });
      }
    });
  }
}

// ── Só leitura ───────────────────────────────────────────────────────────────

/** Registra toda escrita (não-GET) em `/api/**` para provar que nada saiu. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

/** Botão guardado: focável, `aria-disabled`, descrito e a dica aparece no foco. */
async function expectGuardedFocus(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name }).first();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // `aria-disabled`, nunca `disabled`: continua no Tab. (O `toBeEnabled` do Playwright conta
  // `aria-disabled` como desabilitado, então a prova é o atributo + o foco.)
  await expect(button).not.toHaveAttribute('disabled');
  await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
  await button.focus();
  await expect(button).toBeFocused();
  const tipId = await button.getAttribute('aria-describedby');
  const tip = page.locator(`[id="${tipId ?? ''}"]`);
  await expect(tip).toHaveAttribute('role', 'tooltip');
  await expect(tip).toHaveText(READ_ONLY_TOOLTIP);
  await expect(tip).toHaveCSS('opacity', '1');
}

test.describe('Varredura DS 3.0 (d) — empresa em só leitura', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ['dark', 'light'] as const) {
    test(`membros: "Convidar membro" focável, aria-disabled, descrito e sem efeito — ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await useTheme(page, theme);
      await installSweepRoutes(page, { readOnly: true });
      const writes = recordWrites(page);
      await page.goto('/settings?s=membros');
      await expect(page.getByText('4 de 5 vagas em uso')).toBeVisible();

      await expectGuardedFocus(page, 'Convidar membro');
      await capture(page, SHOTS, 'config-membros-so-leitura', theme, { full: false });

      // `force`: o Playwright recusa clicar em `aria-disabled`; a pessoa, não.
      await page.getByRole('button', { name: 'Convidar membro' }).first().click({ force: true });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Convidar membro' })).toHaveCount(0);

      // Linha do membro e do convite: papel, remover, reenviar, copiar link, revogar.
      const role = page.getByRole('combobox', { name: 'Papel de carla@aurora.test' });
      await expect(role).toHaveAttribute('aria-disabled', 'true');
      await expect(role).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
      for (const name of [
        'Remover carla@aurora.test',
        'Reenviar convite para fabio@aurora.test',
        'Copiar link do convite de fabio@aurora.test',
        'Revogar convite de fabio@aurora.test',
      ]) {
        const button = page.getByRole('button', { name });
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await expect(button).not.toHaveAttribute('disabled');
        await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
      }
      await page.getByRole('button', { name: 'Revogar convite de fabio@aurora.test' }).click({ force: true });
      await expect(page.getByRole('dialog', { name: 'Revogar convite' })).toHaveCount(0);
      await role.selectOption('ADMIN', { force: true }).catch(() => undefined);
      await expect(role).toHaveValue('AGENT');

      // O filtro de visualização segue livre.
      await page.getByRole('switch', { name: 'Mostrar removidos' }).click();
      await expect(page.getByText('eva@aurora.test').first()).toBeVisible();

      await expectNoSeriousAxe(page, { label: `só leitura membros ${theme}` });
      expect(writes).toEqual([]);
    });
  }

  test('workspace, tags e dev: salvar, adicionar e criar guardados; nada é escrito', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page, { readOnly: true });
    const writes = recordWrites(page);

    await page.goto('/settings?s=workspace');
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Clínica Aurora');
    await page.getByLabel('Nome', { exact: true }).fill('Outra empresa');
    await expectGuardedFocus(page, 'Salvar workspace');
    await page.getByRole('button', { name: 'Salvar workspace' }).click({ force: true });

    await page.goto('/settings?s=tags');
    await expect(page.getByText('Orçamento enviado').first()).toBeVisible();
    await page.getByLabel('Nome da tag').first().fill('Nova');
    await page.getByLabel('Nome da tag').first().press('Enter');
    await expectGuardedFocus(page, 'Adicionar');
    await expectGuardedFocus(page, 'Excluir tag VIP');
    await page.getByRole('button', { name: 'Excluir tag VIP' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Excluir tag' })).toHaveCount(0);

    await page.goto('/settings?s=dev');
    await expect(page.getByText('Integração n8n').first()).toBeVisible();
    await expectGuardedFocus(page, 'Nova chave');
    await page.getByRole('button', { name: 'Nova chave' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Nova API key' })).toHaveCount(0);
    // O log de entregas é leitura: abre normalmente.
    await page.getByRole('button', { name: 'Ver o log de entregas de CRM externo' }).click();
    await expect(page.getByRole('dialog', { name: 'Log de entregas' })).toBeVisible();

    expect(writes).toEqual([]);
  });

  test('caminho de saída segue livre: salvar o perfil escreve e as sessões encerram', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page, { readOnly: true });
    const writes = recordWrites(page);

    await page.goto('/settings?s=perfil');
    await expect(page.getByLabel('Nome de exibição')).toHaveValue('Ana QA');
    await page.getByLabel('Nome de exibição').fill('Ana Q.');
    const save = page.getByRole('button', { name: 'Salvar perfil' });
    await expect(save).not.toHaveAttribute('aria-disabled');
    await save.click();
    await expect.poll(() => writes).toContain('PATCH /api/members/me');

    await page.goto('/settings?s=sessoes');
    const end = page.getByRole('button', { name: 'Encerrar sessão de Safari · iPhone' });
    await expect(end).not.toHaveAttribute('aria-disabled');
    await end.click();
    await expect(page.getByRole('dialog', { name: 'Encerrar sessão' })).toBeVisible();
  });

  test('canais: conectar, desativar e remover guardados; os modelos seguem abertos', async ({ page }) => {
    test.setTimeout(90_000);
    await useTheme(page, 'dark');
    await installSweepRoutes(page, { readOnly: true });
    const writes = recordWrites(page);
    await page.goto('/settings/channels');
    await expect(page.getByText('Instagram da clínica')).toBeVisible();

    await expectGuardedFocus(page, 'Conectar canal');
    await capture(page, SHOTS, 'canais-so-leitura', 'dark', { full: false });
    await page.getByRole('button', { name: 'Conectar canal' }).first().click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    for (const name of ['Desativar o canal WhatsApp Vendas', 'Remover canal WhatsApp Vendas']) {
      const button = page.getByRole('button', { name });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).not.toHaveAttribute('disabled');
      await expect(button).toHaveAccessibleDescription(READ_ONLY_TOOLTIP);
    }
    await page.getByRole('button', { name: 'Remover canal WhatsApp Vendas' }).click({ force: true });
    await expect(page.getByRole('dialog', { name: 'Remover canal' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Modelos de mensagem' }).first().click();
    await expect(h1(page, 'Modelos de mensagem do WhatsApp')).toBeVisible();
    await expectGuardedFocus(page, 'Sincronizar agora');
    await expectGuardedFocus(page, 'Criar modelo');

    await expectNoSeriousAxe(page, { label: 'só leitura canais' });
    expect(writes).toEqual([]);
  });

  test('onboarding: "Configurar meu espaço" guardado e a pesquisa não é enviada', async ({ page }) => {
    test.setTimeout(90_000);
    await installSweepRoutes(page, { readOnly: true, onboardingPending: true });
    const writes = recordWrites(page);
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Configuração inicial da Leadium' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Começar' }).click();
    await dialog.getByRole('button', { name: /Vender mais|Atender|Agendar/ }).first().click();
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await expect(dialog.getByRole('heading', { name: 'Escolha o seu nicho' })).toBeVisible();

    await expectGuardedFocus(page, 'Configurar meu espaço');
    await dialog.getByRole('button', { name: 'Configurar meu espaço' }).click({ force: true });
    await expect(dialog).toBeVisible();
    expect(writes.filter((w) => w.includes('/api/onboarding'))).toEqual([]);
  });
});
