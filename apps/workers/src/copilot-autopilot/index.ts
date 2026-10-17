/**
 * Worker do piloto automático (F73-S13) — barrel + scheduler.
 *
 * `startCopilotAutopilotScheduler({ redis, logger })`: tick de hora em hora (singleton por lock
 * Redis) que gera as sugestões de movimentação com `generateSuggestions` do `@hm/db`. O composition
 * root (`bootstrap/index.ts`) liga e desliga.
 */
import type { Logger } from '@hm/logger';
import { makeSuggestionsChangedEmitter, type SuggestionsChangedEmitter } from './emit';
import {
  COPILOT_AUTOPILOT_INITIAL_DELAY_MS,
  COPILOT_AUTOPILOT_INTERVAL_MS,
  type RedisLike,
} from './scheduler';
import {
  createDbCopilotAutopilotPort,
  runCopilotAutopilotTick,
  type CopilotAutopilotPort,
} from './tick';

export interface CopilotAutopilotSchedulerHandle {
  stop(): Promise<void>;
}

export interface CopilotAutopilotSchedulerDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly port?: CopilotAutopilotPort;
  readonly emit?: SuggestionsChangedEmitter;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly initialDelayMs?: number;
}

export function startCopilotAutopilotScheduler(
  deps: CopilotAutopilotSchedulerDeps,
): CopilotAutopilotSchedulerHandle {
  const port = deps.port ?? createDbCopilotAutopilotPort();
  const emit = deps.emit ?? makeSuggestionsChangedEmitter(deps.logger);
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? COPILOT_AUTOPILOT_INTERVAL_MS;
  let running = false;

  const tick = (): void => {
    if (running) return; // não sobrepõe ticks
    running = true;
    void runCopilotAutopilotTick({ redis: deps.redis, logger: deps.logger, port, emit, now })
      .catch((err: unknown) => {
        deps.logger.error('copilot-autopilot: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const initial = setTimeout(tick, deps.initialDelayMs ?? COPILOT_AUTOPILOT_INITIAL_DELAY_MS);
  initial.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('copilot-autopilot scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearTimeout(initial);
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export {
  COPILOT_AUTOPILOT_INITIAL_DELAY_MS,
  COPILOT_AUTOPILOT_INTERVAL_MS,
  COPILOT_AUTOPILOT_LOCK_KEY,
  COPILOT_AUTOPILOT_LOCK_TTL_MS,
  COPILOT_AUTOPILOT_WORKSPACE_BATCH,
  acquireSchedulerLock,
  type RedisLike,
  type ReleaseLock,
} from './scheduler';
export { makeSuggestionsChangedEmitter, type SuggestionsChangedEmitter } from './emit';
export {
  createDbCopilotAutopilotPort,
  runCopilotAutopilotTick,
  type CopilotAutopilotPort,
  type CopilotAutopilotTickDeps,
  type CopilotAutopilotTickResult,
} from './tick';
