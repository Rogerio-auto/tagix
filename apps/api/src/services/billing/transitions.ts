/**
 * Transições de assinatura dirigidas pelo webhook AbacatePay (F41-S03).
 *
 * **Fonte da verdade do pagamento.** Cada evento do gateway, após verificação
 * HMAC + dedup de borda, é mapeado aqui para uma transição coerente de:
 *   - `workspaces.{subscription_status, plan_id, trial_ends_at}` (fonte da verdade do status)
 *   - linha em `subscriptions` (espelho coerente: status/period/cancel/canceled)
 *   - `audit_logs` (before/after — trilha de auditoria)
 *   - `payment_events.processed_at` (idempotência de domínio carimbada)
 *
 * Mapa evento → transição (PAYMENTS_ABACATEPAY.md §4):
 *
 *   checkout.completed / subscription.completed → `active` (+ plano/entitlements)
 *   subscription.renewed                        → mantém `active`, avança current_period_end
 *   subscription.cancelled                      → `canceled`
 *   *.refunded / *.disputed / *.lost            → `past_due` (revisão, auditado)
 *
 * REGRA DURA: nunca confiamos em preço/plano vindos no payload. O plano é
 * resolvido **server-side** a partir do nosso DB — pela assinatura existente
 * (`subscriptions.external_subscription_id`) ou pelo `metadata.planId/workspaceId`
 * que NÓS gravamos ao criar o checkout (S04). Validamos que o plano existe e está
 * ativo antes de aplicar entitlements.
 *
 * O serviço é desenhado com uma fronteira de **portas** (`TransitionPorts`) para
 * ser testável sem Postgres — o webhook injeta as portas reais (Drizzle/repo); os
 * testes injetam fakes determinísticos.
 */

import type { WebhookEvent } from '@hm/payments';

/** Status de assinatura aceitos pelo schema (`workspaces`/`subscriptions`). */
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'expired';

/** Categorias de transição derivadas do tipo de evento do gateway. */
export type TransitionKind = 'activate' | 'renew' | 'cancel' | 'past_due' | 'ignore';

/** Visão mínima de uma assinatura para a decisão de transição. */
export interface SubscriptionSnapshot {
  readonly workspaceId: string;
  readonly planId: string | null;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | null;
  readonly paymentMethod: 'card' | 'pix' | null;
  /** Ciclo de cobrança ('monthly'|'yearly'); usado para avançar o vencimento. */
  readonly billingCycle?: string | null;
}

/** Visão mínima do workspace para before/after de auditoria. */
export interface WorkspaceSnapshot {
  readonly id: string;
  readonly planId: string | null;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
}

/** Patch aplicado a `workspaces` + linha de `subscriptions` numa transição. */
export interface TransitionPatch {
  readonly status: SubscriptionStatus;
  readonly planId: string | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly canceledAt: Date | null;
}

/**
 * Portas de persistência. Implementadas com Drizzle no webhook; mockadas nos
 * testes. Mantém o serviço puro em lógica de domínio.
 */
export interface TransitionPorts {
  /** Resolve a assinatura a partir do id externo do gateway (preferencial). */
  findSubscriptionByExternalId(externalId: string): Promise<SubscriptionSnapshot | null>;
  /** Resolve a assinatura pelo workspace (fallback via metadata). */
  findSubscriptionByWorkspace(workspaceId: string): Promise<SubscriptionSnapshot | null>;
  /** Snapshot do workspace (before de auditoria). */
  getWorkspace(workspaceId: string): Promise<WorkspaceSnapshot | null>;
  /** True se o plano existe E está ativo (resolução server-side). */
  isPlanActive(planId: string): Promise<boolean>;
  /** Aplica o patch em `workspaces` + `subscriptions` (coerente). */
  applyTransition(input: {
    workspaceId: string;
    patch: TransitionPatch;
    externalSubscriptionId: string | null;
  }): Promise<void>;
  /** Grava a trilha de auditoria (before/after). Best-effort. */
  recordAudit(input: {
    workspaceId: string;
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

/** Resultado da aplicação de uma transição (para o webhook decidir o ack). */
export type TransitionOutcome =
  | { readonly kind: 'applied'; readonly status: SubscriptionStatus; readonly workspaceId: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'unresolved'; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Lê o tipo do evento. A v2 usa o campo `event`; `type` é aceito de forma
 * defensiva (via index signature do envelope `passthrough`).
 */
export function eventTypeOf(event: WebhookEvent): string {
  const fallbackType = (event as Record<string, unknown>)['type'];
  return (asString(event.event) ?? asString(fallbackType) ?? '').toLowerCase();
}

/**
 * Classifica o tipo de evento do gateway numa categoria de transição.
 *
 * Tolerante a sufixos/prefixos de domínio (`billing.subscription.renewed`,
 * `subscription.renewed`, `pix.refunded`, ...). Refund/dispute/chargeback/lost →
 * `past_due` (revisão manual). Tipos desconhecidos → `ignore` (ack sem efeito).
 */
export function classifyEvent(eventType: string): TransitionKind {
  const t = eventType.toLowerCase();
  if (t.length === 0) return 'ignore';

  // Estorno / disputa / chargeback / perda → revisão (past_due). Avaliado antes
  // de "completed" para que um evento como "*.refunded" nunca caia em activate.
  if (
    t.includes('refund') ||
    t.includes('dispute') ||
    t.includes('chargeback') ||
    t.endsWith('.lost') ||
    t === 'lost'
  ) {
    return 'past_due';
  }
  if (t.includes('cancel')) return 'cancel';
  if (t.includes('renew')) return 'renew';
  if (
    t === 'checkout.completed' ||
    t === 'subscription.completed' ||
    t.endsWith('checkout.completed') ||
    t.endsWith('subscription.completed') ||
    (t.includes('subscription') && t.includes('active')) ||
    (t.includes('payment') && t.includes('completed'))
  ) {
    return 'activate';
  }
  return 'ignore';
}

/** Extrai o `data` do evento (tolerante a aninhamento). */
function eventData(event: WebhookEvent): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

/**
 * Resolve o id externo da assinatura a partir do payload (campos tolerados).
 * Usado SÓ para correlacionar com a NOSSA linha — nunca como fonte de plano/preço.
 *
 * No checkout/PIX o `data.id` é a cobrança (`bill_…`/PIX id); em eventos de
 * assinatura há também o id REAL da assinatura (`subs_…`) — ver
 * `resolveSubscriptionId`. Ambos são correlacionadores (a NOSSA linha pode estar
 * gravada com qualquer um deles dependendo do estágio), nunca fonte de plano.
 */
export function resolveExternalSubscriptionId(event: WebhookEvent): string | null {
  const [first] = correlationCandidates(event);
  return first ?? null;
}

/**
 * Todos os candidatos de correlação presentes no payload, em ordem de
 * preferência e sem duplicatas. A NOSSA linha pode estar gravada com o `subs_…`
 * (após o primeiro activate) ou com o id da cobrança (`bill_…`/`data.id`),
 * então tentamos todos antes do fallback por workspace.
 */
export function correlationCandidates(event: WebhookEvent): string[] {
  const data = eventData(event);
  const raw = [
    asString(data['subscriptionId']),
    asString(data['subscription_id']),
    asString(data['externalSubscriptionId']),
    asString(data['id']),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Resolve o id REAL da assinatura AbacatePay (`subs_…`) — o id necessário para
 * `/subscriptions/cancel`. Os eventos `subscription.completed`/`renewed` trazem
 * esse id; o checkout grava o `bill_…` como external id, então precisamos
 * capturar o `subs_…` aqui para que o cancelamento de cartão funcione depois.
 *
 * Tolerante a nomes (`subscriptionId`/`subscription_id`/`subscription.id`/`id`
 * com prefixo `subs_`). Só retorna quando o valor tem o prefixo `subs_`.
 */
export function resolveSubscriptionId(event: WebhookEvent): string | null {
  const data = eventData(event);
  const nested = isRecord(data['subscription']) ? data['subscription'] : undefined;
  const candidates: Array<string | undefined> = [
    asString(data['subscriptionId']),
    asString(data['subscription_id']),
    nested ? asString(nested['id']) : undefined,
    asString(data['id']),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.startsWith('subs_')) return candidate;
  }
  return null;
}

/** Extrai o `workspaceId` que NÓS gravamos em metadata ao criar o checkout. */
export function resolveWorkspaceIdFromMetadata(event: WebhookEvent): string | null {
  const data = eventData(event);
  const metadata = isRecord(data['metadata']) ? data['metadata'] : {};
  return asString(metadata['workspaceId']) ?? asString(data['workspaceId']) ?? null;
}

/**
 * Avança o vencimento a partir de uma base, honrando o ciclo da assinatura
 * (mensal: +1 mês; anual: +1 ano). Mantém progresso monotônico (nunca recua).
 * TODO(confirmar): preferir o `current_period_end` vindo do `getSubscription`
 * do provider quando o adapter expuser — esta derivação é o fallback server-side.
 */
function advancePeriodEnd(from: Date | null, cycle: string | null): Date {
  const base = from && from.getTime() > Date.now() ? from : new Date();
  const next = new Date(base);
  if (cycle === 'yearly') {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

/**
 * Aplica a transição de domínio correspondente ao evento de webhook.
 *
 * Pré-condição: o evento já foi HMAC-verificado e dedup'ado na borda; este
 * serviço é idempotente porque o caller só o invoca quando o `payment_events`
 * ainda não foi processado (`processed_at IS NULL`).
 */
export async function applyTransition(
  event: WebhookEvent,
  ports: TransitionPorts,
): Promise<TransitionOutcome> {
  const eventType = eventTypeOf(event);
  const kind = classifyEvent(eventType);
  if (kind === 'ignore') {
    return { kind: 'ignored', reason: `unmapped_event:${eventType || 'unknown'}` };
  }

  // Resolução server-side da assinatura: por id externo (preferencial) ou por
  // workspace via metadata (fallback). NUNCA criamos assinatura do nada aqui —
  // a linha é criada no checkout (S04). Sem assinatura → não resolvido.
  const externalId = resolveExternalSubscriptionId(event);
  const metadataWorkspaceId = resolveWorkspaceIdFromMetadata(event);
  // Id REAL da assinatura (`subs_…`), quando o evento o trouxer — necessário para
  // o cancelamento de cartão. Persistido em activate/renew (ver abaixo).
  const subscriptionId = resolveSubscriptionId(event);

  // Correlação tolerante: tenta todos os candidatos do payload (a NOSSA linha
  // pode estar gravada com o `subs_…` OU com o `bill_…`/`data.id`) antes do
  // fallback por workspace via metadata.
  let sub: SubscriptionSnapshot | null = null;
  for (const key of correlationCandidates(event)) {
    sub = await ports.findSubscriptionByExternalId(key);
    if (sub) break;
  }
  if (!sub && metadataWorkspaceId) {
    sub = await ports.findSubscriptionByWorkspace(metadataWorkspaceId);
  }
  if (!sub) {
    return {
      kind: 'unresolved',
      reason: externalId || metadataWorkspaceId ? 'subscription_not_found' : 'no_correlation_keys',
    };
  }

  const ws = await ports.getWorkspace(sub.workspaceId);
  if (!ws) {
    return { kind: 'unresolved', reason: 'workspace_not_found' };
  }

  // Plano resolvido server-side: o plano da NOSSA assinatura. Para activate,
  // validamos que está ativo (entitlements). Em transições sem plano, o status
  // ainda transiciona, mas não aplicamos plano.
  const resolvedPlanId = sub.planId;

  let patch: TransitionPatch;
  let action: string;

  switch (kind) {
    case 'activate': {
      if (resolvedPlanId === null) {
        return { kind: 'unresolved', reason: 'no_plan_on_subscription' };
      }
      const planOk = await ports.isPlanActive(resolvedPlanId);
      if (!planOk) {
        return { kind: 'unresolved', reason: 'plan_inactive_or_missing' };
      }
      patch = {
        status: 'active',
        planId: resolvedPlanId,
        trialEndsAt: null, // ativou → encerra trial
        currentPeriodEnd: advancePeriodEnd(sub.currentPeriodEnd, sub.billingCycle ?? null),
        canceledAt: null,
      };
      action = 'subscription.activated';
      break;
    }
    case 'renew': {
      // Mantém active e avança o vencimento. Se a assinatura não estava active,
      // a renovação confirma o pagamento → também ativa.
      patch = {
        status: 'active',
        planId: resolvedPlanId,
        trialEndsAt: null,
        currentPeriodEnd: advancePeriodEnd(sub.currentPeriodEnd, sub.billingCycle ?? null),
        canceledAt: null,
      };
      action = 'subscription.renewed';
      break;
    }
    case 'cancel': {
      patch = {
        status: 'canceled',
        planId: resolvedPlanId,
        trialEndsAt: ws.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        canceledAt: new Date(),
      };
      action = 'subscription.canceled';
      break;
    }
    case 'past_due': {
      // Estorno/disputa/perda → revisão. Não revoga acesso imediatamente; marca
      // past_due e audita para tratamento (dunning/corte fica em outro slot).
      patch = {
        status: 'past_due',
        planId: resolvedPlanId,
        trialEndsAt: ws.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        canceledAt: null,
      };
      action = 'subscription.payment_disputed';
      break;
    }
    default: {
      // Exaustividade: 'ignore' já tratado acima.
      return { kind: 'ignored', reason: `unhandled_kind:${String(kind)}` };
    }
  }

  // Em activate/renew capturamos o `subs_…` real para gravar em
  // `external_subscription_id` (o checkout só conhecia o `bill_…`); nas demais
  // transições não sobrescrevemos (null = não tocar).
  const subscriptionIdToPersist =
    (kind === 'activate' || kind === 'renew') ? subscriptionId : null;

  await ports.applyTransition({
    workspaceId: ws.id,
    patch,
    externalSubscriptionId: subscriptionIdToPersist,
  });

  await ports.recordAudit({
    workspaceId: ws.id,
    action,
    before: {
      status: ws.status,
      planId: ws.planId,
      trialEndsAt: ws.trialEndsAt ? ws.trialEndsAt.toISOString() : null,
    },
    after: {
      status: patch.status,
      planId: patch.planId,
      trialEndsAt: patch.trialEndsAt ? patch.trialEndsAt.toISOString() : null,
      currentPeriodEnd: patch.currentPeriodEnd ? patch.currentPeriodEnd.toISOString() : null,
    },
    metadata: {
      provider: 'abacatepay',
      eventType,
      externalSubscriptionId: externalId,
      subscriptionId: subscriptionId,
    },
  });

  return { kind: 'applied', status: patch.status, workspaceId: ws.id };
}
