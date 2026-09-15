import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Casca das páginas públicas (F69-S01): política de privacidade, termos de uso e
 * acompanhamento de exclusão de dados.
 *
 * Abrem sem login por exigência da Meta — o revisor do App Review e a pessoa que
 * pediu exclusão de dados não têm conta no Leadium. Por isso ficam fora do grupo
 * `(app)` e estão liberadas no `middleware.ts`.
 *
 * Largura de leitura (~68 caracteres por linha): é texto para ser lido, não tela
 * para ser operada.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <span className="font-head text-h3">Leadium</span>
          <nav className="flex gap-4 text-small text-text-2">
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/termos">Termos</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 pb-safe-4">{children}</main>
    </div>
  );
}
