'use client';

import { Card, CardBody } from '@hm/ui';
import { Skeleton } from '@/shared/components/feedback';

/**
 * Esqueleto do wizard enquanto a campanha hidrata (UX §2.7/§3.6).
 * Espelha o layout real (header + trilha de passos + card) para nao "pular"
 * quando os dados chegarem — e nunca mostra tela em branco.
 */
export function WizardSkeleton({ steps = 6 }: { steps?: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy aria-label="Carregando campanha">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-4 w-40" />
      </header>

      <div className="flex gap-1">
        {Array.from({ length: steps }).map((_, i) => (
          <Skeleton key={i} className="h-1 flex-1 rounded-pill" />
        ))}
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
    </div>
  );
}
