/**
 * Worker de webhooks outbound (F9-S05) — barrel + scheduler.
 *
 * Duas superfícies:
 *  - `fanoutEvent(evt)`: chamado pelas seams de evento de domínio (no bootstrap, ao
 *    consumir `hm.events`) → cria deliveries pendentes para os assinantes.
 *  - `startWebhookDispatcher({ redis, logger })`: cron tick (singleton via lock Redis)
 *    que drena `outbound_webhook_deliveries` vencidas e despacha com HMAC + retry.
 *
 * O dispatcher é singleton entre instâncias (lock Redis dedicado) para não duplicar
 * POSTs ao cliente — embora o `FOR UPDATE SKIP LOCKED` já torne o drain seguro, o
 * lock evita N ticks simultâneos desperdiçando conexões.
 */
import type { Logger } from '@hm/logger';
import { dispatchPending, type DispatchTickResult } from './dispatcher';
import {
  acquireSchedulerLock,
  WEBHOOK_DISPATCH_LOCK_KEY,
  WEBHOOK_DISPATCH_LOCK_TTL_MS,
  DEFAULT_DISPATCH_TICK_MS,
  type RedisLike,
} from './scheduler';

export interface WebhookDispatcherHandle {
  stop(): Promise<void>;
}

export function startWebhookDispatcher(deps: {
  redis: RedisLike;
  logger: Logger;
  intervalMs?: number;
  /** Injetável p/ teste do dispatch HTTP. */
  fetchImpl?: typeof fetch;
}): WebhookDispatcherHandle {
  const intervalMs = deps.intervalMs ?? DEFAULT_DISPATCH_TICK_MS;
  let running = false;

  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const release = await acquireSchedulerLock(
        deps.redis,
        WEBHOOK_DISPATCH_LOCK_KEY,
        WEBHOOK_DISPATCH_LOCK_TTL_MS,
      );
      if (!release) return; // outra instância está despachando
      try {
        const result: DispatchTickResult = await dispatchPending({
          logger: deps.logger,
          fetchImpl: deps.fetchImpl,
        });
        if (result.processed > 0) {
          deps.logger.info('webhook dispatch tick', { ...result });
        }
      } finally {
        await release();
      }
    })()
      .catch((err: unknown) => {
        deps.logger.error('webhook dispatch tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('webhook dispatcher iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export { fanoutEvent, type WebhookEvent, type FanoutResult } from './fanout';
export {
  dispatchPending,
  signWebhook,
  backoffSeconds,
  MAX_ATTEMPTS,
  SIGNATURE_HEADER,
  type DispatchDeps,
  type DispatchTickResult,
} from './dispatcher';
export {
  WEBHOOK_DISPATCH_LOCK_KEY,
  WEBHOOK_DISPATCH_LOCK_TTL_MS,
  DEFAULT_DISPATCH_TICK_MS,
  type RedisLike,
} from './scheduler';
