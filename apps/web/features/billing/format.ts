/**
 * Helpers de apresentação do billing portal (F41-S06). Sem dependência de React —
 * puro, testável. Dinheiro em centavos BRL (PAYMENTS_ABACATEPAY.md §1).
 */
import type { BillingCycle, PaymentMethod, SubscriptionStatus } from './queries';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Centavos BRL → "R$ 99,00". `null` → "—". */
export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return brl.format(cents / 100);
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** ISO → "19 de jun. de 2026". `null`/inválido → "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: 'Mensal',
  yearly: 'Anual',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  card: 'Cartão de crédito',
  pix: 'PIX',
};

export interface StatusPresentation {
  readonly label: string;
  /** Classe de cor de fundo/texto do badge (tokens semânticos, zero hex). */
  readonly badgeClass: string;
}

/** Apresentação visual do status da assinatura (tokens semânticos do DS v2). */
export function statusPresentation(status: SubscriptionStatus): StatusPresentation {
  switch (status) {
    case 'active':
      return { label: 'Ativa', badgeClass: 'bg-success/15 text-success' };
    case 'trial':
      return { label: 'Em teste', badgeClass: 'bg-info/15 text-info' };
    case 'past_due':
      return { label: 'Pagamento pendente', badgeClass: 'bg-warn/15 text-warn' };
    case 'canceled':
      return { label: 'Cancelada', badgeClass: 'bg-surface-3 text-text-mid' };
    case 'expired':
      return { label: 'Expirada', badgeClass: 'bg-danger/15 text-danger' };
    default:
      return { label: status, badgeClass: 'bg-surface-3 text-text-mid' };
  }
}

/** Rótulo legível de um tipo de evento de pagamento (ledger). */
export function eventTypeLabel(eventType: string): string {
  const map: Record<string, string> = {
    'checkout.completed': 'Checkout concluído',
    'subscription.completed': 'Assinatura ativada',
    'subscription.renewed': 'Renovação',
    'subscription.cancelled': 'Cancelamento',
    'billing.refunded': 'Estorno',
    'billing.disputed': 'Contestação',
    'pix.charge': 'Cobrança PIX',
  };
  return map[eventType] ?? eventType;
}

export interface EventStatusPresentation {
  readonly label: string;
  readonly badgeClass: string;
}

export function eventStatusPresentation(status: string): EventStatusPresentation {
  switch (status) {
    case 'paid':
    case 'completed':
    case 'succeeded':
      return { label: 'Pago', badgeClass: 'bg-success/15 text-success' };
    case 'pending':
    case 'processing':
      return { label: 'Pendente', badgeClass: 'bg-warn/15 text-warn' };
    case 'failed':
    case 'refunded':
    case 'disputed':
      return { label: status === 'refunded' ? 'Estornado' : 'Falhou', badgeClass: 'bg-danger/15 text-danger' };
    default:
      return { label: status, badgeClass: 'bg-surface-3 text-text-mid' };
  }
}
