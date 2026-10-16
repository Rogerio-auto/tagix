'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/shared/lib/cn';
import { PLATFORM_ICONS } from './icons';
import { groupedPlatformNav } from './nav-items';

/**
 * Navegação do painel de super-admin no DS 3.0 (F72-S08), mesma gramática da Sidebar do
 * app: grupos com rótulo mono, item ativo em `surface-2` com barra de 2px. A barra e o
 * ícone ativos usam `warn` (não a marca): é o sinal permanente de "modo plataforma",
 * distinto do workspace (F25-S06).
 *
 * `touch`: alvos de 44px (navegação mobile, dentro do bottom-sheet).
 * O texto de cada área mora no `?` da própria tela (UX §2.5), não em tooltip.
 */
export function PlatformNav({ touch = false }: { touch?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegação de plataforma" className={cn('flex flex-col', touch ? 'gap-4' : 'gap-5')}>
      {groupedPlatformNav().map(({ group, label, items }) => (
        <div key={group}>
          <p className="px-3 pb-1.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-text-low">
            {label}
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = PLATFORM_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group/nav flex items-center gap-3 rounded-sm px-3 font-head text-sm font-medium outline-none',
                      'transition-colors duration-200 motion-reduce:transition-none focus-visible:focus-ring',
                      touch ? 'min-h-11' : 'py-2',
                      active
                        ? 'bg-surface-2 text-text shadow-[inset_2px_0_0_var(--warn)]'
                        : 'text-text-mid hover:bg-surface-2 hover:text-text',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4.5 shrink-0 transition-colors duration-200 motion-reduce:transition-none',
                        active ? 'text-warn' : 'text-text-low group-hover/nav:text-text-mid',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.sensitive && (
                      <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-warn">
                        Sensível
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
