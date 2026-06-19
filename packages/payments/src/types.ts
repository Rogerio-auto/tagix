/**
 * Tipos canônicos da fronteira de pagamento (PAYMENTS_ABACATEPAY.md §1/§3).
 *
 * `IPaymentProvider` é a fronteira: o resto do sistema (webhook, checkout,
 * worker, fluxo assistido) nunca conhece detalhes da AbacatePay. Tudo é
 * **provider-agnóstico** e **sem dependência de DB/Express** — o pacote recebe
 * apenas os dados mínimos de domínio que precisa.
 *
 * Convenção monetária: **centavos, BRL** (inteiros). Nunca floats.
 */

/** Moeda suportada. Merchant único = Leadium (Brasil) → BRL. */
export type Currency = 'BRL';

/** Ciclo de cobrança de uma assinatura. */
export type BillingCycle = 'monthly' | 'yearly';

/** Método de pagamento escolhido pelo tenant. */
export type PaymentMethod = 'card' | 'pix';

/** Status normalizado de uma assinatura no provider (independe do nome do gateway). */
export type ProviderSubscriptionStatus =
  | 'active'
  | 'pending'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'unknown';

/**
 * Plano de domínio — subset mínimo necessário para sincronizar com o gateway.
 * NÃO é a row de `plans`; o caller (F41-S03/S04) projeta a row para isto,
 * mantendo o pacote livre de `@hm/db`.
 */
export interface PaymentPlanInput {
  /** Id interno do plano (Leadium). Vira `externalId` no product do gateway. */
  readonly id: string;
  /** Nome exibível do plano. */
  readonly name: string;
  /** Preço mensal em centavos (BRL). */
  readonly priceMonthlyCents: number;
  /** Preço anual em centavos (BRL), se houver ciclo anual. */
  readonly priceYearlyCents?: number;
  /** Descrição opcional do plano. */
  readonly description?: string;
  /**
   * Ciclo do product no gateway. A AbacatePay exige `cycle` no product para que
   * ele possa lastrear uma **assinatura** (`/subscriptions/create`). Ausente
   * (checkout avulso/PIX) → product sem ciclo. O provider mapeia
   * monthly→MONTHLY, yearly→ANNUALLY.
   */
  readonly cycle?: BillingCycle;
  /** Id de product já existente no gateway, se o caller já o conhece. */
  readonly externalProductId?: string;
}

/**
 * Workspace de domínio — subset mínimo para criar/garantir o customer.
 * Não é a row de `workspaces`.
 */
export interface PaymentWorkspaceInput {
  /** Id interno do workspace (Leadium). Vira `externalId`/metadata no customer. */
  readonly id: string;
  /** Nome do workspace/empresa (usado como nome do customer). */
  readonly name: string;
  /** E-mail de cobrança (obrigatório pela maioria dos gateways). */
  readonly billingEmail: string;
  /** Telefone E.164 do responsável, se disponível. */
  readonly billingPhone?: string;
  /** CPF/CNPJ (somente dígitos), se disponível — exigido por alguns fluxos PIX. */
  readonly taxId?: string;
  /** Id de customer já existente no gateway, se o caller já o conhece. */
  readonly externalCustomerId?: string;
}

/** Product garantido no gateway (idempotente por `externalId = plan.id`). */
export interface ProviderProduct {
  readonly externalProductId: string;
  readonly planId: string;
}

/** Customer garantido no gateway (idempotente por `externalId = workspace.id`). */
export interface ProviderCustomer {
  readonly externalCustomerId: string;
  readonly workspaceId: string;
}

/** Input do checkout hospedado (preço/plano reconferidos pelo caller server-side). */
export interface CreateHostedCheckoutInput {
  readonly plan: PaymentPlanInput;
  readonly workspace: PaymentWorkspaceInput;
  readonly cycle: BillingCycle;
  /** Métodos liberados no checkout hospedado. Default do caller: ['card','pix']. */
  readonly methods: readonly PaymentMethod[];
  /** Para onde o gateway redireciona após retorno (UX). */
  readonly returnUrl: string;
  /** Para onde o gateway redireciona após conclusão (UX). */
  readonly completionUrl: string;
}

/** Resultado de um checkout hospedado: link para redirecionar o cliente. */
export interface HostedCheckoutResult {
  /** Id do checkout/billing no gateway. */
  readonly externalId: string;
  /** URL de redirecionamento (hosted page). */
  readonly redirectUrl: string;
}

/** Input de assinatura nativa por cartão (recorrência gerida pelo gateway). */
export interface CreateSubscriptionInput {
  readonly plan: PaymentPlanInput;
  readonly workspace: PaymentWorkspaceInput;
  readonly cycle: BillingCycle;
  /** Customer já garantido (preferível) — evita round-trip extra. */
  readonly customer: ProviderCustomer;
  /** Product já garantido (preferível). */
  readonly product: ProviderProduct;
  readonly returnUrl: string;
  readonly completionUrl: string;
}

/** Input de uma cobrança PIX avulsa (um ciclo). Worker gera por ciclo (§6). */
export interface CreatePixChargeInput {
  readonly plan: PaymentPlanInput;
  readonly workspace: PaymentWorkspaceInput;
  readonly cycle: BillingCycle;
  readonly customer: ProviderCustomer;
  /** Valor em centavos (BRL) — reconferido pelo caller, não vem do cliente. */
  readonly amountCents: number;
  /** Expiração da cobrança PIX, em segundos a partir de agora (régua de dunning). */
  readonly expiresInSeconds?: number;
  /** Metadados de domínio (workspaceId/planId/cycle) carregados para o webhook. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Resultado de uma cobrança PIX: QR + copia-e-cola + vencimento. */
export interface PixChargeResult {
  /** Id da cobrança no gateway. */
  readonly externalId: string;
  readonly status: ProviderSubscriptionStatus;
  readonly amountCents: number;
  /** QR Code em base64 (imagem), se o gateway devolver. */
  readonly brCodeBase64?: string;
  /** Payload copia-e-cola (EMV) do PIX. */
  readonly brCode?: string;
  /** Vencimento ISO-8601, se houver. */
  readonly expiresAt?: string;
}

/** Resultado de criar uma assinatura por cartão. */
export interface SubscriptionResult {
  readonly externalSubscriptionId: string;
  readonly status: ProviderSubscriptionStatus;
  /** URL para o cliente concluir o cadastro do cartão, quando aplicável. */
  readonly redirectUrl?: string;
  readonly currentPeriodEnd?: string;
}

/** Snapshot do estado de uma assinatura no gateway. */
export interface SubscriptionSnapshot {
  readonly externalSubscriptionId: string;
  readonly status: ProviderSubscriptionStatus;
  readonly method?: PaymentMethod;
  readonly currentPeriodStart?: string;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly amountCents?: number;
}

/**
 * Fronteira do gateway de pagamento. Implementada por `AbacatePayProvider`
 * (real) e `MockPaymentProvider` (dev/testes). Sem efeitos colaterais de DB:
 * o caller persiste o que precisar.
 */
export interface IPaymentProvider {
  /** Identificador do provider (`abacatepay` | `mock`). */
  readonly id: string;

  /** Garante (cria-ou-recupera) o product correspondente a um plano. */
  ensureProduct(plan: PaymentPlanInput): Promise<ProviderProduct>;

  /** Garante (cria-ou-recupera) o customer correspondente a um workspace. */
  ensureCustomer(workspace: PaymentWorkspaceInput): Promise<ProviderCustomer>;

  /** Cria um checkout hospedado (CARD+PIX) e retorna o link de redirecionamento. */
  createHostedCheckout(input: CreateHostedCheckoutInput): Promise<HostedCheckoutResult>;

  /** Cria uma assinatura nativa por cartão (recorrência no gateway). */
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult>;

  /** Cria uma cobrança PIX para um ciclo (sem débito automático). */
  createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult>;

  /** Cancela uma assinatura no gateway. */
  cancelSubscription(externalSubscriptionId: string): Promise<void>;

  /** Lê o estado atual de uma assinatura no gateway. */
  getSubscription(externalSubscriptionId: string): Promise<SubscriptionSnapshot>;
}
