'use client';

/**
 * Card da assinatura atual (F41-S06): plano, status, método, próximo vencimento e
 * cancelar. Ação destrutiva (cancelar) com confirmação proporcional (UX §2.9):
 * cancelamento agenda o corte no fim do ciclo — confirma via Modal, não window.confirm.
 * DS v2: Card/Button de @hm/ui, tokens semânticos, zero hex.
 */
import { useState } from 'react';
import { Card, CardBody, CardHeader, Button, Modal, useToast } from '@hm/ui';
import { CreditCard, QrCode } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { CurrentSubscription } from '../queries';
import { useCancelSubscription } from '../queries';
import { CYCLE_LABEL, formatBRL, formatDate, METHOD_LABEL, statusPresentation } from '../format';

function priceForCycle(sub: CurrentSubscription): number | null {
  if (!sub.plan) return null;
  if (sub.billingCycle === 'yearly') {
    return sub.plan.priceYearlyCents > 0
      ? sub.plan.priceYearlyCents
      : sub.plan.priceMonthlyCents * 12;
  }
  return sub.plan.priceMonthlyCents;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="font-body text-sm text-text-low">{label}</dt>
      <dd className="text-right font-head text-sm font-medium text-text">{children}</dd>
    </div>
  );
}

interface CurrentPlanCardProps {
  subscription: CurrentSubscription;
}

export function CurrentPlanCard({ subscription }: CurrentPlanCardProps) {
  const { toast } = useToast();
  const cancel = useCancelSubscription();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const status = statusPresentation(subscription.status);
  const price = priceForCycle(subscription);
  const method = subscription.paymentMethod;
  const canCancel =
    !subscription.cancelAtPeriodEnd &&
    subscription.status !== 'canceled' &&
    subscription.status !== 'expired';

  async function handleCancel() {
    try {
      const res = await cancel.mutateAsync();
      setConfirmOpen(false);
      toast({
        variant: 'success',
        title: 'Cancelamento agendado',
        description:
          res.effective === 'period_end'
            ? 'Seu plano permanece ativo até o fim do ciclo atual.'
            : 'Assinatura cancelada.',
      });
    } catch {
      toast({
        variant: 'error',
        title: 'Não foi possível cancelar',
        description: 'Tente novamente em instantes ou fale com o suporte.',
      });
    }
  }

  return (
    <Card elevation={2}>
      <CardHeader
        title={subscription.plan?.name ?? 'Plano atual'}
        action={
          <span
            className={cn('rounded-pill px-2.5 py-1 font-head text-xs font-semibold', status.badgeClass)}
          >
            {status.label}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-1">
        <dl className="divide-y divide-border-2">
          <Row label="Valor">
            {price != null ? (
              <span className="font-price">
                {formatBRL(price)}
                <span className="text-text-low">
                  {subscription.billingCycle === 'yearly' ? ' / ano' : ' / mês'}
                </span>
              </span>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Ciclo">
            {CYCLE_LABEL[subscription.billingCycle as 'monthly' | 'yearly'] ?? subscription.billingCycle}
          </Row>
          <Row label="Método de pagamento">
            {method ? (
              <span className="inline-flex items-center gap-1.5">
                {method === 'card' ? (
                  <CreditCard className="size-4 text-text-mid" aria-hidden />
                ) : (
                  <QrCode className="size-4 text-text-mid" aria-hidden />
                )}
                {METHOD_LABEL[method]}
              </span>
            ) : (
              '—'
            )}
          </Row>
          <Row label={subscription.cancelAtPeriodEnd ? 'Ativo até' : 'Próximo vencimento'}>
            {formatDate(subscription.currentPeriodEnd)}
          </Row>
        </dl>

        {canCancel && (
          <div className="mt-3 flex justify-end border-t border-border-2 pt-4">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
              Cancelar assinatura
            </Button>
          </div>
        )}
      </CardBody>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Cancelar assinatura?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={cancel.isPending}>
              Manter plano
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={handleCancel}>
              Confirmar cancelamento
            </Button>
          </>
        }
      >
        <p className="font-body text-sm text-text-mid">
          {subscription.currentPeriodEnd
            ? `Seu plano permanece ativo até ${formatDate(subscription.currentPeriodEnd)} e não será renovado. Você pode reativar antes dessa data.`
            : 'Seu plano não será renovado ao fim do ciclo atual. Você pode reativar antes dessa data.'}
        </p>
      </Modal>
    </Card>
  );
}
