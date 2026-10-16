import type { ReactNode } from 'react';
import { Logo } from '@/features/auth/components/Logo';
import { PublicNav } from './PublicNav';

/**
 * Casca das páginas públicas (F69-S01; DS 3.0 na F72-S08): política de privacidade,
 * termos de uso e acompanhamento de exclusão de dados.
 *
 * Abrem sem login por exigência da Meta — o revisor do App Review e a pessoa que
 * pediu exclusão de dados não têm conta no Leadium. Por isso ficam fora do grupo
 * `(app)` e estão liberadas no `middleware.ts`.
 *
 * É texto para ser lido, não tela para ser operada: a medida de leitura (~68
 * caracteres) mora em cada documento; a casca só dá a marca, a navegação e o contato.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-bg pt-safe">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
          <Logo />
          <PublicNav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 md:px-8 md:py-20">{children}</main>
      <footer className="border-t border-border pb-safe-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 py-6 font-mono text-xs text-text-low sm:flex-row sm:items-center sm:justify-between md:px-8">
          <span>Leadium</span>
          <a
            href="mailto:suporte@leadium.com.br"
            className="w-fit rounded-xs outline-none transition-colors duration-(--dur-fast) ease-ds hover:text-text focus-visible:focus-ring"
          >
            suporte@leadium.com.br
          </a>
        </div>
      </footer>
    </div>
  );
}
