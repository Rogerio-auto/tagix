import {
  BookOpen,
  Bot,
  Calendar,
  GitBranch,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { can, type Permission, type Role } from '@hm/shared';

/**
 * Item de navegação primária do app. Fonte única consumida por `Sidebar`
 * (desktop), `BottomNav` (mobile, zona do polegar) e `TopBar` (título da rota).
 * NÃO inventar destinos por canal — espelhar exatamente a IA da Sidebar.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Se presente, o item só aparece quando o papel atual tem a permissão. */
  perm?: Permission;
}

// UX §2.4: toda entrada de nav tem LABEL visível, não só ícone.
// A ordem importa: os primeiros destinos visíveis (por role) preenchem a
// bottom tab bar do mobile; o restante cai no drawer "Mais" (overflow).
export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/conversations', label: 'Conversas', icon: MessagesSquare },
  { href: '/agents', label: 'Agentes', icon: Bot },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, perm: 'kb.edit' },
  { href: '/pipeline', label: 'Pipeline', icon: GitBranch, perm: 'pipeline.view' },
  { href: '/flows', label: 'Flows', icon: Workflow, perm: 'flow.list' },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone, perm: 'campaign.list' },
  { href: '/calendar', label: 'Agenda', icon: Calendar, perm: 'calendar.view' },
  { href: '/contacts', label: 'Contatos', icon: Users, perm: 'contact.view' },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

/**
 * Quantos destinos a bottom tab bar mostra antes do botão "Mais". Mantém o slot
 * total em ≤5 alvos (N visíveis + "Mais") — regra thumb-first (MOBILE_UX §1/§2).
 * Se o role enxerga ≤ este número de destinos, não há overflow e o "Mais" some.
 */
export const BOTTOM_NAV_PRIMARY_COUNT = 4;

/** Filtra os destinos visíveis para o papel atual (gating por `can()`). */
export function visibleNavItems(role: Role | undefined): readonly NavItem[] {
  return NAV.filter((item) => !item.perm || (role ? can(role, item.perm) : false));
}

/**
 * Resolve o item de nav ativo para um pathname (match exato para a home `/`,
 * prefixo para o resto). Usado pelo `TopBar` mobile para o título da rota.
 */
export function activeNavItem(
  items: readonly NavItem[],
  pathname: string,
): NavItem | undefined {
  if (pathname === '/') return items.find((i) => i.href === '/');
  // Preferir o match de prefixo mais específico (ex.: `/settings/channels`).
  return [...items]
    .filter((i) => i.href !== '/' && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
