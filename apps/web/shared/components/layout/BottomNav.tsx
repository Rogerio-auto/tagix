'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { Sheet } from '@/shared/components/Sheet';
import { cn } from '@/shared/lib/cn';
import { BOTTOM_NAV_PRIMARY_COUNT, visibleNavItems, type NavItem } from './nav';

function isActive(item: NavItem, pathname: string): boolean {
  return item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
}

/**
 * Bottom tab bar do mobile (`< md`) — navegação primária na zona do polegar
 * (MOBILE_UX §1 thumb-first, §2 casca/nav). Mostra até
 * `BOTTOM_NAV_PRIMARY_COUNT` destinos + um botão "Mais" que abre um `Sheet` com
 * o overflow. Alvos ≥ 44px (`touch-target`), safe-area inferior (`pb-safe`).
 *
 * A montagem/desmontagem por breakpoint é feita no `AppLayout` (via
 * `useBreakpoint`); aqui o componente assume que já está no contexto mobile.
 */
export function BottomNav() {
  const pathname = usePathname();
  const role = useAuthStore((st) => st.auth?.role);
  const [moreOpen, setMoreOpen] = useState(false);

  const items = visibleNavItems(role);
  const hasOverflow = items.length > BOTTOM_NAV_PRIMARY_COUNT;
  // Reserva o último slot para o botão "Mais" só quando há overflow real.
  const primary = hasOverflow ? items.slice(0, BOTTOM_NAV_PRIMARY_COUNT) : items;
  const overflow = hasOverflow ? items.slice(BOTTOM_NAV_PRIMARY_COUNT) : [];
  const moreActive = overflow.some((item) => isActive(item, pathname));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="border-t border-border bg-surface pb-safe"
      >
        <ul className="flex items-stretch">
          {primary.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'touch-target flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 py-2 outline-none transition-colors duration-150',
                    'focus-visible:shadow-glow-md',
                    active ? 'text-brand' : 'text-text-low hover:text-text',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="font-head text-[0.625rem] font-medium leading-none">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
          {hasOverflow && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={cn(
                  'touch-target flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 py-2 outline-none transition-colors duration-150',
                  'focus-visible:shadow-glow-md',
                  moreActive ? 'text-brand' : 'text-text-low hover:text-text',
                )}
              >
                <MoreHorizontal className="size-5 shrink-0" aria-hidden />
                <span className="font-head text-[0.625rem] font-medium leading-none">Mais</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais" variant="bottom">
        <ul className="space-y-1 pb-2">
          {overflow.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative touch-target flex items-center gap-3 rounded-sm px-3 py-3 font-head text-sm font-medium outline-none transition-colors duration-150',
                    'focus-visible:shadow-glow-md',
                    active
                      ? 'hm-flow-neon bg-surface-3 text-text'
                      : 'text-text-mid hover:bg-surface-2 hover:text-text',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
