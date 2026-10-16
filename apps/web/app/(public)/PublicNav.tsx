'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@hm/ui';

const LINKS = [
  { href: '/privacidade', label: 'Privacidade' },
  { href: '/termos', label: 'Termos' },
] as const;

/** Navegação entre os documentos públicos; a página atual leva `aria-current`. */
export function PublicNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentos legais" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const current = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'touch-target inline-flex items-center rounded-sm px-3 font-body text-sm font-semibold outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
              current ? 'bg-surface-2 text-text' : 'text-text-mid hover:bg-surface-2 hover:text-text',
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
