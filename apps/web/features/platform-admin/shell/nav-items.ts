/**
 * Itens de navegação do painel de super-admin (F25-S06; grupos no DS 3.0, F72-S08).
 * Fonte única: sidebar, navegação mobile, hub `/platform` e o painel `?` de cada tela
 * (o texto de `help` mora aqui e aparece no HelpPanel, nunca em tooltip — UX §2.5).
 */
export type PlatformNavGroup = 'workspaces' | 'ai' | 'operations';

export interface PlatformNavItem {
  readonly href: string;
  readonly label: string;
  readonly group: PlatformNavGroup;
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
    | 'monitoring'
    | 'help'
    | 'support';
  /** O que a área faz, em uma ou duas frases (HelpPanel e hub). */
  readonly help: string;
  /** Área sensível (segredos, view-as): selo "Sensível" na navegação. */
  readonly sensitive?: boolean;
}

export const PLATFORM_NAV_GROUP_LABEL: Record<PlatformNavGroup, string> = {
  workspaces: 'Workspaces',
  ai: 'IA',
  operations: 'Operação',
};

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  {
    href: '/platform/tenants',
    label: 'Tenants',
    group: 'workspaces',
    icon: 'tenants',
    help: 'Todos os workspaces da plataforma: plano, status, membros e custo do mês. Clique numa linha para abrir o 360 do tenant.',
  },
  {
    href: '/platform/subscriptions',
    label: 'Assinaturas',
    group: 'workspaces',
    icon: 'subscriptions',
    help: 'Plano, status, trial e override (custom plan) por tenant, com os entitlements efetivos resolvidos.',
  },
  {
    href: '/platform/plans',
    label: 'Planos',
    group: 'workspaces',
    icon: 'plans',
    help: 'Catálogo comercial: limites e features tipados por plano. Desativar tira o plano do catálogo sem mudar quem já assina.',
  },
  {
    href: '/platform/impersonation',
    label: 'Ver como',
    group: 'workspaces',
    icon: 'impersonation',
    help: 'View-as somente leitura: veja o produto pelos olhos do tenant. Exige motivo, expira sozinho e é auditado (LGPD).',
    sensitive: true,
  },
  {
    href: '/platform/support',
    label: 'Suporte',
    group: 'workspaces',
    icon: 'support',
    help: 'Inbox de suporte de todos os workspaces: triagem, resposta em tempo real, status, prioridade e atribuição.',
  },
  {
    href: '/platform/models',
    label: 'Modelos',
    group: 'ai',
    icon: 'models',
    help: 'Catálogo global de modelos LLM. Ative ou desative o que a plataforma oferece e sincronize com a OpenRouter.',
  },
  {
    href: '/platform/policies',
    label: 'Políticas',
    group: 'ai',
    icon: 'policies',
    help: 'Por workspace: modelos permitidos, features de agente (LangGraph) e limites de custo.',
  },
  {
    href: '/platform/usage',
    label: 'Uso',
    group: 'ai',
    icon: 'usage',
    help: 'Gasto de LLM por workspace, modelo e dia; maiores gastos do mês e alertas de teto de custo.',
  },
  {
    href: '/platform/playground',
    label: 'Playground',
    group: 'ai',
    icon: 'playground',
    help: 'Teste um agente de qualquer tenant em sandbox: nada chega ao cliente, nada é persistido e o custo entra como teste.',
  },
  {
    href: '/platform/monitoring',
    label: 'Monitoramento',
    group: 'operations',
    icon: 'monitoring',
    help: 'Saúde da sincronização: profundidade das filas e da DLQ, retries em voo e status de conexão dos canais.',
  },
  {
    href: '/platform/help',
    label: 'Central de Ajuda',
    group: 'operations',
    icon: 'help',
    help: 'CMS da Central de Ajuda: artigos publicáveis sem deploy, lidos por todos os workspaces.',
  },
  {
    href: '/platform/secrets',
    label: 'Segredos',
    group: 'operations',
    icon: 'secrets',
    help: 'Chaves de plataforma (OpenRouter, Meta). O valor nunca é exibido: só versão, data e rotação com confirmação.',
    sensitive: true,
  },
];

/** Itens agrupados na ordem de `PLATFORM_NAV_GROUP_LABEL`. */
export function groupedPlatformNav(): { group: PlatformNavGroup; label: string; items: PlatformNavItem[] }[] {
  return (Object.keys(PLATFORM_NAV_GROUP_LABEL) as PlatformNavGroup[]).map((group) => ({
    group,
    label: PLATFORM_NAV_GROUP_LABEL[group],
    items: PLATFORM_NAV.filter((i) => i.group === group),
  }));
}

/** Item da rota atual (prefixo), para o `?` de cada tela. */
export function platformNavItem(href: string): PlatformNavItem | undefined {
  return PLATFORM_NAV.find((i) => href === i.href || href.startsWith(`${i.href}/`));
}
