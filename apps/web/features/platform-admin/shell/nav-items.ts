/**
 * Itens de navegação do painel de super-admin (F25-S06). Fonte única; as páginas
 * (S07/S08) preenchem cada rota. UX §2.4: toda entrada tem label visível.
 */
export interface PlatformNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: 'models' | 'policies' | 'secrets' | 'usage';
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
];
