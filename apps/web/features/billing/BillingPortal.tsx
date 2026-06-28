'use client';

/**
 * Billing portal self-serve (F41-S06 / PAYMENTS_ABACATEPAY.md §8). Orquestra:
 *   - banner de estado (trial/past_due/cancelamento agendado)
 *   - card da assinatura atual + cancelar
 *   - seletor de plano/ciclo/método IN-PAGE → checkout hospedado
 *   - histórico de cobranças
 *   - tratamento do retorno do checkout (?status=…)
 *
 * UX aplicado: §2.3 (in-page, sem modal full-screen para escolher plano), §2.7
 * (feedback imediato/loading), §2.9 (cancelar confirma), §2.5/§2.4 (HelpPanel `?`
 * sempre visível). DS v2 dark-first, tokens semânticos, zero hex. Responsivo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HelpHint } from '@hm/ui';
import { ErrorState, Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout';
import { useBillingPlans, useBillingSubscription } from './queries';
import { billingHelp } from './help';
import { BillingBanner } from './components/BillingBanner';
import { CurrentPlanCard } from './components/CurrentPlanCard';
import { PaymentHistory } from './components/PaymentHistory';
import { PlanSelector } from './components/PlanSelector';
import { CheckoutReturnHandler } from './components/CheckoutReturnHandler';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-head text-lg font-semibold text-text">{children}</h2>;
}

export function BillingPortal() {
  const { data, isLoading, isError, refetch } = useBillingSubscription();
  const plansQuery = useBillingPlans();
  const planSectionRef = useRef<HTMLDivElement>(null);

  const scrollToPlans = useCallback(() => {
    planSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Intenção de plano vinda do signup (?plan=<key>): redireciona o usuário pago
  // direto ao seletor com o plano pré-selecionado. Client-only, sem Suspense.
  const [intentPlanKey] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('plan') ?? '').trim().toLowerCase();
  });
  const intentPlanId = intentPlanKey
    ? (plansQuery.data?.find((p) => p.key === intentPlanKey)?.id ?? null)
    : null;

  // Quando o plano da intenção fica resolvível, rola até a seção de planos (uma vez).
  const scrolledToIntent = useRef(false);
  useEffect(() => {
    if (intentPlanId && !scrolledToIntent.current) {
      scrolledToIntent.current = true;
      planSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [intentPlanId]);

  const subscription = data?.subscription ?? null;
  const currentCycle =
    subscription?.billingCycle === 'monthly' || subscription?.billingCycle === 'yearly'
      ? subscription.billingCycle
      : null;

  return (
    <div className="flex flex-col gap-8">
      <CheckoutReturnHandler />

      <PageHeader
        title="Cobrança"
        helpSlot={<HelpHint {...billingHelp} />}
      />

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Não foi possível carregar a cobrança"
          reason="Houve uma falha ao buscar os dados da sua assinatura."
          whatToDo="Tente novamente em instantes."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-md bg-surface-2 px-4 py-2 font-head text-sm font-semibold text-text outline-none transition-colors hover:bg-surface-3 focus-visible:shadow-glow-md"
            >
              Tentar novamente
            </button>
          }
        />
      ) : (
        <>
          {subscription && (
            <BillingBanner subscription={subscription} onUpgrade={scrollToPlans} />
          )}

          {subscription && (
            <section className="flex flex-col gap-3">
              <SectionTitle>Assinatura atual</SectionTitle>
              <CurrentPlanCard subscription={subscription} />
            </section>
          )}

          <section ref={planSectionRef} className="flex flex-col gap-3">
            <SectionTitle>
              {subscription?.status === 'active' ? 'Mudar de plano' : 'Escolher um plano'}
            </SectionTitle>
            <PlanSelector
              plans={plansQuery.data ?? []}
              currentPlanId={subscription?.plan?.id ?? null}
              currentCycle={currentCycle}
              initialPlanId={intentPlanId}
            />
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>Histórico de cobranças</SectionTitle>
            <PaymentHistory
              events={data?.history ?? []}
              isLoading={false}
              isError={false}
            />
          </section>
        </>
      )}
    </div>
  );
}
