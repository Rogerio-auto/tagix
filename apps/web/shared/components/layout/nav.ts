import {
  BookOpen,
  Bot,
  Calendar,
  DatabaseBackup,
  GitBranch,
  House,
  LifeBuoy,
  Megaphone,
  MessagesSquare,
  Repeat2,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { can, type Permission, type Role } from '@hm/shared';

/**
 * Fonte única dos destinos do app (F72-S03). Consumida por `Sidebar` (desktop),
 * `BottomNav` (mobile), `TopBar` (contexto da rota) e `CommandPalette` (⌘K). Toda
 * lista de destinos nasce aqui e passa por `visibleNavItems(role)`: quem não pode
 * agir não vê (role-aware, regra do §07 do DS 3.0).
 *
 * NÃO inventar destinos por canal — espelhar exatamente a IA da Sidebar.
 */

/**
 * Agrupamento da nav (UX §2.4 — hierarquia legível, não uma lista chapada).
 * `today` = o que mudou; `work` = operação diária; `automate` = o que roda sozinho;
 * `manage` = configuração/suporte. A Sidebar rotula cada grupo; o mobile ignora.
 */
export type NavGroup = 'today' | 'work' | 'automate' | 'manage';

export const NAV_GROUP_ORDER: readonly NavGroup[] = ['today', 'work', 'automate', 'manage'];

export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  today: 'Visão geral',
  work: 'Operação',
  automate: 'Automação',
  manage: 'Gestão',
};

/** As abas fixas do celular (decisão travada da F72: Home, Inbox, Agenda e Mais). */
export type MobileTab = 'home' | 'inbox' | 'agenda';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Rótulo curto no celular (aba ou sheet "Mais"), quando difere do desktop. */
  mobileLabel?: string;
  /** Se presente, o item vira uma das 4 abas fixas do celular. */
  tab?: MobileTab;
  /** Se presente, o item só aparece quando o papel atual tem a permissão. */
  perm?: Permission;
}

// UX §2.4: toda entrada de nav tem LABEL visível, não só ícone.
export const NAV: readonly NavItem[] = [
  // F72-S04: a Home unificou o antigo Dashboard (`/`) e a tela Hoje (`/hoje`). Um
  // destino só; `/hoje` continua existindo apenas como redirect para o PWA antigo.
  { href: '/', label: 'Home', icon: House, group: 'today', tab: 'home' },
  {
    href: '/conversations',
    label: 'Inbox',
    icon: MessagesSquare,
    group: 'work',
    tab: 'inbox',
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: GitBranch,
    group: 'work',
    perm: 'pipeline.view',
  },
  {
    href: '/calendar',
    label: 'Agenda',
    icon: Calendar,
    group: 'work',
    tab: 'agenda',
    perm: 'calendar.view',
  },
  { href: '/contacts', label: 'Contatos', icon: Users, group: 'work', perm: 'contact.view' },
  {
    href: '/campaigns',
    label: 'Campanhas',
    icon: Megaphone,
    group: 'automate',
    perm: 'campaign.list',
  },
  { href: '/agents', label: 'Agentes', icon: Bot, group: 'automate' },
  { href: '/flows', label: 'Flows', icon: Workflow, group: 'automate', perm: 'flow.list' },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, group: 'automate', perm: 'kb.edit' },
  {
    href: '/conversions',
    label: 'Conversões',
    icon: Repeat2,
    group: 'automate',
    perm: 'pipeline.view',
  },
  {
    href: '/flows/backup',
    label: 'Backup de Flows',
    icon: DatabaseBackup,
    group: 'manage',
    perm: 'flow.backup',
  },
  { href: '/help', label: 'Ajuda', icon: LifeBuoy, group: 'manage' },
  { href: '/settings', label: 'Configurações', icon: Settings, group: 'manage' },
];

/** Ordem das abas fixas do celular. */
export const MOBILE_TAB_ORDER: readonly MobileTab[] = ['home', 'inbox', 'agenda'];

/**
 * Ordem do sheet "Mais": o que o dono mais usa primeiro, administração por último.
 * Todo destino que não é aba precisa estar aqui (o teste `nav.test.ts` garante que
 * nenhuma rota fica sem caminho no celular).
 */
export const MORE_ORDER: readonly string[] = [
  '/pipeline',
  '/contacts',
  '/campaigns',
  '/agents',
  '/flows',
  '/knowledge',
  '/conversions',
  '/flows/backup',
  '/settings',
  '/help',
];

/** Filtra os destinos visíveis para o papel atual (gating por `can()`). */
export function visibleNavItems(role: Role | undefined): readonly NavItem[] {
  return NAV.filter((item) => !item.perm || (role ? can(role, item.perm) : false));
}

/** Agrupa os destinos já filtrados na ordem dos grupos (grupos vazios somem). */
export function groupNavItems(
  items: readonly NavItem[],
): ReadonlyArray<{ group: NavGroup; items: readonly NavItem[] }> {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((i) => i.group === group),
  })).filter((g) => g.items.length > 0);
}

/** As abas fixas do celular que o papel enxerga, na ordem canônica. */
export function mobileTabItems(items: readonly NavItem[]): readonly NavItem[] {
  return MOBILE_TAB_ORDER.flatMap((tab) => items.filter((i) => i.tab === tab));
}

/** Destinos do sheet "Mais" (tudo o que não é aba), na ordem de `MORE_ORDER`. */
export function moreNavItems(items: readonly NavItem[]): readonly NavItem[] {
  const rank = (href: string): number => {
    const at = MORE_ORDER.indexOf(href);
    return at === -1 ? MORE_ORDER.length : at;
  };
  return items.filter((i) => !i.tab).sort((a, b) => rank(a.href) - rank(b.href));
}

/** Rótulo do item no celular (mesmo vocabulário do desktop; `mobileLabel` só se divergir de propósito). */
export function mobileLabelOf(item: NavItem): string {
  return item.mobileLabel ?? item.label;
}

/**
 * Resolve o item de nav ativo para um pathname (match exato para `/`, prefixo mais
 * específico para o resto: `/flows/backup` ativa Backup, não Flows).
 */
export function activeNavItem(items: readonly NavItem[], pathname: string): NavItem | undefined {
  if (pathname === '/') return items.find((i) => i.href === '/');
  return [...items]
    .filter((i) => i.href !== '/' && (pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** `true` quando `item` é o destino ativo de `pathname` entre `items`. */
export function isNavActive(item: NavItem, items: readonly NavItem[], pathname: string): boolean {
  return activeNavItem(items, pathname)?.href === item.href;
}
