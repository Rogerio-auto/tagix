'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/shared/stores/auth.store';
import { cn } from '@/shared/lib/cn';
import { visibleNavItems } from './nav';

/**
 * Navegação principal do desktop (`md+`). No mobile (`< md`) o app usa a
 * `BottomNav` (zona do polegar) — a montagem por breakpoint é orquestrada no
 * `AppLayout` via `useBreakpoint` (regra de ouro do MOBILE_UX: estrutura por
 * `isMobile`, não por classe Tailwind solta).
 */
export function Sidebar() {
  const pathname = usePathname();
  const role = useAuthStore((st) => st.auth?.role);
  const items = visibleNavItems(role);
  return (
    <aside
      aria-label="Navegação principal"
      className="flex w-60 shrink-0 flex-col border-r border-border bg-surface"
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
  );
}
