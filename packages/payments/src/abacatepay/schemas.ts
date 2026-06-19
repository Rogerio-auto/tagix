/**
 * Contratos Zod de request/response da AbacatePay v2 (confirmados contra a doc
 * oficial — docs.abacatepay.com).
 *
 * Base `https://api.abacatepay.com/v2`, auth `Authorization: Bearer`, valores em
 * **centavos/BRL**, envelope `{ data, success, error }`. Os schemas de resposta
 * mantêm `.passthrough()` para tolerar campos extras do gateway sem quebrar — só
 * validamos os campos que consumimos.
 */

import { z } from 'zod';

/** Inteiro não-negativo em centavos (BRL). */
export const CentsSchema = z.number().int().nonnegative();

/** Moeda suportada (merchant único = Leadium/Brasil). */
export const CurrencySchema = z.literal('BRL');

/** Ciclo de cobrança do gateway (product/subscription). */
export const CycleSchema = z.enum(['WEEKLY', 'MONTHLY', 'SEMIANNUALLY', 'ANNUALLY']);

/** Métodos de pagamento aceitos pela AbacatePay. */
export const MethodSchema = z.enum(['PIX', 'CARD']);

/**
 * Envelope padrão da AbacatePay: `{ data, success, error }`.
 * `success` pode não vir em todas as respostas → opcional; `error` pode ser
 * string ou objeto. `passthrough` para não perder campos novos.
 */
export function envelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      data: dataSchema.nullish(),
      success: z.boolean().optional(),
      error: z.union([z.string(), z.record(z.unknown())]).nullish(),
    })
    .passthrough();
}

// --- Products (POST /products/create) -----------------------------------

/**
 * Request de `/products/create`.
 * `price` em centavos; `currency` sempre 'BRL'; `cycle` obrigatório quando o
 * product vai lastrear uma assinatura.
 */
export const CreateProductRequestSchema = z.object({
  /** Idempotência: `externalId = plan.id` (one-time) ou `plan.id__CYCLE` (assinatura). */
  externalId: z.string().min(1),
  name: z.string().min(1),
  /** Preço em centavos. */
  price: CentsSchema,
  currency: CurrencySchema,
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  /** Obrigatório p/ assinatura; ausente em product avulso. */
  cycle: CycleSchema.optional(),
});

export const ProductDataSchema = z
  .object({
    id: z.string().min(1),
    externalId: z.string().optional(),
  })
  .passthrough();

// --- Customers (POST /customers/create) ---------------------------------

/**
 * Request de `/customers/create`. `email` é obrigatório; os demais são opcionais.
 */
export const CreateCustomerRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  /** E.164. */
  cellphone: z.string().optional(),
  /** CPF/CNPJ (dígitos). */
  taxId: z.string().optional(),
  /** CEP (dígitos). */
  zipCode: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const CustomerDataSchema = z
  .object({
    id: z.string().min(1),
    externalId: z.string().optional(),
  })
  .passthrough();

// --- Hosted checkout (POST /checkouts/create) ---------------------------

/**
 * Item de checkout/assinatura. `id` é o ID DO PRODUTO AbacatePay (de
 * `/products/create`), NÃO o `externalId`. **Não** se manda `price` — o preço
 * vem do product.
 */
export const CheckoutItemSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().positive(),
});

/**
 * Request de `/checkouts/create`. `methods` default ['PIX','CARD']; `items`
 * referencia o(s) product(s) por id; URLs e metadata para correlação.
 */
export const CreateCheckoutRequestSchema = z.object({
  items: z.array(CheckoutItemSchema).min(1),
  methods: z.array(MethodSchema).min(1).optional(),
  customerId: z.string().optional(),
  returnUrl: z.string().url().optional(),
  completionUrl: z.string().url().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const CheckoutDataSchema = z
  .object({
    /** `bill_…` */
    id: z.string().min(1),
    /** URL de redirecionamento (hosted page). Fonte do redirect. */
    url: z.string().url(),
    amount: CentsSchema.optional(),
    status: z.string().optional(),
  })
  .passthrough();

// --- Subscriptions (POST /subscriptions/create) -------------------------

/**
 * Request de `/subscriptions/create` — mesma forma do checkout, mas `items`
 * deve conter EXATAMENTE 1 product que TENHA `cycle`. `methods` default ['CARD'].
 */
export const CreateSubscriptionRequestSchema = z.object({
  items: z.array(CheckoutItemSchema).length(1),
  methods: z.array(MethodSchema).min(1).optional(),
  customerId: z.string().optional(),
  returnUrl: z.string().url().optional(),
  completionUrl: z.string().url().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const SubscriptionDataSchema = z
  .object({
    /** `bill_…` (id da cobrança que cria a assinatura). */
    id: z.string().min(1),
    /** Status: PENDING|EXPIRED|CANCELLED|PAID|REFUNDED. */
    status: z.string().optional(),
    /** URL para o cliente concluir o cadastro do cartão. */
    url: z.string().url().optional(),
    amount: CentsSchema.optional(),
    customerId: z.string().optional(),
  })
  .passthrough();

// --- Subscription cancel (POST /subscriptions/cancel) -------------------

/** Request de `/subscriptions/cancel`: body `{ id: 'subs_…' }`. */
export const CancelSubscriptionRequestSchema = z.object({
  id: z.string().min(1),
});

export const CancelSubscriptionDataSchema = z
  .object({
    id: z.string().min(1),
    /** Esperado 'CANCELLED' após o cancel. */
    status: z.string().optional(),
  })
  .passthrough();

// --- PIX (POST /transparents/create) ------------------------------------

/**
 * Conteúdo de `data` da cobrança PIX transparente. O request real aninha tudo
 * sob `{ data: {...} }` (montado no provider).
 */
export const CreatePixChargeDataSchema = z.object({
  amount: CentsSchema,
  /** Expiração em segundos. */
  expiresIn: z.number().int().positive().optional(),
  description: z.string().optional(),
  customer: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      taxId: z.string().optional(),
      cellphone: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string()).optional(),
});

/** Envelope do request de `/transparents/create`: `{ data: {...} }`. */
export const CreatePixChargeRequestSchema = z.object({
  data: CreatePixChargeDataSchema,
});

export const PixChargeDataSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    amount: CentsSchema.optional(),
    /** Copia-e-cola EMV do PIX. */
    brCode: z.string().optional(),
    /** QR em base64 (imagem). */
    brCodeBase64: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .passthrough();

// --- Webhook payload ----------------------------------------------------

/**
 * Envelope do payload do webhook (confirmado): `{ id, event, apiVersion,
 * devMode, data }`. `id` (`log_…`) top-level é a chave de idempotência.
 */
export const WebhookEventSchema = z
  .object({
    /** `log_…` — id único do log do evento (idempotência de domínio). */
    id: z.string().optional(),
    /** Tipo do evento (`checkout.completed`, `subscription.renewed`, ...). */
    event: z.string().optional(),
    apiVersion: z.string().optional(),
    devMode: z.boolean().optional(),
    /** Carga do evento. */
    data: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;
export type ProductData = z.infer<typeof ProductDataSchema>;
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;
export type CustomerData = z.infer<typeof CustomerDataSchema>;
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequestSchema>;
export type CheckoutData = z.infer<typeof CheckoutDataSchema>;
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;
export type SubscriptionData = z.infer<typeof SubscriptionDataSchema>;
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequestSchema>;
export type CancelSubscriptionData = z.infer<typeof CancelSubscriptionDataSchema>;
export type CreatePixChargeRequest = z.infer<typeof CreatePixChargeRequestSchema>;
export type PixChargeData = z.infer<typeof PixChargeDataSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
