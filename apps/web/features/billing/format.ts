/**
 * Helpers de apresentação do billing portal (F41-S06; F72-S07 sem locale literal e com
 * tons do DS 3.0). Sem dependência de React — puro, testável.
 *
 * Moeda: a cobrança da plataforma é em reais (AbacatePay, PAYMENTS_ABACATEPAY.md §1) e o
 * contrato de `/api/billing/*` não carrega `currency`; o código fica numa constante única
 * aqui. O idioma da formatação é o da interface (`@/shared/lib/locale`).
 */
import type { BadgeTone } from '@hm/ui';
import { formatDate as formatUiDate, formatMoney } from '@/shared/lib/locale';
import type { BillingCycle, PaymentMethod, SubscriptionStatus } from './queries';

/** Moeda única da cobrança da plataforma (o contrato não envia `currency`). */
export const BILLING_CURRENCY = 'BRL';

/** Centavos da cobrança → "R$ 99,00" (pt-BR). `null` → "—". */
export function formatBRL(cents: number | null | undefined): string {
  return formatMoney(cents, BILLING_CURRENCY);
}

/**
 * ISO → "19 de jun. de 2026" (pt-BR; texto corrido e detalhe). Passe `options` para o
 * formato de lista ("19/06/2026"). `null`/inválido → "—".
 */
export function formatDate(iso: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  return formatUiDate(iso, options);
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
  /** Tom do `StatusPill` (tokens de estado do DS 3.0, ≥4,5:1 nos dois temas). */
  readonly tone: BadgeTone;
}

/** Apresentação visual do status da assinatura. */
export function statusPresentation(status: SubscriptionStatus): StatusPresentation {
  switch (status) {
    case 'active':
      return { label: 'Ativa', tone: 'success' };
    case 'trial':
      return { label: 'Em teste', tone: 'info' };
    case 'past_due':
      return { label: 'Pagamento pendente', tone: 'warning' };
    case 'canceled':
      return { label: 'Cancelada', tone: 'neutral' };
    case 'expired':
      return { label: 'Expirada', tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
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

export type EventStatusPresentation = StatusPresentation;

export function eventStatusPresentation(status: string): EventStatusPresentation {
  switch (status) {
    case 'paid':
    case 'completed':
    case 'succeeded':
      return { label: 'Pago', tone: 'success' };
    case 'pending':
    case 'processing':
      return { label: 'Pendente', tone: 'warning' };
    case 'failed':
    case 'refunded':
    case 'disputed':
      return { label: status === 'refunded' ? 'Estornado' : 'Falhou', tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
  }
}
