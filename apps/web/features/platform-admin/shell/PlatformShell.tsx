import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { PlatformAdminMe } from '../lib';
import { PlatformMark } from './PlatformMark';
import { PlatformMobileNav } from './PlatformMobileNav';
import { PlatformNav } from './PlatformNav';
import { PlatformThemeToggle } from './PlatformThemeToggle';

/**
 * Chrome do painel de super-admin (F25-S06) no DS 3.0 (F72-S08).
 *
 * Mesma arquitetura do shell do app (sidebar de 248px em `lg+`, barra de vidro no topo),
 * mas com um sinal de modo que não sai da tela: o fio âmbar (`warn`) no topo da barra, o
 * selo "Super-admin" e a barra ativa da navegação em `warn`. Quem está aqui sabe que não
 * está num workspace. Tokens semânticos, zero hex; as páginas renderizam em `children`.
 *
 * O guard (privilégio real) é do layout `(platform)` e da API; o shell só pinta.
 */
export function PlatformShell({ admin, children }: { admin: PlatformAdminMe; children: ReactNode }) {
  const who = admin.name ?? admin.email;
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside
        aria-label="Plataforma"
        className="fixed inset-y-0 left-0 z-40 hidden w-62 flex-col border-r border-border bg-surface lg:flex"
      >
        <div className="flex h-17 shrink-0 items-center px-5">
          <Link href="/platform" className="rounded-sm outline-none focus-visible:focus-ring" aria-label="Início da plataforma">
            <PlatformMark />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
          <PlatformNav />
        </div>
        <div className="border-t border-border px-3 py-2">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-sm px-3 py-2 font-head text-sm font-medium text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:focus-ring motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4.5 shrink-0 text-text-low" aria-hidden />
            Voltar ao workspace
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-62">
        <header
          className="pt-safe pl-safe pr-safe sticky top-0 z-30 border-b border-border bg-surface-glass shadow-[inset_0_2px_0_var(--warn)] backdrop-blur-xl"
        >
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:h-17 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <PlatformMobileNav />
              <span className="lg:hidden">
                <PlatformMark />
              </span>
              <p className="hidden items-center gap-2 font-body text-sm text-text-low lg:flex">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-warn">
                  Modo plataforma
                </span>
                <span aria-hidden>·</span>
                Acesso restrito. Toda ação sensível é auditada.
              </p>
            </div>
            <div className="flex min-w-0 shrink-0 items-center gap-1">
              <PlatformThemeToggle />
              <span
                className="ml-2 hidden min-w-0 max-w-56 flex-col text-right leading-tight sm:flex"
                title={admin.email}
              >
                <span className="truncate font-body text-sm font-semibold text-text">{who}</span>
                {admin.name && <span className="truncate font-mono text-xs text-text-low">{admin.email}</span>}
              </span>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-6 outline-none md:pb-[max(2rem,env(safe-area-inset-bottom))] md:pt-8 lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]"
        >
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
