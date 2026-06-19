'use client';

import Link from 'next/link';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { can } from '@hm/shared';
import { Card } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/components/feedback';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useChecklist } from './queries';
import { useChecklistDismissed } from './useChecklistDismissed';

/**
 * Checklist "Primeiros passos" no topo do dashboard (ONBOARDING.md §3.3).
 *
 * UX (UX_PRINCIPLES §2):
 *  - §2.6 — é o anti-empty-state do dashboard recém-criado: mostra o próximo passo
 *    concreto com CTA, em vez de cards vazios.
 *  - §2.4 — cada item linka direto para a tela certa (path óbvio, sem menu escondido).
 *  - §2.7 — estado **derivado do dado real** (S04): nenhum click-fantasma; some sozinho
 *    quando tudo está `done`. Loading com skeleton; erro é silencioso (widget acessório,
 *    não bloqueia o dashboard).
 *
 * Gating: só ADMIN/OWNER (têm `workspace.edit`) — coerente com o resto do onboarding;
 * para os demais a query nem dispara, sem ruído. Dispensa persistida em localStorage
 * por workspace (preferência de UI de baixo risco; ver `useChecklistDismissed`).
 */
export function SetupChecklist() {
  const auth = useAuthStore((s) => s.auth);
  const canOnboard = auth != null && can(auth.role, 'workspace.edit');
  const workspaceId = auth?.workspaceId ?? null;

  const { dismissed, dismiss } = useChecklistDismissed(workspaceId);
  const { data, isLoading, isError } = useChecklist(canOnboard && !dismissed);

  // Sem permissão, dispensado ou erro (acessório) → não renderiza nada.
  if (!canOnboard || dismissed || isError) return null;

  if (isLoading) {
    return (
      <Card elevation={2} className="overflow-hidden" aria-busy aria-label="Carregando primeiros passos">
        <div className="flex flex-col gap-4 p-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-1.5 w-full rounded-pill" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      </Card>
    );
  }

  const steps = data?.steps ?? [];
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;

  // Estado derivado: nada a fazer (sem passos, ou todos concluídos) → some sozinho.
  if (total === 0 || doneCount === total) return null;

  const pct = Math.round((doneCount / total) * 100);

  return (
    <Card elevation={2} className="overflow-hidden">
      <section className="flex flex-col gap-4 p-5" aria-labelledby="setup-checklist-title">
        {/* Cabeçalho: título + progresso + dispensar */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-brand">
              <Sparkles size={16} aria-hidden />
            </span>
            <div className="flex flex-col">
              <h2 id="setup-checklist-title" className="font-head text-base font-semibold text-text">
                Primeiros passos
              </h2>
              <p className="font-body text-xs text-text-low">
                {doneCount} de {total} concluídos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dispensar primeiros passos"
            className="rounded-md p-1 text-text-low transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:shadow-glow-md"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Barra de progresso */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
          aria-label={`${doneCount} de ${total} passos concluídos`}
        >
          <div
            className="h-full rounded-pill bg-brand transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Lista de passos */}
        <ul className="flex flex-col gap-1.5">
          {steps.map((step) => (
            <li key={step.key}>
              {step.done ? (
                <div className="flex items-center gap-3 rounded-md px-3 py-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-success text-text-on-brand">
                    <Check size={12} strokeWidth={3} aria-hidden />
                  </span>
                  <span className="flex-1 font-body text-sm text-text-low line-through">
                    {step.label}
                  </span>
                  <span className="font-body text-xs text-success">Feito</span>
                </div>
              ) : (
                <Link
                  href={step.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-md border border-border-2 px-3 py-2.5',
                    'transition-colors hover:border-border-brand hover:bg-surface-2',
                    'focus-visible:outline-none focus-visible:shadow-glow-md',
                  )}
                >
                  <span
                    className="size-5 shrink-0 rounded-pill border border-border-2 transition-colors group-hover:border-border-brand"
                    aria-hidden
                  />
                  <span className="flex-1 font-body text-sm font-medium text-text">{step.label}</span>
                  <ArrowRight
                    size={16}
                    aria-hidden
                    className="text-text-low transition-transform group-hover:translate-x-0.5 group-hover:text-text motion-reduce:transition-none"
                  />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}
