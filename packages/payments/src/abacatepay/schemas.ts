/**
 * Contratos Zod de request/response da AbacatePay v2.
 *
 * IMPORTANTE — shapes INCERTOS: a API AbacatePay v2 usa o envelope
 * `{ data, success, error }` e valores em centavos/BRL, mas os nomes EXATOS dos
 * campos de cada endpoint precisam ser confirmados contra a doc/sandbox
 * (`PAYMENTS_ABACATEPAY.md` §1/§10). Cada schema abaixo está marcado com
 * `TODO(confirmar)` no(s) campo(s) duvidoso(s) e propositalmente tolerante
 * (`.passthrough()` no envelope, campos opcionais) para ser fácil de ajustar
 * sem quebrar os callers — basta apertar quando os shapes forem confirmados.
 */

import { z } from 'zod';

/** Inteiro não-negativo em centavos (BRL). */
export const CentsSchema = z.number().int().nonnegative();

/**
 * Envelope padrão da AbacatePay: `{ data, success, error }`.
 * `success` pode não vir em todas as respostas → opcional; `error` pode ser
 * string ou objeto. Mantemos `passthrough` para não perder campos novos.
 * TODO(confirmar): se `success` é sempre presente e o shape de `error`.
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

// --- Products -----------------------------------------------------------

/**
 * Request de criação de product.
 * TODO(confirmar): nomes de campos (`name`, `description`, `price`, `externalId`)
 * e se o ciclo (`monthly`/`yearly`) vai no product ou só na assinatura.
 */
export const CreateProductRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Preço em centavos. TODO(confirmar): nome do campo (`price` vs `amount`). */
  price: CentsSchema,
  /** Idempotência: `externalId = plan.id`. TODO(confirmar): nome do campo. */
  externalId: z.string().min(1),
});

export const ProductDataSchema = z
  .object({
    id: z.string().min(1),
    externalId: z.string().optional(),
  })
  .passthrough();

// --- Customers ----------------------------------------------------------

/**
 * Request de criação de customer.
 * TODO(confirmar): a AbacatePay aninha sob `metadata` ou usa campos planos?
 * (`name`, `email`, `cellphone`, `taxId`). Modelado plano por ora.
 */
export const CreateCustomerRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  /** E.164. TODO(confirmar): nome do campo (`cellphone` vs `phone`). */
  cellphone: z.string().optional(),
  /** CPF/CNPJ (dígitos). TODO(confirmar): nome do campo (`taxId` vs `cpfCnpj`). */
  taxId: z.string().optional(),
  /** Idempotência: `externalId = workspace.id`. TODO(confirmar): suporte real. */
  externalId: z.string().optional(),
});

export const CustomerDataSchema = z
  .object({
    id: z.string().min(1),
    externalId: z.string().optional(),
  })
  .passthrough();

// --- Hosted checkout / billing -----------------------------------------

/**
 * Request de checkout hospedado (CARD+PIX).
 * TODO(confirmar): endpoint (`/billing` vs `/checkouts`), nomes
 * (`frequency`, `methods`, `products`, `returnUrl`, `completionUrl`) e como
 * referenciar o product/customer.
 */
export const CreateCheckoutRequestSchema = z.object({
  /** TODO(confirmar): enum aceito (`ONE_TIME` | `MULTIPLE_PAYMENTS` | ...). */
  frequency: z.string(),
  /** Métodos liberados. TODO(confirmar): valores exatos (`CARD` | `PIX`). */
  methods: z.array(z.string()).min(1),
  /** Itens da cobrança. TODO(confirmar): shape (`externalId`/`quantity`/`price`). */
  products: z
    .array(
      z.object({
        externalId: z.string().min(1),
        quantity: z.number().int().positive(),
        price: CentsSchema.optional(),
      }),
    )
    .min(1),
  returnUrl: z.string().url(),
  completionUrl: z.string().url(),
  /** Metadados de domínio (workspaceId/planId/cycle) para o webhook. */
  metadata: z.record(z.string()).optional(),
  /** Customer associado, quando aplicável. TODO(confirmar): `customerId` vs `customer`. */
  customerId: z.string().optional(),
});

export const CheckoutDataSchema = z
  .object({
    id: z.string().min(1),
    /** TODO(confirmar): nome do campo de redirect (`url` vs `redirectUrl`). */
    url: z.string().url().optional(),
    redirectUrl: z.string().url().optional(),
  })
  .passthrough();

// --- Subscriptions (cartão) --------------------------------------------

/**
 * Request de assinatura nativa por cartão.
 * TODO(confirmar): endpoint e nomes (`productExternalId`, `customerId`,
 * `frequency`, `returnUrl`).
 */
export const CreateSubscriptionRequestSchema = z.object({
  productExternalId: z.string().min(1),
  customerId: z.string().min(1),
  /** Ciclo. TODO(confirmar): valores (`MONTHLY` | `YEARLY`). */
  frequency: z.string(),
  returnUrl: z.string().url(),
  completionUrl: z.string().url(),
  metadata: z.record(z.string()).optional(),
});

export const SubscriptionDataSchema = z
  .object({
    id: z.string().min(1),
    /** TODO(confirmar): vocabulário de status do gateway. */
    status: z.string().optional(),
    url: z.string().url().optional(),
    redirectUrl: z.string().url().optional(),
    /** ISO-8601. TODO(confirmar): nome (`nextBilling` vs `currentPeriodEnd`). */
    nextBilling: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
    currentPeriodStart: z.string().optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    /** TODO(confirmar): nome do campo de valor (`amount` vs `price`). */
    amount: CentsSchema.optional(),
    /** TODO(confirmar): método na resposta (`CARD` | `PIX`). */
    method: z.string().optional(),
  })
  .passthrough();

// --- PIX (transparent charge) ------------------------------------------

/**
 * Request de cobrança PIX avulsa (um ciclo).
 * TODO(confirmar): endpoint (`/pixQrCode/create` vs `/transparent/pix`) e nomes
 * (`amount`, `expiresIn`, `customerId`, `description`).
 */
export const CreatePixChargeRequestSchema = z.object({
  amount: CentsSchema,
  /** Expiração em segundos. TODO(confirmar): nome (`expiresIn` vs `expiresAt`). */
  expiresIn: z.number().int().positive().optional(),
  description: z.string().optional(),
  customerId: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const PixChargeDataSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional(),
    amount: CentsSchema.optional(),
    /** QR em base64. TODO(confirmar): nome (`brCodeBase64` vs `qrCodeImage`). */
    brCodeBase64: z.string().optional(),
    /** Copia-e-cola EMV. TODO(confirmar): nome (`brCode` vs `qrCode`). */
    brCode: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .passthrough();

// --- Webhook payload ----------------------------------------------------

/**
 * Payload do webhook após verificação HMAC.
 * TODO(confirmar): envelope real do evento — nomes de `event`, `id` do evento,
 * e a localização de `metadata`/`subscriptionId`/`amount`. Modelado tolerante.
 */
export const WebhookEventSchema = z
  .object({
    /** Id único do evento — usado para idempotência de domínio (`payment_events`). */
    id: z.string().optional(),
    eventId: z.string().optional(),
    /** Tipo do evento (`checkout.completed`, `subscription.renewed`, ...). */
    event: z.string().optional(),
    type: z.string().optional(),
    /** Carga do evento. TODO(confirmar): aninhamento (`data` vs raiz). */
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
export type CreatePixChargeRequest = z.infer<typeof CreatePixChargeRequestSchema>;
export type PixChargeData = z.infer<typeof PixChargeDataSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
