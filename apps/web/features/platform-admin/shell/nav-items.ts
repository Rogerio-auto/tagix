/**
 * Itens de navegação do painel de super-admin (F25-S06). Fonte única; as páginas
 * (S07/S08) preenchem cada rota. UX §2.4: toda entrada tem label visível.
 */
export interface PlatformNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon:
    | 'models'
    | 'policies'
    | 'secrets'
    | 'usage'
    | 'tenants'
    | 'plans'
    | 'subscriptions'
    | 'playground'
    | 'impersonation'
    | 'help'
    | 'support';
  /** Descrição curta para o help inline `?` (UX §3.3), sobretudo em Secrets. */
  readonly help: string;
  readonly sensitive?: boolean;
}

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  {
    href: '/platform/models',
    label: 'Modelos',
    icon: 'models',
    help: 'Catálogo global de modelos LLM. Ative/desative o que a plataforma oferece e sincronize com a OpenRouter.',
  },
  {
    href: '/platform/policies',
    label: 'Políticas',
    icon: 'policies',
    help: 'Por workspace: modelos permitidos, features de agente (LangGraph) e limites de custo.',
  },
  {
    href: '/platform/secrets',
    label: 'Secrets',
    icon: 'secrets',
    help: 'Chaves de plataforma (OpenRouter, Meta). O valor nunca é exibido — só rotação, com confirmação.',
    sensitive: true,
  },
  {
    href: '/platform/usage',
    label: 'Uso',
    icon: 'usage',
    help: 'Gasto de LLM por workspace, modelo e período; top spenders e alertas de teto de custo.',
  },
  {
    href: '/platform/tenants',
    label: 'Tenants',
    icon: 'tenants',
    help: 'Todos os workspaces: plano, status, uso e saude. Clique para o 360 do tenant.',
  },
  {
    href: '/platform/plans',
    label: 'Planos',
    icon: 'plans',
    help: 'Catalogo comercial -- limites/features tipados por plano. Gestao interna (sem cobranca).',
  },
  {
    href: '/platform/subscriptions',
    label: 'Assinaturas',
    icon: 'subscriptions',
    help: 'Plano, status, trial e override (custom plan) por tenant; entitlements efetivos.',
  },
  {
    href: '/platform/playground',
    label: 'Playground',
    icon: 'playground',
    help: 'Teste um agente de qualquer tenant em sandbox -- zero side-effect, custo de teste.',
  },
  {
    href: '/platform/impersonation',
    label: 'Ver como',
    icon: 'impersonation',
    help: 'View-as read-only: veja o produto pelos olhos do tenant. Time-boxed e auditado (LGPD).',
    sensitive: true,
  },
  {
    href: '/platform/help',
    label: 'Ajuda',
    icon: 'help',
    help: 'CMS da Central de Ajuda do Leadium — artigos publicaveis sem deploy, lidos por todos os workspaces.',
  },
];
