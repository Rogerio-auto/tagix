'use client';

/**
 * Seção colapsável do cockpit (painel direito da conversa).
 *
 * O cockpit acumula MUITA função (status, agenda, cliente, card, conversão, IA,
 * roteamento, contexto, notas). Para o operador não rolar um painel infinito,
 * cada seção vira um card com header clicável (ícone + título + chevron) que
 * recolhe/expande o corpo. A preferência persiste por seção em `localStorage`
 * (`hm:cockpit:collapsed`, espelha o padrão de `shared/stores/ui.store.ts`), então
 * o que o operador esconde continua escondido entre conversas e reloads.
 *
 * DS v2: zero hex, só tokens semânticos (mesma superfície do antigo `Section`/
 * `Card` do cockpit). Acessível: `<button aria-expanded/aria-controls>` + foco
 * visível (`focus-visible:shadow-glow-md`). SSR-safe: inicia tudo expandido
 * (igual no servidor e no 1º render do client → sem hydration mismatch) e
 * hidrata o estado salvo após o mount.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const STORAGE_KEY = 'hm:cockpit:collapsed';

function loadCollapsed(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

function persistCollapsed(map: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage indisponível (modo privado/SSR) — recolhimento é best-effort */
  }
}

interface CockpitCollapseState {
  readonly collapsed: Record<string, boolean>;
  readonly hydrated: boolean;
  hydrate(): void;
  toggle(key: string): void;
}

/**
 * Estado compartilhado de recolhimento das seções do cockpit. Único store para
 * todas as seções → a preferência é consistente e sobrevive a navegação/reload.
 */
const useCockpitCollapse = create<CockpitCollapseState>((set, get) => ({
  collapsed: {},
  hydrated: false,
  hydrate() {
    if (get().hydrated) return;
    set({ collapsed: loadCollapsed(), hydrated: true });
  },
  toggle(key) {
    const next = { ...get().collapsed, [key]: !get().collapsed[key] };
    persistCollapsed(next);
    set({ collapsed: next });
  },
}));

export interface CollapsibleSectionProps {
  readonly title: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** Chave estável e única de persistência da seção (ex.: `agenda`, `notas`). */
  readonly sectionKey: string;
  readonly children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  icon: Icon,
  sectionKey,
  children,
}: CollapsibleSectionProps) {
  const collapsed = useCockpitCollapse((s) => s.collapsed[sectionKey] === true);
  const toggle = useCockpitCollapse((s) => s.toggle);
  const hydrate = useCockpitCollapse((s) => s.hydrate);

  // Hidrata o estado salvo após o mount (evita mismatch SSR: 1º render expandido).
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const bodyId = `cockpit-section-${sectionKey}`;

  return (
    <div className="rounded-md border border-border-2 bg-surface-2 p-4 shadow-elev-1">
      <button
        type="button"
        onClick={() => toggle(sectionKey)}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm text-left outline-none',
          'focus-visible:shadow-glow-md',
          collapsed ? '' : 'mb-3',
        )}
      >
        <Icon className="size-4 shrink-0 text-text-low" aria-hidden />
        <h3 className="font-head text-sm font-semibold text-text">{title}</h3>
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 text-text-low motion-safe:transition-transform',
            collapsed ? '-rotate-90' : 'rotate-0',
          )}
          aria-hidden
        />
      </button>
      {!collapsed && <div id={bodyId}>{children}</div>}
    </div>
  );
}
