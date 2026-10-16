'use client';

/**
 * Sidebar agrupada do painel de settings (PERMISSIONS.md §5), no DS 3.0 (F72-S07).
 * Grupos Pessoal/Workspace com rótulo em mono caixa-alta; item ativo com o filete de
 * marca à esquerda (mesmo desenho da navegação principal); contador em mono. Itens que
 * levam a outra página mostram a seta de saída — quem clica sabe que vai trocar de tela.
 *
 * Itens são gated por permissão pelo caller (recebe `sections` já filtradas). Seleção via
 * callback (conteúdo lazy à direita) ou navegação para `externalHref`.
 *
 * No celular a mesma lista é a view-base da pilha (MOBILE_UX §2): linhas de 44px com
 * chevron, agrupadas em superfícies com hairline.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { can, type Permission } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { eyebrowClass } from '../sections/personal/components';
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

const ITEM_BASE = cn(
  'group/item relative flex w-full items-center gap-2 rounded-sm px-3 text-left font-body text-sm font-semibold outline-none',
  'transition-[background-color,color,transform] duration-(--dur-base) ease-ds focus-visible:focus-ring',
  'min-h-11 md:min-h-9',
);

function itemClass(active: boolean, mobile: boolean): string {
  if (mobile) return cn(ITEM_BASE, 'rounded-none px-4 text-text hover:bg-surface-2');
  return cn(
    ITEM_BASE,
    active
      ? 'bg-surface-2 text-text shadow-[inset_2px_0_0_var(--brand-text)]'
      : 'text-text-mid hover:bg-surface-2 hover:text-text motion-safe:hover:translate-x-0.5',
  );
}

function Counter({ counter }: { counter: CounterState }) {
  const visible = counter.short ?? counter.label;
  const compact = visible !== counter.label;
  return (
    <span
      title={counter.label}
      className={cn(
        // Forma compacta, sem truncar. O alerta usa o tom de aviso: o mesmo do selo
        // "Desautorizado" da página Canais.
        'ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-xs tabular-nums',
        counter.alert ? 'font-semibold text-warn' : 'text-text-low',
      )}
    >
      {counter.alert && <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-current" />}
      {/* O leitor de tela ouve o resumo inteiro; a vista, a forma compacta. */}
      <span aria-hidden={compact || undefined}>{visible}</span>
      {compact && <span className="sr-only">{counter.label}</span>}
    </span>
  );
}

export function SettingsSidebar({ sections, activeId, counters, onSelect }: SettingsSidebarProps) {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.auth?.role);
  const { isMobile } = useBreakpoint();

  const byGroup = (group: SettingsGroup): SettingsSection[] => sections.filter((s) => s.group === group);

  // Itens de rota própria (deep-link) visíveis para o role atual.
  const externalByGroup = (group: SettingsGroup): readonly ExternalNavItem[] =>
    EXTERNAL_NAV.filter((item) => item.group === group && role != null && can(role, item.permission));

  const trailing = (external: boolean) =>
    isMobile ? (
      <ChevronRight className="size-4 shrink-0 text-text-low" aria-hidden />
    ) : external ? (
      <ArrowUpRight
        className="size-3.5 shrink-0 text-text-low opacity-0 transition-opacity duration-(--dur-base) group-hover/item:opacity-100 group-focus-visible/item:opacity-100"
        aria-hidden
      />
    ) : null;

  return (
    <nav aria-label="Seções de configurações" className="flex w-full shrink-0 flex-col gap-6 md:w-56">
      {SETTINGS_GROUP_ORDER.map((group) => {
        const items = byGroup(group);
        const externals = externalByGroup(group);
        if (items.length === 0 && externals.length === 0) return null;
        const headingId = `settings-group-${group}`;
        return (
          <div key={group} className="flex flex-col gap-1.5">
            <h3 id={headingId} className={cn(eyebrowClass, 'px-3')}>
              {SETTINGS_GROUP_LABEL[group]}
            </h3>
            <ul
              aria-labelledby={headingId}
              className={cn(
                'flex flex-col gap-0.5',
                isMobile && 'divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface',
              )}
            >
              {externals.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={itemClass(active, isMobile)}
                    >
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto flex items-center">{trailing(true)}</span>
                    </Link>
                  </li>
                );
              })}
              {items.map((section) => {
                const counter = counters[section.id] ?? null;
                const active = section.id === activeId && !section.externalHref;
                const content = (
                  <>
                    <span className={cn('truncate', counter && 'min-w-[40%] shrink-0')}>
                      {section.navLabel ?? section.label}
                    </span>
                    {counter && <Counter counter={counter} />}
                    <span className={cn('flex items-center', !counter && 'ml-auto')}>
                      {trailing(Boolean(section.externalHref))}
                    </span>
                  </>
                );
                if (section.externalHref) {
                  return (
                    <li key={section.id}>
                      <Link href={section.externalHref} className={itemClass(false, isMobile)}>
                        {content}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(section.id)}
                      className={itemClass(active, isMobile)}
                      aria-current={active ? 'page' : undefined}
                    >
                      {content}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
