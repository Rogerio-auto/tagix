'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
import { can, type Permission } from '@hm/shared';
import { useAuthStore } from '@/shared/stores/auth.store';
import { cn } from '@/shared/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Se presente, o item só aparece quando o papel atual tem a permissão. */
  perm?: Permission;
}

// UX §2.4: toda entrada de nav tem LABEL visível, não só ícone.
const NAV: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/conversations', label: 'Conversas', icon: MessagesSquare },
  { href: '/agents', label: 'Agentes', icon: Bot },
  { href: '/knowledge', label: 'Conhecimento', icon: BookOpen, perm: 'kb.edit' },
  { href: '/contacts', label: 'Contatos', icon: Users },
  { href: '/pipeline', label: 'Pipeline', icon: GitBranch, perm: 'pipeline.view' },
  { href: '/flows', label: 'Flows', icon: Workflow, perm: 'flow.list' },
  { href: '/campaigns', label: 'Campanhas', icon: Megaphone },
  { href: '/calendar', label: 'Agenda', icon: Calendar },
  { href: '/settings', label: 'Configurações', icon: Settings },
];

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const role = useAuthStore((st) => st.auth?.role);
  const items = NAV.filter((item) => !item.perm || (role ? can(role, item.perm) : false));
  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface',
          'transition-transform duration-200 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-5">
          <span className="font-display text-lg text-brand" aria-hidden>
            ◢
          </span>
          <span className="font-head text-lg font-semibold text-text">Highermind</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-sm border-l-2 px-3 py-2 font-head text-sm font-medium outline-none transition-colors duration-200',
                  'focus-visible:shadow-glow-md',
                  active
                    ? 'border-brand bg-surface-3 text-text'
                    : 'border-transparent text-text-mid hover:bg-surface-2 hover:text-text',
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
