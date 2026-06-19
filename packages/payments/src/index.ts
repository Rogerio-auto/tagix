/**
 * @hm/payments — gateway de pagamento atrás de uma interface.
 *
 * Fundação da F41 (PAYMENTS_ABACATEPAY.md §3). `IPaymentProvider` é a fronteira;
 * `AbacatePayProvider` é o adapter real (client HTTP tipado v2),
 * `MockPaymentProvider` é determinístico (dev/testes sem rede) e
 * `verifyWebhookSignature` faz a verificação HMAC do webhook (fonte da verdade
 * do pagamento). Sem dependência de DB/Express — pacote puro, plugável.
 *
 * Convenção monetária: centavos, BRL.
 */

// --- Fronteira + tipos de domínio ---
export type {
  IPaymentProvider,
  Currency,
  BillingCycle,
  PaymentMethod,
  ProviderSubscriptionStatus,
  PaymentPlanInput,
  PaymentWorkspaceInput,
  ProviderProduct,
  ProviderCustomer,
  CreateHostedCheckoutInput,
  HostedCheckoutResult,
  CreateSubscriptionInput,
  SubscriptionResult,
  CreatePixChargeInput,
  PixChargeResult,
  SubscriptionSnapshot,
} from './types';

// --- Erros normalizados ---
export {
  PaymentProviderError,
  isRetryableStatus,
  type PaymentErrorKind,
} from './errors';

// --- Webhook (HMAC) ---
export { verifyWebhookSignature, ABACATEPAY_SIGNATURE_HEADER } from './webhook';

// --- Adapter real AbacatePay ---
export { AbacatePayProvider } from './abacatepay/provider';
export {
  AbacatePayClient,
  ABACATEPAY_API_BASE,
  type AbacatePayClientOptions,
  type JsonBody,
} from './abacatepay/client';

// --- Mock determinístico ---
export { MockPaymentProvider, type MockPaymentProviderOptions } from './mock/provider';

// --- Contratos Zod (request/response por endpoint + webhook) ---
export {
  CentsSchema,
  envelopeSchema,
  CreateProductRequestSchema,
  ProductDataSchema,
  CreateCustomerRequestSchema,
  CustomerDataSchema,
  CreateCheckoutRequestSchema,
  CheckoutDataSchema,
  CreateSubscriptionRequestSchema,
  SubscriptionDataSchema,
  CreatePixChargeRequestSchema,
  PixChargeDataSchema,
  WebhookEventSchema,
  type CreateProductRequest,
  type ProductData,
  type CreateCustomerRequest,
  type CustomerData,
  type CreateCheckoutRequest,
  type CheckoutData,
  type CreateSubscriptionRequest,
  type SubscriptionData,
  type CreatePixChargeRequest,
  type PixChargeData,
  type WebhookEvent,
} from './abacatepay/schemas';

export const PAYMENTS_PKG = '@hm/payments' as const;
