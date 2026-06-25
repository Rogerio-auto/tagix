'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/shared/stores/auth.store';
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
 * sutil) → bloco de perfil + sessão no rodapé (UX §2.4 — identidade e logout têm
 * lugar óbvio, não escondidos).
 */
export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuthStore((st) => st.auth);
  const items = visibleNavItems(auth?.role);

  const operate = items.filter((item) => (item.group ?? 'operate') === 'operate');
  const manage = items.filter((item) => item.group === 'manage');

  return (
    <aside
      aria-label="Navegação principal"
      className="flex w-60 shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="font-display text-lg text-brand" aria-hidden>
          ◢
        </span>
        <span className="font-head text-lg font-semibold text-text">Leadium</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {operate.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
        {manage.length > 0 && (
          <>
            <div className="mx-3 my-2 border-t border-border" role="separator" />
            <ul className="space-y-1">
              {manage.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </ul>
          </>
        )}
      </nav>

      {auth && (
        <div className="border-t border-border p-2">
          <UserMenu name={auth.name} role={auth.role} placement="up" variant="block" />
        </div>
      )}
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-3 rounded-sm px-3 py-2 font-head text-sm font-medium outline-none transition-colors duration-200',
          'focus-visible:shadow-glow-md',
          active
            ? // Opção selecionada: linha neon viva (variante discreta — nav é
              // chrome persistente, não deve competir com o conteúdo).
              'hm-flow-neon bg-surface-3 text-text'
            : 'text-text-mid hover:bg-surface-2 hover:text-text',
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        {item.label}
      </Link>
    </li>
  );
}
