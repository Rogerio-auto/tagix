import { CalendarSkeleton } from '@/shared/components/feedback';

/**
 * Loading da rota `/calendar` (F10-S10 / UX §3.6). Espelha a forma da Agenda enquanto
 * o segmento e o chunk de `@fullcalendar/*` carregam — sem tela branca, sem CLS.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <CalendarSkeleton />
    </div>
  );
}
