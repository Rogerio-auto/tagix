'use client';

/**
 * Banner de estado da assinatura (UX_PRINCIPLES §3 — feedback de estado claro):
 * trial (informativo), past_due (atenção, cobrança falhou) e cancel-agendado.
 * Cor por token semântico (info/warn), zero hex. Não usa o verde-neon `--brand`
 * (reservado a 1 destaque/tela). Inclui a ação certa pra cada estado.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Clock, Info } from 'lucide-react';
import { Button } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import type { CurrentSubscription } from '../queries';
import { formatDate } from '../format';

type Tone = 'info' | 'warn';

interface BannerShellProps {
  tone: Tone;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

function BannerShell({ tone, icon, title, children, action }: BannerShellProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between',
        tone === 'warn'
          ? 'border-warn/40 bg-warn/10'
          : 'border-info/40 bg-info/10',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 shrink-0', tone === 'warn' ? 'text-warn' : 'text-info')} aria-hidden>
          {icon}
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="font-head text-sm font-semibold text-text">{title}</p>
          <p className="font-body text-sm text-text-mid">{children}</p>
        </div>
      </div>
      {action && <div className="shrink-0 sm:self-center">{action}</div>}
    </div>
  );
}

interface BillingBannerProps {
  subscription: CurrentSubscription;
  /** Leva o usuário até o seletor de planos (rola até a seção). */
  onUpgrade: () => void;
}

export function BillingBanner({ subscription, onUpgrade }: BillingBannerProps) {
  const { status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;

  if (status === 'past_due') {
    return (
      <BannerShell
        tone="warn"
        icon={<AlertTriangle className="size-5" />}
        title="Pagamento pendente"
        action={
          <Button variant="secondary" size="sm" onClick={onUpgrade}>
            Regularizar pagamento
          </Button>
        }
      >
        Não conseguimos confirmar o último pagamento. Regularize para manter o acesso completo ao
        workspace.
      </BannerShell>
    );
  }

  if (status === 'trial') {
    return (
      <BannerShell
        tone="info"
        icon={<Clock className="size-5" />}
        title="Período de teste"
        action={
          <Button variant="secondary" size="sm" onClick={onUpgrade}>
            Escolher um plano
          </Button>
        }
      >
        {currentPeriodEnd
          ? `Seu teste vai até ${formatDate(currentPeriodEnd)}. Escolha um plano para continuar sem interrupção.`
          : 'Você está no período de teste. Escolha um plano para continuar sem interrupção.'}
      </BannerShell>
    );
  }

  if (cancelAtPeriodEnd) {
    return (
      <BannerShell
        tone="warn"
        icon={<Info className="size-5" />}
        title="Cancelamento agendado"
      >
        {currentPeriodEnd
          ? `Seu plano permanece ativo até ${formatDate(currentPeriodEnd)} e não será renovado.`
          : 'Seu plano não será renovado ao fim do ciclo atual.'}
      </BannerShell>
    );
  }

  return null;
}
