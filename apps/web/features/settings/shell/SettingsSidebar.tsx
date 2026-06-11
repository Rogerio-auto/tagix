'use client';

/**
 * Sidebar agrupada do painel de settings (PERMISSIONS.md §5). Grupos Pessoal/Workspace
 * (Plataforma é F2.5, fora). Cada item: label + contador/alerta opcional. Itens são
 * gated por permissão pelo caller (recebe `sections` já filtradas). Seleção via
 * callback (conteúdo lazy à direita) ou navegação para `externalHref`.
 */
import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import type { CounterState, SettingsGroup, SettingsSection } from './registry';
import { SETTINGS_GROUP_LABEL, SETTINGS_GROUP_ORDER } from './registry';

interface SettingsSidebarProps {
  sections: readonly SettingsSection[];
  activeId: string;
  counters: Record<string, CounterState | null>;
  onSelect: (id: string) => void;
}

export function SettingsSidebar({ sections, activeId, counters, onSelect }: SettingsSidebarProps) {
  const byGroup = (group: SettingsGroup): SettingsSection[] =>
    sections.filter((s) => s.group === group);

  return (
    <nav aria-label="Seções de configurações" className="flex w-60 shrink-0 flex-col gap-6">
      {SETTINGS_GROUP_ORDER.map((group) => {
        const items = byGroup(group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="px-2 font-head text-xs uppercase tracking-wide text-text-low">
              {SETTINGS_GROUP_LABEL[group]}
            </h3>
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
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left font-body text-sm transition-colors',
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
