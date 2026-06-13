'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  HelpCircle,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { PLATFORM_NAV, type PlatformNavItem } from './nav-items';

const ICONS: Record<PlatformNavItem['icon'], LucideIcon> = {
  models: Boxes,
  policies: SlidersHorizontal,
  secrets: KeyRound,
  usage: ShieldCheck,
};

/** Help inline `?` (UX §3.3) — texto curto via `<details>`/title acessível,
 *  sem depender do registry global de help. */
function NavHelp({ text }: { text: string }) {
  return (
    <span className="group/help relative inline-flex">
      <HelpCircle
        className="size-3.5 text-text-low transition-colors group-hover/help:text-text-mid"
        aria-hidden
      />
      <span className="sr-only">{text}</span>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-md',
          'border border-border bg-surface-3 p-2.5 text-xs leading-snug text-text-mid shadow-elev-3',
          'opacity-0 transition-opacity duration-150 group-hover/help:opacity-100',
        )}
      >
        {text}
      </span>
    </span>
  );
}

/** Navegação lateral do painel de super-admin: as 4 áreas (Modelos/Políticas/Secrets/Uso). */
export function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegação de plataforma" className="flex-1 space-y-1 px-3 py-2">
      {PLATFORM_NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = ICONS[item.icon];
        return (
          <div key={item.href} className="flex items-center gap-1.5">
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-sm border-l-2 px-3 py-2 font-head text-sm font-medium outline-none transition-colors duration-200',
                'focus-visible:shadow-glow-md',
                active
                  ? 'border-warn bg-surface-3 text-text'
                  : 'border-transparent text-text-mid hover:bg-surface-2 hover:text-text',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {item.label}
              {item.sensitive && (
                <span className="ml-auto rounded-pill bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn">
                  sensível
                </span>
              )}
            </Link>
            <NavHelp text={item.help} />
          </div>
        );
      })}
    </nav>
  );
}
