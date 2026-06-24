'use client';

/**
 * SectionRegistry do painel de configurações (F8-S05 / PERMISSIONS.md §4/§5).
 *
 * Fonte única das seções de settings. O **shell** (S05) é dono deste registry e do
 * layout; os slots de seção (S04/S06/S07/S08) só preenchem
 * `features/settings/sections/<x>/**` e plugam aqui via `lazy()`. Enquanto um slot
 * não chega, a seção usa o `SectionStub` (placeholder honesto, não tela falsa).
 *
 * **Escopo workspace** (decisão do founder): só os grupos Pessoal + Workspace. A
 * camada Plataforma (`/platform/settings`) é a F2.5 e fica fora desta fase.
 *
 * Gating: cada seção declara a `permission` (matriz `can()` de @hm/shared) exigida
 * para aparecer/abrir. `keywords` alimenta a busca (Cmd+K) por nome/sinônimo.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Permission } from '@hm/shared';

export type SettingsGroup = 'pessoal' | 'workspace';

export interface CounterState {
  /** Texto curto exibido ao lado do item (ex.: "3 ativos"). */
  readonly label: string;
  /** `true` pinta o contador como alerta (ex.: token expirando). */
  readonly alert?: boolean;
}

export interface SettingsSection {
  readonly id: string;
  readonly group: SettingsGroup;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  /** Permissão exigida; ausente = qualquer member autenticado (seções pessoais). */
  readonly permission?: Permission;
  /**
   * Componente de conteúdo (lazy). Seções já implementadas em outras rotas apontam
   * `externalHref` em vez de `component` (deep-link para a página dedicada).
   */
  readonly component?: LazyExoticComponent<ComponentType>;
  readonly externalHref?: string;
}

/**
 * Loaders lazy dos slots de seção. Cada `import()` aponta para o subdir que o slot
 * dono preenche; o arquivo `index.tsx` exporta `default`. Como os arquivos ainda
 * não existem nesta fase, o registry usa stubs e os sub-slots TROCAM o loader do
 * seu id ao entregar (mudança mínima e localizada — não tocam o resto do shell).
 *
 * S06 → perfil/preferencias/notificacoes/sons/atalhos/sessoes/senha/conta + dashboard(S04)
 * S07 → workspace/membros/departamentos/times/auto-assign/horario/sla
 * S08 → tags/custom-fields/privacidade/compliance/auditoria
 */

// ─── PESSOAL (§4.1) ───────────────────────────────────────────────────────────
const PESSOAL: SettingsSection[] = [
  {
    id: 'perfil',
    group: 'pessoal',
    label: 'Perfil',
    description: 'Nome de exibição, avatar, telefone, idioma, bio.',
    keywords: ['perfil', 'avatar', 'nome', 'telefone', 'bio', 'idioma'],
    component: lazy(() => import('../sections/personal/ProfileSection')),
  },
  {
    id: 'preferencias',
    group: 'pessoal',
    label: 'Preferências',
    description: 'Tema, idioma da interface, fuso horário, formato de data e moeda.',
    keywords: ['tema', 'dark', 'light', 'fuso', 'timezone', 'idioma', 'data', 'moeda', 'preferências'],
    component: lazy(() => import('../sections/personal/PreferencesSection')),
  },
  {
    id: 'dashboard',
    group: 'pessoal',
    label: 'Dashboard',
    description: 'Cards visíveis, ordem dos cards, período padrão.',
    keywords: ['dashboard', 'cards', 'período', 'layout', 'pin', 'obrigatórios', 'sla', 'alerta'],
    component: lazy(() => import('../sections/dashboard/DashboardSettingsSection')),
  },
  {
    id: 'notificacoes',
    group: 'pessoal',
    label: 'Notificações',
    description: 'Toggles por canal (in-app, email, push).',
    keywords: ['notificações', 'email', 'push', 'in-app', 'alertas'],
    component: lazy(() => import('../sections/personal/NotificationsSection')),
  },
  {
    id: 'sons',
    group: 'pessoal',
    label: 'Sons',
    description: 'Som ao receber mensagem nova, volume.',
    keywords: ['som', 'sons', 'volume', 'áudio'],
    component: lazy(() => import('../sections/personal/SoundsSection')),
  },
  {
    id: 'atalhos',
    group: 'pessoal',
    label: 'Atalhos',
    description: 'Referência de atalhos de teclado.',
    keywords: ['atalhos', 'teclado', 'shortcuts'],
    component: lazy(() => import('../sections/personal/ShortcutsSection')),
  },
  {
    id: 'sessoes',
    group: 'pessoal',
    label: 'Sessões',
    description: 'Devices logados e encerramento de sessão.',
    keywords: ['sessões', 'devices', 'logout', 'segurança'],
    component: lazy(() => import('../sections/personal/SessionsSection')),
  },
  {
    id: 'senha',
    group: 'pessoal',
    label: 'Senha',
    description: 'Trocar senha ou gerenciar via provider externo.',
    keywords: ['senha', 'password', 'segurança'],
    component: lazy(() => import('../sections/personal/PasswordSection')),
  },
  {
    id: 'conta',
    group: 'pessoal',
    label: 'Conta',
    description: 'Email, MFA, exclusão de conta.',
    keywords: ['conta', 'email', 'mfa', 'exclusão'],
    component: lazy(() => import('../sections/personal/AccountSection')),
  },
];

// ─── WORKSPACE (§4.2) ─────────────────────────────────────────────────────────
const WORKSPACE: SettingsSection[] = [
  {
    id: 'workspace',
    group: 'workspace',
    label: 'Workspace',
    description: 'Nome, slug, logo, descrição, indústria, timezone, locale.',
    keywords: ['workspace', 'nome', 'slug', 'logo', 'timezone', 'locale', 'marca'],
    permission: 'workspace.edit',
    component: lazy(() => import('../sections/workspace-org/WorkspaceSection')),
  },
  {
    id: 'canais',
    group: 'workspace',
    label: 'Canais',
    description: 'Conectar/desconectar WhatsApp, Instagram, WAHA; status e qualidade.',
    keywords: ['canais', 'whatsapp', 'instagram', 'waha', 'meta', 'token'],
    permission: 'channel.connect',
    externalHref: '/settings/channels',
  },
  {
    id: 'membros',
    group: 'workspace',
    label: 'Membros',
    description: 'Convidar, listar, mudar role, remover.',
    keywords: ['membros', 'usuários', 'convidar', 'role', 'equipe'],
    permission: 'member.invite',
    component: lazy(() => import('../sections/workspace-org/MembersSection')),
  },
  {
    id: 'departamentos',
    group: 'workspace',
    label: 'Departamentos',
    description: 'Criar, editar, cor, ordem.',
    keywords: ['departamentos', 'setores'],
    permission: 'department.edit',
    component: lazy(() => import('../sections/workspace-org/DepartmentsSection')),
  },
  {
    id: 'times',
    group: 'workspace',
    label: 'Times',
    description: 'Criar, editar, alocar members, auto-assign.',
    keywords: ['times', 'equipes', 'teams', 'auto-assign'],
    permission: 'team.edit',
    component: lazy(() => import('../sections/workspace-org/TeamsSection')),
  },
  {
    id: 'auto-assign',
    group: 'workspace',
    label: 'Auto-assign',
    description: 'Regras de roteamento por canal/dept/time.',
    keywords: ['auto-assign', 'roteamento', 'distribuição'],
    permission: 'workspace.edit',
    component: lazy(() => import('../sections/workspace-org/AutoAssignSection')),
  },
  {
    id: 'horario',
    group: 'workspace',
    label: 'Horário comercial',
    description: 'Janelas semanais, exceções, mensagem fora do horário.',
    keywords: ['horário', 'comercial', 'expediente', 'janelas'],
    permission: 'workspace.edit',
    component: lazy(() => import('../sections/workspace-org/BusinessHoursSection')),
  },
  {
    id: 'conversoes',
    group: 'workspace',
    label: 'Conversões',
    description: 'Criar conversion_types, gatilhos, attribution window.',
    keywords: ['conversões', 'conversão', 'metas', 'attribution'],
    permission: 'workspace.edit',
    externalHref: '/settings/conversions',
  },
  {
    id: 'usage',
    group: 'workspace',
    label: 'Uso e custo de IA',
    description: 'Gasto com agentes de IA: custo hoje/mês, por dia e por modelo.',
    keywords: ['uso', 'custo', 'ia', 'ai', 'llm', 'gasto', 'tokens', 'billing', 'consumo'],
    permission: 'agent.view_costs',
    externalHref: '/settings/usage',
  },
  {
    id: 'tags',
    group: 'workspace',
    label: 'Tags',
    description: 'Criar, editar, cor.',
    keywords: ['tags', 'etiquetas', 'rótulos'],
    permission: 'team.edit',
    component: lazy(() => import('../sections/workspace-data/TagsManager')),
  },
  {
    id: 'slas',
    group: 'workspace',
    label: 'SLAs',
    description: 'Tempo máximo de resposta, alertas, regras por canal.',
    keywords: ['sla', 'slas', 'tempo', 'resposta', 'meta'],
    permission: 'workspace.edit',
    component: lazy(() => import('../sections/workspace-org/SlasSection')),
  },
  // F30-S10: visibilidade de inbox + peer-privacy por time.
  {
    id: 'visibilidade',
    group: 'workspace',
    label: 'Visibilidade da inbox',
    description: 'Default peer-privacy (shared/private), overrides por membro e peer-privacy por time.',
    keywords: [
      'visibilidade',
      'privacidade',
      'peer',
      'shared',
      'private',
      'inbox',
      'override',
      'departamento',
    ],
    permission: 'inbox.visibility.manage' as const,
    component: lazy(() => import('../sections/workspace-org/InboxVisibilitySection')),
  },
  {
    id: 'auditoria',
    group: 'workspace',
    label: 'Auditoria',
    description: 'Logs de ações administrativas.',
    keywords: ['auditoria', 'audit', 'logs', 'histórico'],
    permission: 'workspace.edit',
    component: lazy(() => import('../sections/workspace-data/AuditLogViewer')),
  },
  // Integração das features já construídas (F8-S08): deep-links para as páginas
  // dedicadas (não reconstruídas dentro do shell). Canais/Conversões já existem acima.
  {
    id: 'agentes',
    group: 'workspace',
    label: 'Agentes IA',
    description: 'Gerenciar agentes, tools, modelos e playground.',
    keywords: ['agentes', 'ia', 'ai', 'bot', 'langgraph', 'tools', 'modelo'],
    permission: 'agent.list',
    externalHref: '/agents',
  },
  {
    id: 'conhecimento',
    group: 'workspace',
    label: 'Knowledge Base',
    description: 'Documentos e fontes de conhecimento dos agentes.',
    keywords: ['conhecimento', 'kb', 'knowledge', 'documentos', 'rag'],
    permission: 'kb.edit',
    externalHref: '/knowledge',
  },
  {
    id: 'pipeline-settings',
    group: 'workspace',
    label: 'Pipeline',
    description: 'Funis, estágios e automações de pipeline.',
    keywords: ['pipeline', 'funil', 'estágios', 'deals', 'vendas'],
    permission: 'pipeline.edit',
    externalHref: '/pipeline/settings',
  },
  // F47-S05: catálogo de produtos do workspace (CRUD), gated por `product.edit`.
  {
    id: 'produtos',
    group: 'workspace',
    label: 'Produtos',
    description: 'Catálogo de produtos e serviços do workspace: nome, SKU, preço.',
    keywords: ['produtos', 'catálogo', 'preço', 'sku', 'estoque', 'itens'],
    permission: 'product.edit',
    externalHref: '/settings/products',
  },
  // Dev (F9-S06): API keys da API pública + webhooks outbound + delivery log.
  {
    id: 'dev',
    group: 'workspace',
    label: 'Dev',
    description: 'API keys da API pública, webhooks outbound e documentação.',
    keywords: ['dev', 'api', 'key', 'token', 'webhook', 'webhooks', 'integração', 'swagger', 'openapi'],
    permission: 'apikey.list',
    component: lazy(() => import('../sections/dev/DevSection')),
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [...PESSOAL, ...WORKSPACE];

export const SETTINGS_GROUP_LABEL: Record<SettingsGroup, string> = {
  pessoal: 'Pessoal',
  workspace: 'Workspace',
};

export const SETTINGS_GROUP_ORDER: readonly SettingsGroup[] = ['pessoal', 'workspace'];

export function findSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}
