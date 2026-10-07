'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { Sheet } from '@/shared/components/Sheet';
import { cn } from '@/shared/lib/cn';
import { activeNavItem, mobileLabelOf, mobileTabItems, moreNavItems, visibleNavItems } from './nav';
import { unreadBadgeLabel, useInboxUnread } from './useInboxUnread';

const TAB_CLASS = cn(
  'touch-target relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2 outline-none',
  'transition-colors duration-150 motion-reduce:transition-none',
  'focus-visible:focus-ring focus-visible:-outline-offset-2',
);

/**
 * Navegação primária do celular (`< md`): QUATRO abas fixas — Home, Inbox, Agenda
 * e Mais (decisão travada da F72; APP_MOBILE_PLAN §3.1) — na zona do polegar. Todo
 * o resto (Pipeline, Dashboard, Contatos, Campanhas, Agentes, Flows, Conhecimento, Conversões,
 * Configurações, Ajuda…) vive no sheet "Mais". A fonte dos destinos é o `nav.ts`,
 * já filtrada por papel: papel sem Agenda vê três abas, nunca uma aba morta.
 *
 * Aba ativa em `--brand-text` (≥4,5:1 nos dois temas; a marca crua dava 1,36:1 no
 * claro) com um traço de 2px no topo — o estado não depende só da cor. Alvos ≥44px,
 * safe-area inferior (`pb-safe`). Selo de não lidas na Inbox.
 *
 * A montagem por breakpoint é feita no `AppLayout` (`useBreakpoint`).
 */
export function BottomNav() {
  const pathname = usePathname();
  const role = useAuthStore((st) => st.auth?.role);
  const unread = unreadBadgeLabel(useInboxUnread());
  const [moreOpen, setMoreOpen] = useState(false);

  const items = visibleNavItems(role);
  const tabs = mobileTabItems(items);
  const more = moreNavItems(items);
  const activeHref = activeNavItem(items, pathname)?.href;
  const moreActive = more.some((item) => item.href === activeHref);

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="shrink-0 border-t border-border bg-surface-glass pb-safe backdrop-blur-xl"
      >
        <ul className="flex h-16 items-stretch">
          {tabs.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            const badge = item.tab === 'inbox' ? unread : null;
            const label = mobileLabelOf(item);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  aria-label={badge ? `${label}, ${badge} não lidas` : undefined}
                  className={cn(
                    TAB_CLASS,
                    active ? 'text-brand-text' : 'text-text-low hover:text-text',
                  )}
                >
                  <TabMark active={active} />
                  <span className="relative">
                    <Icon className="size-[22px] shrink-0" aria-hidden />
                    {badge && (
                      <span
                        aria-hidden
                        className="absolute -right-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-pill bg-brand px-1 font-mono text-[0.625rem] font-semibold leading-none tabular-nums text-text-on-brand"
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                  <span className="font-head text-[0.6875rem] font-semibold leading-none">
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                TAB_CLASS,
                moreActive ? 'text-brand-text' : 'text-text-low hover:text-text',
              )}
            >
              <TabMark active={moreActive} />
              <Ellipsis className="size-[22px] shrink-0" aria-hidden />
              <span className="font-head text-[0.6875rem] font-semibold leading-none">Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mais" variant="bottom">
        <ul className="grid grid-cols-3 gap-2 pb-2">
          {more.map((item) => {
            const active = item.href === activeHref;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'touch-target flex h-full min-h-[84px] w-full flex-col items-center justify-center gap-2 rounded-md border px-2 py-3 text-center outline-none',
                    'transition-colors duration-150 motion-reduce:transition-none focus-visible:focus-ring',
                    active
                      ? 'border-border-brand bg-surface-3 text-text'
                      : 'border-border bg-surface-2 text-text-mid hover:border-border-2 hover:text-text',
                  )}
                >
                  <Icon
                    className={cn('size-6 shrink-0', active ? 'text-brand-text' : 'text-text-low')}
                    aria-hidden
                  />
                  <span className="font-head text-xs font-semibold leading-tight">
                    {mobileLabelOf(item)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

/** Traço de 2px no topo da aba ativa: o estado não depende só da cor. */
function TabMark({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-x-6 top-0 h-0.5 rounded-b-pill bg-brand-text transition-opacity duration-150 motion-reduce:transition-none',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}
