'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useUIStore } from '@/shared/stores/ui.store';
import { cn } from '@/shared/lib/cn';
import { NAV_GROUP_LABEL, groupNavItems, isNavActive, visibleNavItems, type NavItem } from './nav';
import { unreadBadgeLabel, useInboxUnread } from './useInboxUnread';
import { UserMenu } from './UserMenu';
import { BrandMark } from './BrandMark';
import { WorkspaceSwitcher } from '@/shared/components/workspace-switcher';

/**
 * Navegação principal do desktop (`md+`) — "Product shell" do DS 3.0. No mobile
 * (`< md`) o app usa a `BottomNav` (4 abas + Mais); a montagem por breakpoint é do
 * `AppLayout` (`useBreakpoint`).
 *
 * Estrutura: marca → empresa ativa (seletor com 2+ empresas) → nav em grupos com
 * rótulo mono → recolher + perfil/sessão. Item ativo: fundo `surface-2` e uma barra
 * de 2px na cor de marca de TEXTO (`--brand-text`, legível nos dois temas) — marca
 * precisa, sem neon. Largura 248px; recolhida 64px (só ícones, nome em tooltip).
 * Estado de recolher persistido em `useUIStore`.
 */
export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuthStore((st) => st.auth);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const unread = useInboxUnread();
  const items = visibleNavItems(auth?.role);
  const groups = groupNavItems(items);

  return (
    <aside
      aria-label="Navegação principal"
      data-collapsed={collapsed ? 'true' : undefined}
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-surface',
        'transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-[248px]',
      )}
    >
      <BrandMark collapsed={collapsed} />

      {/* Empresa ativa (F71-S08): o nome é sempre visível; com 2+ empresas o bloco
          vira o seletor. */}
      <div className={cn('pb-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav className={cn('min-h-0 flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
        {groups.map(({ group, items: groupItems }, index) => (
          <div key={group} className={index === 0 ? undefined : 'mt-4'}>
            {collapsed ? (
              index > 0 && <div className="mx-3 mb-2 border-t border-border" role="separator" />
            ) : (
              <p className="px-3 pb-1.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-text-low">
                {NAV_GROUP_LABEL[group]}
              </p>
            )}
            <ul className="space-y-0.5">
              {groupItems.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isNavActive(item, items, pathname)}
                  collapsed={collapsed}
                  badge={item.tab === 'inbox' ? unreadBadgeLabel(unread) : null}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-border py-2', collapsed ? 'px-2' : 'px-3')}>
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!collapsed}
          className={cn(
            'mb-1 flex w-full items-center rounded-sm py-2 text-text-mid outline-none',
            'transition-[padding,background-color,color] duration-200 motion-reduce:transition-none',
            'hover:bg-surface-2 hover:text-text focus-visible:focus-ring',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-5 shrink-0" aria-hidden />
          ) : (
            <PanelLeftClose className="size-5 shrink-0" aria-hidden />
          )}
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap font-head text-sm font-medium transition-[max-width,margin,opacity] duration-200 motion-reduce:transition-none',
              collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-3 max-w-[140px] opacity-100',
            )}
          >
            Recolher
          </span>
        </button>

        {auth && (
          <UserMenu
            name={auth.name}
            role={auth.role}
            placement="up"
            variant="block"
            collapsed={collapsed}
          />
        )}
      </div>
    </aside>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  badge,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  badge: string | null;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        // Tooltip nativo + nome acessível só quando recolhida (o rótulo visível
        // já cobre o caso expandido). O selo entra no nome acessível.
        title={collapsed ? item.label : undefined}
        aria-label={
          collapsed ? (badge ? `${item.label}, ${badge} não lidas` : item.label) : undefined
        }
        className={cn(
          'group/nav relative flex items-center rounded-sm py-2 font-head text-sm font-medium outline-none',
          'transition-[padding,background-color,color] duration-200 motion-reduce:transition-none',
          'focus-visible:focus-ring',
          collapsed ? 'justify-center px-0' : 'px-3',
          active
            ? 'bg-surface-2 text-text shadow-[inset_2px_0_0_var(--brand-text)]'
            : 'text-text-mid hover:bg-surface-2 hover:text-text',
        )}
      >
        <Icon
          className={cn(
            'size-5 shrink-0 transition-colors duration-200 motion-reduce:transition-none',
            active ? 'text-brand-text' : 'text-text-low group-hover/nav:text-text-mid',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-200 motion-reduce:transition-none',
            collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-3 max-w-[140px] flex-1 opacity-100',
          )}
        >
          {item.label}
        </span>
        {badge && !collapsed && (
          <span className="ml-2 font-mono text-xs font-semibold tabular-nums text-brand-text">
            {badge}
          </span>
        )}
        {badge && collapsed && (
          <span
            aria-hidden
            className="absolute right-2 top-1.5 size-2 rounded-pill bg-brand-text ring-2 ring-surface"
          />
        )}
      </Link>
    </li>
  );
}
