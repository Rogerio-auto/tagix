import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PLATFORM_ICONS } from '@/features/platform-admin/shell/icons';
import { groupedPlatformNav } from '@/features/platform-admin/shell/nav-items';

/**
 * Hub do painel de super-admin (F25-S06; DS 3.0 na F72-S08). Todas as áreas, nos mesmos
 * grupos da navegação, com o que cada uma resolve. Cada card é um link inteiro (UX §2.1).
 * Server Component: nada aqui tem estado.
 */
export const metadata = { title: 'Plataforma — Super-admin' };

export default function PlatformHome() {
  return (
    <div className="flex flex-col gap-10">
      <header className="max-w-2xl">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-warn">Super-admin</p>
        <h1 className="mt-2 font-head text-h4 text-text md:text-h3">Plataforma</h1>
        <p className="mt-2 font-body text-base text-text-mid">
          A camada acima dos workspaces: clientes e assinaturas, modelos e custo de IA, operação e
          segredos. Toda ação sensível é auditada.
        </p>
      </header>

      {groupedPlatformNav().map(({ group, label, items }) => (
        <section key={group} aria-labelledby={`hub-${group}`} className="flex flex-col gap-3">
          <h2
            id={`hub-${group}`}
            className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-text-low"
          >
            {label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const Icon = PLATFORM_ICONS[item.icon];
              return (
                <li key={item.href} className="flex">
                  <Link
                    href={item.href}
                    className="group flex w-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 outline-none transition-[border-color,background-color,transform] duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-2 focus-visible:focus-ring motion-safe:hover:-translate-y-px"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="grid size-9 place-items-center rounded-sm border border-border bg-surface-2 text-text-mid transition-colors duration-(--dur-base) group-hover:text-text">
                        <Icon className="size-4.5" aria-hidden />
                      </span>
                      <ArrowUpRight
                        className="size-4 text-text-low transition-[color,transform] duration-(--dur-base) ease-ds group-hover:text-text motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                        aria-hidden
                      />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 font-head text-base font-semibold text-text">
                        {item.label}
                        {item.sensitive && (
                          <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-warn">
                            Sensível
                          </span>
                        )}
                      </span>
                      <span className="font-body text-sm text-text-low">{item.help}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
