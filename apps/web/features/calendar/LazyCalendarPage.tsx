'use client';

/**
 * Boundary lazy da Agenda (F10-S10). `@fullcalendar/*` é pesado e client-only
 * (mede DOM, sem render no server). Carregamos a `CalendarPage` inteira sob demanda
 * via `next/dynamic` com `ssr: false`: a lib sai do First Load JS de `/calendar` e
 * nunca paga hidratação dupla. Enquanto o chunk baixa, o `CalendarSkeleton` segura a
 * grade mensal (UX §3.6 — sem tela branca, sem CLS na hidratação).
 *
 * A page (Server Component) renderiza apenas `<LazyCalendarPage />`; toda a lógica
 * de queries/modais permanece dentro de `CalendarPage`, atrás do boundary.
 */
import { lazyClient } from '@/shared/lib/lazy';
import { CalendarSkeleton } from '@/shared/components/feedback';

const CalendarPageLazy = lazyClient<Record<string, never>>(
  () => import('./CalendarPage').then((m) => m.CalendarPage),
  {
  loading: () => (
    <div className="flex h-full flex-col gap-4 p-6">
      <CalendarSkeleton />
    </div>
  ),
  ssr: false,
  },
);

export function LazyCalendarPage(): React.JSX.Element {
  return <CalendarPageLazy />;
}
