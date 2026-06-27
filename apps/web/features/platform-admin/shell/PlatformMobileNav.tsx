'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Boxes,
  Bot,
  Building2,
  Command,
  CreditCard,
  Eye,
  Headset,
  KeyRound,
  LifeBuoy,
  Layers,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { PLATFORM_NAV, type PlatformNavItem } from './nav-items';

const ICONS: Record<PlatformNavItem['icon'], LucideIcon> = {
  models: Boxes,
  policies: SlidersHorizontal,
  secrets: KeyRound,
  usage: ShieldCheck,
  tenants: Building2,
  plans: Layers,
  subscriptions: CreditCard,
  playground: Bot,
  impersonation: Eye,
  monitoring: Activity,
  help: LifeBuoy,
  support: Headset,
};

/**
 * Navegação mobile do painel de super-admin (F36-S13). A sidebar fixa só existe
 * em `lg+`; abaixo disso o gatilho (hambúrguer) abre um `Sheet` com a mesma fonte
 * de navegação (`PLATFORM_NAV`), tornando todas as áreas alcançáveis no toque.
 * Renderiza apenas `< lg` (`isBelowDesktop`) — `lg+` mantém a sidebar intacta.
 */
export function PlatformMobileNav() {
  const { isBelowDesktop } = useBreakpoint();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Fecha o sheet ao navegar (mudança de rota).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!isBelowDesktop) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegação de plataforma"
        aria-haspopup="dialog"
        className="touch-target -ml-1 inline-flex items-center justify-center rounded-md text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        variant="bottom"
        title={
          <span className="inline-flex items-center gap-2">
            <Command className="size-5 text-warn" aria-hidden />
            <span className="flex flex-col leading-tight">
              <span className="font-head text-sm font-semibold text-text">Plataforma</span>
              <span className="text-[11px] uppercase tracking-wide text-text-low">Super-admin</span>
            </span>
          </span>
        }
        ariaLabel="Navegação de plataforma"
        footer={
          <Link
            href="/"
            className="touch-target flex items-center gap-2 rounded-md px-3 font-head text-sm text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            Voltar ao workspace
          </Link>
        }
      >
        <nav aria-label="Navegação de plataforma" className="flex flex-col gap-1">
          {PLATFORM_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'touch-target flex items-center gap-3 rounded-md border-l-2 px-3 font-head text-sm font-medium outline-none transition-colors duration-200',
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
            );
          })}
        </nav>
      </Sheet>
    </>
  );
}
