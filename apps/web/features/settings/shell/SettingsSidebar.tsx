'use client';

/**
 * Sidebar agrupada do painel de settings (PERMISSIONS.md §5). Grupos Pessoal/Workspace
 * (Plataforma é F2.5, fora). Cada item: label + contador/alerta opcional. Itens são
 * gated por permissão pelo caller (recebe `sections` já filtradas). Seleção via
 * callback (conteúdo lazy à direita) ou navegação para `externalHref`.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, type Permission } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import type { CounterState, SettingsGroup, SettingsSection } from './registry';
import { SETTINGS_GROUP_LABEL, SETTINGS_GROUP_ORDER } from './registry';

/**
 * Entradas de settings que vivem em ROTA PRÓPRIA (não no shell lazy) e são
 * deep-links, gated por permissão localmente. O Billing portal (F41-S06) entra
 * aqui — evita "gear-only/caça ao tesouro" (UX §2.1/§2.4): cobrança ganha um item
 * de 1º nível no grupo Workspace, em vez de ficar escondido.
 */
interface ExternalNavItem {
  readonly id: string;
  readonly group: SettingsGroup;
  readonly label: string;
  readonly href: string;
  readonly permission: Permission;
}

const EXTERNAL_NAV: readonly ExternalNavItem[] = [
  {
    id: 'billing',
    group: 'workspace',
    label: 'Cobrança',
    href: '/settings/billing',
    permission: 'billing.view',
  },
];

interface SettingsSidebarProps {
  sections: readonly SettingsSection[];
  activeId: string;
  counters: Record<string, CounterState | null>;
  onSelect: (id: string) => void;
}

export function SettingsSidebar({ sections, activeId, counters, onSelect }: SettingsSidebarProps) {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.auth?.role);

  const byGroup = (group: SettingsGroup): SettingsSection[] =>
    sections.filter((s) => s.group === group);

  // Itens de rota própria (deep-link) visíveis para o role atual.
  const externalByGroup = (group: SettingsGroup): readonly ExternalNavItem[] =>
    EXTERNAL_NAV.filter((item) => item.group === group && role != null && can(role, item.permission));

  return (
    <nav
      aria-label="Seções de configurações"
      className="flex w-full shrink-0 flex-col gap-6 md:w-60"
    >
      {SETTINGS_GROUP_ORDER.map((group) => {
        const items = byGroup(group);
        const externals = externalByGroup(group);
        if (items.length === 0 && externals.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="px-2 font-head text-xs uppercase tracking-wide text-text-low">
              {SETTINGS_GROUP_LABEL[group]}
            </h3>
            {externals.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-body text-sm outline-none transition-colors focus-visible:shadow-glow-md',
                    'min-h-11 md:min-h-0',
                    active
                      ? 'bg-surface-2 text-text'
                      : 'text-text-mid hover:bg-surface-2 hover:text-text',
                  )}
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
            {items.map((section) => {
              const counter = counters[section.id] ?? null;
              const active = section.id === activeId && !section.externalHref;
              const content = (
                <>
                  <span className="truncate">{section.label}</span>
                  {counter && (
                    <span
                      className={cn(
                        'ml-auto shrink-0 rounded-pill px-1.5 py-0.5 text-[10px]',
                        counter.alert ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-text-low',
                      )}
                    >
                      {counter.label}
                    </span>
                  )}
                </>
              );
              const baseClass = cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-body text-sm outline-none transition-colors focus-visible:shadow-glow-md',
                'min-h-11 md:min-h-0',
                active
                  ? 'bg-surface-2 text-text'
                  : 'text-text-mid hover:bg-surface-2 hover:text-text',
              );
              if (section.externalHref) {
                return (
                  <Link key={section.id} href={section.externalHref} className={baseClass}>
                    {content}
                  </Link>
                );
              }
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={baseClass}
                  aria-current={active ? 'page' : undefined}
                >
                  {content}
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
