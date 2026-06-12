import { Skeleton } from '@/shared/components/feedback';

/**
 * Loading de rota do grupo `(app)` (F10-S10 / UX §3.6). Streaming de Suspense em
 * nível de segmento: aparece durante o check de sessão do layout e em navegações
 * sem `loading.tsx` próprio. Forma neutra (cabeçalho + grade de blocos) — rotas
 * pesadas (`/calendar`, `/flows/[id]`) têm skeleton dedicado. Nunca tela branca.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy aria-label="Carregando">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
