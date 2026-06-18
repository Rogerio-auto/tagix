import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Command } from 'lucide-react';
import type { PlatformAdminMe } from '../lib';
import { PlatformNav } from './PlatformNav';
import { PlatformMobileNav } from './PlatformMobileNav';

/**
 * Chrome do painel de super-admin (F25-S06). Visualmente DISTINTO do workspace
 * (faixa de plataforma + cor de acento `warn`) para deixar claro que é um modo
 * "admin de plataforma", não "settings de workspace". DS v2 dark-first, tokens
 * semânticos (zero hex). As páginas (S07/S08) renderizam dentro de `children`.
 */
export function PlatformShell({
  admin,
  children,
}: {
  admin: PlatformAdminMe;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside
        aria-label="Plataforma"
        className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface lg:flex"
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <Command className="size-5 text-warn" aria-hidden />
          <div className="flex flex-col leading-tight">
            <span className="font-head text-sm font-semibold text-text">Plataforma</span>
            <span className="text-[11px] uppercase tracking-wide text-text-low">Super-admin</span>
          </div>
        </div>
        <PlatformNav />
        <div className="border-t border-border px-3 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm px-3 py-2 font-head text-sm text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:shadow-glow-md"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            Voltar ao workspace
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Faixa de plataforma: reforça visualmente o modo admin. */}
        <header className="pt-safe pl-safe pr-safe sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-warn/30 bg-surface/80 px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <PlatformMobileNav />
            <span className="rounded-pill bg-warn/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warn">
              Plataforma
            </span>
            <span className="hidden text-sm text-text-low sm:inline">
              Acesso restrito a administradores de plataforma
            </span>
          </div>
          <span className="truncate text-sm text-text-mid" title={admin.email}>
            {admin.name ?? admin.email}
          </span>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="pb-safe pl-safe pr-safe flex-1 px-4 py-6 outline-none lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
