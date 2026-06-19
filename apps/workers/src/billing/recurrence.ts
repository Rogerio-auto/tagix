/**
 * Worker de recorrência PIX + dunning (F41-S05, PAYMENTS_ABACATEPAY.md §6).
 *
 * Cartão renova sozinho (assinatura nativa do gateway → webhook `subscription.renewed`
 * de F41-S03). PIX **não tem débito automático**: a cobrança do próximo ciclo precisa
 * ser GERADA ativamente perto do `current_period_end`. Este scheduler in-process varre,
 * a cada tick, as assinaturas `payment_method = 'pix'` e aplica a régua de dunning:
 *
 * ```
 *  current_period_end - LEAD_DAYS      → gera a cobrança PIX do próximo ciclo (1×/ciclo)
 *  current_period_end                  → vencimento; entra em tolerância (grace)
 *  current_period_end + GRACE_DAYS     → ainda sem pagamento → transição `past_due`
 *  current_period_end + GRACE + DUNNING_DAYS → corte: `canceled` (acesso revogado)
 *  current_period_end (cancel_at_period_end=true) → encerra no fim do período
 * ```
 *
 * Quem CONFIRMA o pagamento é sempre o webhook (F41-S03): ao receber o PIX pago, ele
 * avança `current_period_end` e reativa o status. Este worker só CRIA a cobrança e
 * DEGRADA o acesso quando o prazo estoura — nunca marca como pago.
 *
 * **Idempotência por ciclo (DoD):** no máximo UMA cobrança PIX por `(subscription, period)`.
 * A marca durável é uma linha em `payment_events` com `external_event_id` determinístico
 * `pix-charge:{subscriptionId}:{periodEndEpoch}` (insert ON CONFLICT DO NOTHING via
 * `paymentEventsRepo.record`). Sobrevive a restart/flush de Redis — diferente de uma marca
 * volátil. Se a linha já existe, o ciclo já foi cobrado → pula. A transição de status
 * (`active`→`past_due`→`canceled`) é idempotente por natureza (re-aplicar o mesmo status
 * é no-op).
 *
 * **Cross-tenant + RLS (gotcha F40-S01):** o scheduler enumera tenants com `getDb()`
 * (owner, fora de escopo — como o enumerador do follow-up/flow-wakeup), mas TODA leitura/
 * escrita de domínio roda dentro de `withWorkspace(workspaceId, ...)`, que faz
 * `set_config('app.workspace_id', …)` por transação. Isso fecha o bug do GUC vazio que
 * quebrava schedulers cross-tenant: nunca tocamos linhas de tenant sem o GUC setado.
 *
 * **DI / testabilidade:** `provider` (`IPaymentProvider`), `db` (port de consulta/mutação)
 * e `clock` são injetados. Os testes da régua passam ports fake (sem Postgres/rede) e um
 * `now` fixo. O bootstrap injeta o provider real (factory por env) + o port de DB real.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb, paymentEventsRepo, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import type {
  BillingCycle,
  IPaymentProvider,
  PaymentPlanInput,
  PaymentWorkspaceInput,
  ProviderCustomer,
} from '@hm/payments';
import type { Logger } from '@hm/logger';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';

const { subscriptions, plans, workspaces, members, auditLogs } = schema;

/** Provider de pagamento: 'abacatepay' real (segredo de plataforma) ou 'mock'. */
export const PAYMENT_PROVIDER = 'abacatepay' as const;

/** Lock singleton do scheduler de recorrência (só 1 instância tica). */
export const BILLING_RECURRENCE_LOCK_KEY = 'hm:lock:scheduler:billing-recurrence' as const;
export const BILLING_RECURRENCE_LOCK_TTL_MS = 60_000;
/** Tick default (1h): a régua de dunning trabalha em dias; não precisa granularidade fina. */
export const DEFAULT_BILLING_TICK_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Régua de dunning (dias relativos ao `current_period_end`). Configurável por env;
 * defaults conservadores. A cobrança do próximo ciclo é gerada `leadDays` ANTES do
 * vencimento; depois do vencimento há `graceDays` de tolerância (esperando o pagamento
 * chegar pelo webhook); persistindo, vai a `past_due`; e após mais `pastDueDays` o acesso
 * é cortado.
 */
export interface DunningPolicy {
  /** Dias ANTES do vencimento em que a cobrança do próximo ciclo é gerada. */
  readonly leadDays: number;
  /** Dias de tolerância DEPOIS do vencimento antes de marcar `past_due`. */
  readonly graceDays: number;
  /** Dias em `past_due` antes do corte (cancelamento por inadimplência). */
  readonly pastDueDays: number;
  /** Validade da cobrança PIX gerada (segundos). Casa com grace+pastDue. */
  readonly pixExpiresInSeconds: number;
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  leadDays: 3,
  graceDays: 3,
  pastDueDays: 7,
  pixExpiresInSeconds: 13 * DAY_MS / 1000, // lead+grace+pastDue de folga
};

/** Lê a política de dunning do ambiente, com fallback nos defaults. */
export function dunningPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): DunningPolicy {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw.length === 0) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    leadDays: num('BILLING_DUNNING_LEAD_DAYS', DEFAULT_DUNNING_POLICY.leadDays),
    graceDays: num('BILLING_DUNNING_GRACE_DAYS', DEFAULT_DUNNING_POLICY.graceDays),
    pastDueDays: num('BILLING_DUNNING_PASTDUE_DAYS', DEFAULT_DUNNING_POLICY.pastDueDays),
    pixExpiresInSeconds: num(
      'BILLING_PIX_EXPIRES_SECONDS',
      DEFAULT_DUNNING_POLICY.pixExpiresInSeconds,
    ),
  };
}

/**
 * Assinatura PIX candidata a processamento, resolvida no enumerador cross-tenant.
 * Só o necessário para decidir o estágio de dunning e, se preciso, gerar a cobrança.
 */
export interface PixSubscription {
  readonly subscriptionId: string;
  readonly workspaceId: string;
  readonly planId: string;
  readonly status: string;
  readonly billingCycle: BillingCycle;
  /** Fim do ciclo atual (âncora de toda a régua). Null = sem ciclo ativo → ignorada. */
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly externalCustomerId: string | null;
  readonly externalProductId: string | null;
}

/** Estágio da régua de dunning para uma assinatura num instante. */
export type DunningStage =
  | 'none' // longe do vencimento; nada a fazer
  | 'charge' // perto do vencimento → gerar a cobrança do próximo ciclo
  | 'grace' // vencido, dentro da tolerância → aguarda pagamento
  | 'past_due' // tolerância estourada → degradar para past_due
  | 'cutoff' // past_due estourado → cortar acesso (canceled)
  | 'cancel'; // cancel_at_period_end e período encerrado → finalizar

/**
 * Decide o estágio de dunning de uma assinatura num instante. Pura (sem I/O) →
 * testável diretamente. A precedência é: cancelamento agendado > corte > past_due >
 * grace (com geração de cobrança no lead) > none.
 */
export function dunningStage(
  sub: Pick<PixSubscription, 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'status'>,
  now: Date,
  policy: DunningPolicy,
): DunningStage {
  const end = sub.currentPeriodEnd;
  if (end === null) return 'none';

  const endMs = end.getTime();
  const nowMs = now.getTime();
  const graceUntil = endMs + policy.graceDays * DAY_MS;
  const pastDueUntil = graceUntil + policy.pastDueDays * DAY_MS;

  // Cancelamento agendado vence tudo: ao encerrar o período, finaliza (sem nova cobrança).
  if (sub.cancelAtPeriodEnd && nowMs >= endMs) return 'cancel';

  // Já cortado/cancelado/expirado: nada a fazer (idempotente).
  if (sub.status === 'canceled' || sub.status === 'expired') return 'none';

  if (nowMs >= pastDueUntil) return 'cutoff';
  if (nowMs >= graceUntil) return 'past_due';
  if (nowMs >= endMs) return 'grace';

  // Janela de lead: dentro de `leadDays` antes do vencimento → gerar a cobrança.
  if (nowMs >= endMs - policy.leadDays * DAY_MS) return 'charge';

  return 'none';
}

/** Chave determinística de idempotência da cobrança de um ciclo. */
export function pixChargeEventId(subscriptionId: string, periodEnd: Date): string {
  return `pix-charge:${subscriptionId}:${Math.floor(periodEnd.getTime() / 1000)}`;
}

// ─── DB port (DI: real = Postgres + RLS; teste = fake) ──────────────────────────

/** Porta de acesso a dados — injetável para testar a régua sem Postgres. */
export interface BillingDbPort {
  /**
   * Enumera assinaturas PIX que podem precisar de ação nesta varredura (cross-tenant).
   * Filtra por janela ampla (perto do vencimento OU já vencidas OU cancel-at-period-end)
   * para não varrer a tabela inteira. RLS-bypass (owner) — é o passo que ENUMERA tenants.
   */
  listActionablePixSubscriptions(now: Date, policy: DunningPolicy, limit: number): Promise<PixSubscription[]>;
  /** Projeta o plano (preço/nome) para o input do provider — sob RLS do tenant. */
  loadPlan(workspaceId: string, planId: string): Promise<PaymentPlanInput | null>;
  /** Projeta o workspace (nome/billing) para o input do provider — sob RLS do tenant. */
  loadWorkspace(workspaceId: string): Promise<PaymentWorkspaceInput | null>;
  /** True se o ciclo `(subscription, period)` já teve cobrança gerada (idempotência). */
  chargeAlreadyMade(sub: PixSubscription): Promise<boolean>;
  /**
   * Grava a marca durável de "cobrança deste ciclo gerada" (ledger + idempotência).
   * Insert ON CONFLICT DO NOTHING por `(provider, external_event_id)` → re-tentativa
   * concorrente não duplica. Chamado DEPOIS de a cobrança nascer no provider.
   */
  recordCharge(sub: PixSubscription, amountCents: number, externalChargeId: string): Promise<void>;
  /** Transição de status da assinatura + workspace + audit log (sob RLS). Idempotente. */
  transitionStatus(sub: PixSubscription, next: 'past_due' | 'canceled', reason: string, now: Date): Promise<void>;
  /** Finaliza um cancel-at-period-end: status `canceled`, `canceled_at`, audit (sob RLS). */
  finalizeCancellation(sub: PixSubscription, now: Date): Promise<void>;
}

/** Preço do ciclo em centavos a partir do plano. */
function cycleAmountCents(plan: PaymentPlanInput, cycle: BillingCycle): number {
  if (cycle === 'yearly') return plan.priceYearlyCents ?? plan.priceMonthlyCents * 12;
  return plan.priceMonthlyCents;
}

function isBillingCycle(value: string): value is BillingCycle {
  return value === 'monthly' || value === 'yearly';
}

/**
 * Cria o port real (Postgres + RLS). O enumerador roda owner-level (cross-tenant); todo o
 * resto roda dentro de `withWorkspace` (GUC `app.workspace_id` setado por tenant).
 */
export function createBillingDbPort(): BillingDbPort {
  return {
    async listActionablePixSubscriptions(now, policy, limit) {
      // Janela: vencimento dentro de [now - (grace+pastDue), now + leadDays], OU
      // cancel-at-period-end com período já encerrado. Cobre toda a régua sem full scan.
      const windowStart = new Date(now.getTime() - (policy.graceDays + policy.pastDueDays) * DAY_MS);
      const windowEnd = new Date(now.getTime() + policy.leadDays * DAY_MS);
      const rows = await getDb().execute<{
        subscription_id: string;
        workspace_id: string;
        plan_id: string;
        status: string;
        billing_cycle: string;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
        external_customer_id: string | null;
        external_product_id: string | null;
      } & Record<string, unknown>>(sql`
        select
          s.id                    as subscription_id,
          s.workspace_id          as workspace_id,
          s.plan_id               as plan_id,
          s.status                as status,
          s.billing_cycle         as billing_cycle,
          s.current_period_end    as current_period_end,
          s.cancel_at_period_end  as cancel_at_period_end,
          s.external_customer_id  as external_customer_id,
          s.external_product_id   as external_product_id
        from subscriptions s
        where s.payment_method = 'pix'
          and s.status not in ('canceled', 'expired')
          and s.current_period_end is not null
          and (
            s.current_period_end between ${windowStart} and ${windowEnd}
            or s.cancel_at_period_end = true
          )
        order by s.current_period_end asc
        limit ${limit}
      `);
      const out: PixSubscription[] = [];
      for (const r of rows) {
        const cycle = isBillingCycle(r.billing_cycle) ? r.billing_cycle : 'monthly';
        out.push({
          subscriptionId: r.subscription_id,
          workspaceId: r.workspace_id,
          planId: r.plan_id,
          status: r.status,
          billingCycle: cycle,
          currentPeriodEnd: r.current_period_end !== null ? new Date(r.current_period_end) : null,
          cancelAtPeriodEnd: r.cancel_at_period_end === true,
          externalCustomerId: r.external_customer_id,
          externalProductId: r.external_product_id,
        });
      }
      return out;
    },

    async loadPlan(workspaceId, planId) {
      return withWorkspace(workspaceId, async (tx: DbTx) => {
        const [row] = await tx
          .select({
            id: plans.id,
            name: plans.name,
            description: plans.description,
            priceMonthlyCents: plans.priceMonthlyCents,
            priceYearlyCents: plans.priceYearlyCents,
            paymentProviderProductId: plans.paymentProviderProductId,
          })
          .from(plans)
          .where(eq(plans.id, planId))
          .limit(1);
        if (!row) return null;
        const out: PaymentPlanInput = {
          id: row.id,
          name: row.name,
          priceMonthlyCents: row.priceMonthlyCents,
          priceYearlyCents: row.priceYearlyCents,
          ...(row.description !== null ? { description: row.description } : {}),
          ...(row.paymentProviderProductId !== null
            ? { externalProductId: row.paymentProviderProductId }
            : {}),
        };
        return out;
      });
    },

    async loadWorkspace(workspaceId) {
      return withWorkspace(workspaceId, async (tx: DbTx) => {
        const [ws] = await tx
          .select({ id: workspaces.id, name: workspaces.name })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (!ws) return null;
        // E-mail de cobrança: o OWNER do workspace (billing contact). Best-effort.
        const [owner] = await tx
          .select({ email: members.email, phone: members.phone })
          .from(members)
          .where(and(eq(members.workspaceId, workspaceId), eq(members.role, 'OWNER')))
          .limit(1);
        const out: PaymentWorkspaceInput = {
          id: ws.id,
          name: ws.name,
          billingEmail: owner?.email ?? `billing+${ws.id}@leadium.local`,
          ...(owner?.phone ? { billingPhone: owner.phone } : {}),
        };
        return out;
      });
    },

    async chargeAlreadyMade(sub) {
      if (sub.currentPeriodEnd === null) return true;
      const eventId = pixChargeEventId(sub.subscriptionId, sub.currentPeriodEnd);
      return paymentEventsRepo.exists(PAYMENT_PROVIDER, eventId);
    },

    async recordCharge(sub, amountCents, externalChargeId) {
      if (sub.currentPeriodEnd === null) return;
      const eventId = pixChargeEventId(sub.subscriptionId, sub.currentPeriodEnd);
      // `record` é ON CONFLICT DO NOTHING por (provider, external_event_id) → idempotente.
      await paymentEventsRepo.record({
        provider: PAYMENT_PROVIDER,
        externalEventId: eventId,
        eventType: 'pix.charge.created',
        workspaceId: sub.workspaceId,
        subscriptionExternalId: externalChargeId,
        amountCents,
        status: 'pending',
        rawPayload: {
          source: 'billing-recurrence-worker',
          subscriptionId: sub.subscriptionId,
          periodEnd: sub.currentPeriodEnd.toISOString(),
          externalChargeId,
        },
      });
    },

    async transitionStatus(sub, next, reason, now) {
      await withWorkspace(sub.workspaceId, async (tx: DbTx) => {
        await tx
          .update(subscriptions)
          .set({ status: next, updatedAt: now })
          .where(eq(subscriptions.id, sub.subscriptionId));
        await tx
          .update(workspaces)
          .set({ subscriptionStatus: next, updatedAt: now })
          .where(eq(workspaces.id, sub.workspaceId));
        await tx.insert(auditLogs).values({
          workspaceId: sub.workspaceId,
          actorType: 'system',
          action: `billing.${next}`,
          resourceType: 'subscription',
          resourceId: sub.subscriptionId,
          metadata: {
            reason,
            from: sub.status,
            to: next,
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          },
        });
      });
    },

    async finalizeCancellation(sub, now) {
      await withWorkspace(sub.workspaceId, async (tx: DbTx) => {
        await tx
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: now, updatedAt: now })
          .where(eq(subscriptions.id, sub.subscriptionId));
        await tx
          .update(workspaces)
          .set({ subscriptionStatus: 'canceled', updatedAt: now })
          .where(eq(workspaces.id, sub.workspaceId));
        await tx.insert(auditLogs).values({
          workspaceId: sub.workspaceId,
          actorType: 'system',
          action: 'billing.canceled',
          resourceType: 'subscription',
          resourceId: sub.subscriptionId,
          metadata: {
            reason: 'cancel_at_period_end',
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          },
        });
      });
    },
  };
}

// ─── Tick ───────────────────────────────────────────────────────────────────────

/** Relógio injetável (testes congelam `now`). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Dependências do tick (injetadas pelo bootstrap; mockáveis no teste). */
export interface RecurrenceDeps {
  readonly redis: RedisLike;
  readonly provider: IPaymentProvider;
  readonly db: BillingDbPort;
  readonly logger: Logger;
  /** Default: relógio do sistema. */
  readonly clock?: Clock;
  /** Default: política do ambiente. */
  readonly policy?: DunningPolicy;
}

export interface RecurrenceTickOptions {
  readonly now?: Date;
  readonly limit?: number;
}

export interface RecurrenceTickResult {
  readonly ran: boolean;
  /** Assinaturas PIX inspecionadas neste tick. */
  readonly inspected: number;
  /** Cobranças PIX geradas (1×/ciclo — idempotente). */
  readonly charged: number;
  /** Já cobradas neste ciclo (puladas por idempotência). */
  readonly skippedAlreadyCharged: number;
  /** Transicionadas para `past_due`. */
  readonly pastDue: number;
  /** Cortadas (canceladas por inadimplência). */
  readonly cutoff: number;
  /** Finalizadas por cancel-at-period-end. */
  readonly canceled: number;
}

const EMPTY_RESULT: RecurrenceTickResult = {
  ran: false,
  inspected: 0,
  charged: 0,
  skippedAlreadyCharged: 0,
  pastDue: 0,
  cutoff: 0,
  canceled: 0,
};

/**
 * Gera a cobrança PIX do próximo ciclo de uma assinatura — exatamente UMA vez por
 * `(subscription, period)`. A marca durável (`payment_events`) é reivindicada ANTES de
 * chamar o provider, mas só GRAVADA depois que a cobrança nasce, para não "queimar" o
 * ciclo se a criação falhar. Concorrência: se duas instâncias correrem (improvável — há
 * lock singleton), o `claimChargeForPeriod` é o ponto de serialização.
 *
 * Retorna `'charged'` se gerou, `'skipped'` se o ciclo já fora cobrado, `'no-customer'`
 * se faltam dados para cobrar (logado; o próximo tick tenta de novo).
 */
async function generateCharge(
  deps: RecurrenceDeps,
  sub: PixSubscription,
): Promise<'charged' | 'skipped' | 'no-customer'> {
  if (sub.currentPeriodEnd === null) return 'skipped';

  // Idempotência por ciclo: se a marca durável já existe, o ciclo já foi cobrado → pula
  // ANTES de tocar o provider (nunca cobra 2× o mesmo (subscription, period)).
  if (await deps.db.chargeAlreadyMade(sub)) return 'skipped';

  const plan = await deps.db.loadPlan(sub.workspaceId, sub.planId);
  const workspace = await deps.db.loadWorkspace(sub.workspaceId);
  if (plan === null || workspace === null || sub.externalCustomerId === null) {
    deps.logger.warn('billing-recurrence: dados insuficientes para gerar PIX', {
      subscriptionId: sub.subscriptionId,
      hasPlan: plan !== null,
      hasWorkspace: workspace !== null,
      hasCustomer: sub.externalCustomerId !== null,
    });
    return 'no-customer';
  }

  const customer: ProviderCustomer = {
    externalCustomerId: sub.externalCustomerId,
    workspaceId: sub.workspaceId,
  };
  const amountCents = cycleAmountCents(plan, sub.billingCycle);
  const policy = deps.policy ?? dunningPolicyFromEnv();

  const charge = await deps.provider.createPixCharge({
    plan,
    workspace,
    cycle: sub.billingCycle,
    customer,
    amountCents,
    expiresInSeconds: policy.pixExpiresInSeconds,
    metadata: {
      workspaceId: sub.workspaceId,
      planId: sub.planId,
      cycle: sub.billingCycle,
      subscriptionId: sub.subscriptionId,
      periodEnd: sub.currentPeriodEnd.toISOString(),
    },
  });

  // Marca durável APÓS a cobrança nascer: o ciclo passa a estar coberto (idempotente).
  await deps.db.recordCharge(sub, charge.amountCents, charge.externalId);

  deps.logger.info('billing-recurrence: cobrança PIX gerada', {
    subscriptionId: sub.subscriptionId,
    workspaceId: sub.workspaceId,
    externalChargeId: charge.externalId,
    amountCents: charge.amountCents,
  });
  return 'charged';
}

/**
 * Executa um tick da recorrência PIX + dunning. Adquire o lock singleton; se outra
 * instância o detém, retorna `ran:false` sem tocar no DB. Senão, enumera as assinaturas
 * PIX acionáveis (cross-tenant) e aplica o estágio de dunning de cada uma sob RLS.
 */
export async function runRecurrenceTick(
  deps: RecurrenceDeps,
  options: RecurrenceTickOptions = {},
): Promise<RecurrenceTickResult> {
  const now = options.now ?? deps.clock?.now() ?? new Date();
  const policy = deps.policy ?? dunningPolicyFromEnv();
  const limit = options.limit ?? 500;

  const release = await acquireSchedulerLock(
    deps.redis,
    BILLING_RECURRENCE_LOCK_KEY,
    BILLING_RECURRENCE_LOCK_TTL_MS,
  );
  if (release === null) {
    deps.logger.debug('billing-recurrence: tick pulado — lock detido por outra instância');
    return EMPTY_RESULT;
  }

  let charged = 0;
  let skippedAlreadyCharged = 0;
  let pastDue = 0;
  let cutoff = 0;
  let canceled = 0;
  let inspected = 0;

  try {
    const subs = await deps.db.listActionablePixSubscriptions(now, policy, limit);
    for (const sub of subs) {
      inspected += 1;
      try {
        const stage = dunningStage(sub, now, policy);
        switch (stage) {
          case 'charge': {
            const r = await generateCharge(deps, sub);
            if (r === 'charged') charged += 1;
            else if (r === 'skipped') skippedAlreadyCharged += 1;
            break;
          }
          case 'grace':
            // Tolerância: aguarda o pagamento (chega pelo webhook S03). Nada a degradar.
            break;
          case 'past_due':
            if (sub.status !== 'past_due') {
              await deps.db.transitionStatus(sub, 'past_due', 'pix_overdue_grace_expired', now);
              pastDue += 1;
            }
            break;
          case 'cutoff':
            await deps.db.transitionStatus(sub, 'canceled', 'pix_overdue_cutoff', now);
            cutoff += 1;
            break;
          case 'cancel':
            await deps.db.finalizeCancellation(sub, now);
            canceled += 1;
            break;
          case 'none':
            break;
        }
      } catch (err: unknown) {
        // Um tenant problemático não derruba os demais; o próximo tick recomputa.
        deps.logger.error('billing-recurrence: falha ao processar assinatura', {
          subscriptionId: sub.subscriptionId,
          workspaceId: sub.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result: RecurrenceTickResult = {
      ran: true,
      inspected,
      charged,
      skippedAlreadyCharged,
      pastDue,
      cutoff,
      canceled,
    };
    if (inspected > 0) {
      deps.logger.info('billing-recurrence: tick concluído', {
        inspected,
        charged,
        pastDue,
        cutoff,
        canceled,
      });
    }
    return result;
  } finally {
    await release();
  }
}
