'use client';

/**
 * Seletor de plano + ciclo + método de pagamento, IN-PAGE (UX §2.3 — NÃO usar
 * modal full-screen para escolher plano). Fluxo de upgrade:
 *   selecionar plano → ciclo (mensal/anual) → método (cartão/PIX)
 *   → POST /api/billing/checkout → redireciona ao checkout hospedado (returnUrl
 *   volta a /settings/billing?status=…). Feedback imediato no botão (UX §2.7).
 *
 * Seam: o catálogo de planos voltado ao tenant ainda não é exposto pela S04;
 * sem planos, mostra estado honesto (EmptyState) em vez de inventar preço.
 * DS 3.0 (F72-S07): preço em mono tabular; o neon cheio fica só no CTA (1 destaque por
 * tela) — o plano escolhido é marcado com a borda e o selo em `brand-text`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, useToast } from '@hm/ui';
import { Check, CreditCard, PackageSearch, QrCode } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { EmptyState } from '@/shared/components/feedback';
import type { BillingCycle, BillingPlan, PaymentMethod } from '../queries';
import { useStartCheckout } from '../queries';
import { CYCLE_LABEL, formatBRL } from '../format';

interface PlanSelectorProps {
  plans: readonly BillingPlan[];
  currentPlanId: string | null;
  currentCycle: BillingCycle | null;
  /**
   * Plano a pré-selecionar quando ficar resolvível (ex.: intenção de plano vinda do
   * signup via ?plan=). Aplicado uma única vez — não sobrescreve escolha do usuário.
   */
  initialPlanId?: string | null;
}

function yearlyPrice(plan: BillingPlan): number {
  return plan.priceYearlyCents > 0 ? plan.priceYearlyCents : plan.priceMonthlyCents * 12;
}

/** Desconto % do anual vs 12× mensal; 0 quando não há vantagem. */
function yearlySavingsPct(plan: BillingPlan): number {
  const full = plan.priceMonthlyCents * 12;
  if (full <= 0) return 0;
  const saved = full - yearlyPrice(plan);
  return saved > 0 ? Math.round((saved / full) * 100) : 0;
}

export function PlanSelector({
  plans,
  currentPlanId,
  currentCycle,
  initialPlanId,
}: PlanSelectorProps) {
  const { toast } = useToast();
  const checkout = useStartCheckout();

  const billablePlans = useMemo(() => plans.filter((p) => p.priceMonthlyCents > 0), [plans]);

  const [cycle, setCycle] = useState<BillingCycle>(currentCycle ?? 'monthly');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPlanId ?? currentPlanId ?? billablePlans[0]?.id ?? null,
  );

  useEffect(() => {
    if (!selectedId && billablePlans[0]) setSelectedId(billablePlans[0].id);
  }, [billablePlans, selectedId]);

  // Pré-seleção do plano vindo do signup (?plan=): aplica assim que o catálogo
  // carrega (o id pode não existir no primeiro render). Uma única vez — depois o
  // usuário manda na seleção.
  const appliedInitial = useRef(false);
  useEffect(() => {
    if (appliedInitial.current) return;
    if (initialPlanId && billablePlans.some((p) => p.id === initialPlanId)) {
      setSelectedId(initialPlanId);
      appliedInitial.current = true;
    }
  }, [initialPlanId, billablePlans]);

  if (billablePlans.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Nenhum plano disponível"
        description="O catálogo de planos ainda não está disponível para autoatendimento. Fale com o nosso time para escolher o melhor plano."
      />
    );
  }

  async function handleCheckout() {
    if (!selectedId) return;
    try {
      const { redirectUrl } = await checkout.mutateAsync({ planId: selectedId, cycle, method });
      // Redireciona o browser para o checkout hospedado (AbacatePay). O retorno
      // cai em /settings/billing?status=… (tratado por CheckoutReturnHandler).
      window.location.assign(redirectUrl);
    } catch {
      toast({
        variant: 'error',
        title: 'Não foi possível iniciar o checkout',
        description: 'Verifique sua conexão e tente novamente.',
      });
    }
  }

  const selectedPlan = billablePlans.find((p) => p.id === selectedId) ?? null;
  const isCurrent = selectedPlan?.id === currentPlanId && cycle === currentCycle;

  return (
    <div className="flex flex-col gap-5">
      {/* Toggle de ciclo */}
      <div className="flex items-center gap-3">
        <div
          role="group"
          aria-label="Ciclo de cobrança"
          className="inline-flex rounded-sm border border-border bg-surface-2 p-0.5"
        >
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                'h-9 rounded-xs px-4 font-body text-sm font-bold outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
                cycle === c ? 'bg-surface text-text shadow-ds-1' : 'text-text-mid hover:text-text',
              )}
            >
              {CYCLE_LABEL[c]}
            </button>
          ))}
        </div>
        {cycle === 'yearly' && (
          <span className="font-body text-sm text-text-low">Cobrança única anual</span>
        )}
      </div>

      {/* Grade de planos */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {billablePlans.map((plan) => {
          const selected = plan.id === selectedId;
          const price = cycle === 'yearly' ? yearlyPrice(plan) : plan.priceMonthlyCents;
          const savings = cycle === 'yearly' ? yearlySavingsPct(plan) : 0;
          const current = plan.id === currentPlanId;
          return (
            <button
              key={plan.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedId(plan.id)}
              className={cn(
                'group relative flex flex-col items-start gap-3 rounded-lg border p-5 text-left outline-none',
                'transition-[border-color,background-color,transform,box-shadow] duration-(--dur-base) ease-ds focus-visible:focus-ring',
                selected
                  ? 'border-brand-text bg-brand-text/[0.06] shadow-ds-1'
                  : 'border-border bg-surface hover:border-border-2 hover:bg-surface-2 motion-safe:hover:-translate-y-px',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-head text-lg font-semibold text-text">{plan.name}</span>
                {selected && (
                  <span
                    className="inline-flex size-5 items-center justify-center rounded-pill bg-brand-text text-bg"
                    aria-hidden
                  >
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-h4 font-medium tabular-nums tracking-tight text-text">
                  {formatBRL(price)}
                </span>
                <span className="font-body text-sm text-text-low">
                  {cycle === 'yearly' ? '/ ano' : '/ mês'}
                </span>
              </div>
              {savings > 0 && (
                <Badge tone="success" size="sm">
                  Economize <span className="font-mono tabular-nums">{savings}%</span>
                </Badge>
              )}
              {current && (
                <span className="font-body text-xs text-text-low">Seu plano atual</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Método de pagamento */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-mono text-xs font-medium uppercase tracking-widest text-text-low">
          Forma de pagamento
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { value: 'card' as const, label: 'Cartão de crédito', hint: 'Renovação automática', icon: CreditCard },
              { value: 'pix' as const, label: 'PIX', hint: 'Pagamento a cada ciclo', icon: QrCode },
            ]
          ).map((opt) => {
            const active = method === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setMethod(opt.value)}
                className={cn(
                  'flex items-center gap-3 rounded-md border p-3.5 text-left outline-none transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring',
                  active
                    ? 'border-text-mid bg-surface-2'
                    : 'border-border bg-surface hover:border-border-2 hover:bg-surface-2',
                )}
              >
                <Icon className={cn('size-5 shrink-0', active ? 'text-text' : 'text-text-mid')} aria-hidden />
                <span className="flex flex-col">
                  <span className="font-body text-sm font-bold text-text">{opt.label}</span>
                  <span className="font-body text-xs text-text-low">{opt.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-body text-sm text-text-mid">
          Você será levado a um checkout seguro para concluir o pagamento.
        </p>
        <Button
          variant="primary"
          loading={checkout.isPending}
          disabled={!selectedId || isCurrent}
          onClick={handleCheckout}
          className="w-full sm:w-auto"
        >
          {isCurrent ? 'Plano atual' : 'Continuar para pagamento'}
        </Button>
      </div>
    </div>
  );
}
