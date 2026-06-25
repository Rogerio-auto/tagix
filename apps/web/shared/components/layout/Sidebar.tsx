'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useUIStore } from '@/shared/stores/ui.store';
import { cn } from '@/shared/lib/cn';
import { visibleNavItems, type NavItem } from './nav';
import { UserMenu } from './UserMenu';

/**
 * Navegação principal do desktop (`md+`). No mobile (`< md`) o app usa a
 * `BottomNav` (zona do polegar) — a montagem por breakpoint é orquestrada no
 * `AppLayout` via `useBreakpoint` (regra de ouro do MOBILE_UX: estrutura por
 * `isMobile`, não por classe Tailwind solta).
 *
 * Estrutura: marca (topo) → nav agrupada (operação / configuração, divisória
 * sutil) → toggle de recolher + bloco de perfil/sessão no rodapé (UX §2.4).
 *
 * Recolher (F-collapse): largura anima `w-60 ↔ w-16`; no modo compacto só os
 * ícones aparecem (rótulos somem por opacidade+largura), centralizados, com
 * tooltip nativo (`title`). Estado persistido em `useUIStore` (localStorage),
 * portanto sobrevive à navegação e ao refresh.
 */
export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuthStore((st) => st.auth);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const items = visibleNavItems(auth?.role);

  const operate = items.filter((item) => (item.group ?? 'operate') === 'operate');
  const manage = items.filter((item) => item.group === 'manage');

  return (
    <aside
      aria-label="Navegação principal"
      data-collapsed={collapsed ? 'true' : undefined}
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-surface',
        'transition-[width] duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center px-0' : 'px-5')}>
        <span className="font-display text-lg text-brand" aria-hidden>
          ◢
        </span>
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap font-head text-lg font-semibold text-text transition-all duration-200',
            collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-2 max-w-[140px] opacity-100',
          )}
        >
          Leadium
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {operate.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
        </ul>
        {manage.length > 0 && (
          <>
            <div className="mx-3 my-2 border-t border-border" role="separator" />
            <ul className="space-y-1">
              {manage.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
              ))}
            </ul>
          </>
        )}
      </nav>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!collapsed}
          className={cn(
            'mb-1 flex w-full items-center rounded-sm py-2 text-text-mid outline-none',
            'transition-[padding,background-color,color] duration-200',
            'hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md',
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
              'overflow-hidden whitespace-nowrap font-head text-sm font-medium transition-all duration-200',
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
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        // Tooltip nativo + nome acessível apenas quando recolhida (o rótulo
        // visível já cobre o caso expandido).
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'relative flex items-center rounded-sm py-2 font-head text-sm font-medium outline-none',
          'transition-[padding,background-color,color] duration-200',
          'focus-visible:shadow-glow-md',
          collapsed ? 'justify-center px-0' : 'px-3',
          active
            ? 'hm-flow-neon bg-surface-3 text-text'
            : 'text-text-mid hover:bg-surface-2 hover:text-text',
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-all duration-200',
            collapsed ? 'ml-0 max-w-0 opacity-0' : 'ml-3 max-w-[140px] opacity-100',
          )}
        >
          {item.label}
        </span>
      </Link>
    </li>
  );
}
