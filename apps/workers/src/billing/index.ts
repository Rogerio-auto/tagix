/**
 * Worker de billing — recorrência PIX + dunning (F41-S05) — barrel + scheduler handle.
 *
 * Composition surface para o bootstrap: monta o provider de pagamento (factory por env,
 * espelhando `getPaymentProvider()` de `apps/api` SEM importar de lá) + o port de DB real,
 * e expõe `startRecurrenceScheduler` no mesmo padrão dos demais schedulers (lock singleton
 * Redis, tick com reentrância, `unref`, stop limpo). Tudo é injetável → testável sem
 * Postgres/rede (ver `recurrence.test.ts`).
 */
import {
  AbacatePayProvider,
  MockPaymentProvider,
  type IPaymentProvider,
} from '@hm/payments';
import type { Logger } from '@hm/logger';
import type { RedisLike } from '../flows/scheduler';
import {
  createBillingDbPort,
  dunningPolicyFromEnv,
  runRecurrenceTick,
  systemClock,
  DEFAULT_BILLING_TICK_MS,
  type BillingDbPort,
  type Clock,
  type DunningPolicy,
  type RecurrenceDeps,
} from './recurrence';

/**
 * Resolve o provider de pagamento do processo. Espelha a factory de `apps/api`
 * (`services/billing/provider.ts`): `ABACATEPAY_API_KEY` presente → adapter real;
 * ausente → mock determinístico (dev/testes sem rede). A key NUNCA é logada.
 * Definido aqui (não importado de `apps/api`) para manter `@hm/workers` independente.
 */
export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): IPaymentProvider {
  const apiKey = env['ABACATEPAY_API_KEY'];
  return apiKey !== undefined && apiKey !== ''
    ? new AbacatePayProvider({ apiKey })
    : new MockPaymentProvider();
}

/** Lê o intervalo do tick do ambiente (`BILLING_RECURRENCE_TICK_MS`, default 1h). */
export function billingTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['BILLING_RECURRENCE_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_BILLING_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BILLING_TICK_MS;
}

/** Handle do scheduler (parada limpa do interval). */
export interface RecurrenceSchedulerHandle {
  stop(): Promise<void>;
}

/** Deps de boot: Redis (lock) + logger. Provider/db/clock/policy têm default por env. */
export interface RecurrenceSchedulerBootDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  /** Override do provider (default: factory por env). */
  readonly provider?: IPaymentProvider;
  /** Override do port de DB (default: Postgres + RLS). */
  readonly db?: BillingDbPort;
  /** Override do relógio (default: sistema). */
  readonly clock?: Clock;
  /** Override da política de dunning (default: env). */
  readonly policy?: DunningPolicy;
}

export interface RecurrenceSchedulerOptions {
  /** Intervalo entre ticks (default: `BILLING_RECURRENCE_TICK_MS` do ambiente). */
  readonly intervalMs?: number;
}

/**
 * Inicia o scheduler da recorrência PIX: dispara `runRecurrenceTick` a cada `intervalMs`.
 * Lock Redis garante singleton entre instâncias; flag de reentrância evita ticks
 * sobrepostos; erros são logados e não derrubam o scheduler. `unref` para não impedir o
 * encerramento do processo.
 */
export function startRecurrenceScheduler(
  boot: RecurrenceSchedulerBootDeps,
  options: RecurrenceSchedulerOptions = {},
): RecurrenceSchedulerHandle {
  const deps: RecurrenceDeps = {
    redis: boot.redis,
    logger: boot.logger,
    provider: boot.provider ?? resolvePaymentProvider(),
    db: boot.db ?? createBillingDbPort(),
    clock: boot.clock ?? systemClock,
    policy: boot.policy ?? dunningPolicyFromEnv(),
  };
  const intervalMs = options.intervalMs ?? billingTickMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('billing-recurrence: tick anterior ainda em execução — disparo pulado');
      return;
    }
    running = true;
    void runRecurrenceTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('billing-recurrence: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('billing-recurrence scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('billing-recurrence scheduler parado');
      await Promise.resolve();
    },
  };
}

export {
  BILLING_RECURRENCE_LOCK_KEY,
  BILLING_RECURRENCE_LOCK_TTL_MS,
  DEFAULT_BILLING_TICK_MS,
  DEFAULT_DUNNING_POLICY,
  PAYMENT_PROVIDER,
  createBillingDbPort,
  dunningPolicyFromEnv,
  dunningStage,
  pixChargeEventId,
  runRecurrenceTick,
  systemClock,
  type BillingDbPort,
  type Clock,
  type DunningPolicy,
  type DunningStage,
  type PixSubscription,
  type RecurrenceDeps,
  type RecurrenceTickOptions,
  type RecurrenceTickResult,
} from './recurrence';
