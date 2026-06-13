/**
 * Worker de avaliacao pos-conversa (F29-S03) — barrel + scheduler. Composition
 * surface para o bootstrap: um cron tick idempotente e singleton por lock Redis
 * que chama o LLM-judge (F29-S02) e persiste a avaliacao (F29-S01).
 */
import { createAgentsClient } from '@hm/agents-client';
import type { Logger } from '@hm/logger';
import {
  DEFAULT_EVALUATION_TICK_MS,
  type RedisLike,
} from './scheduler';
import { runEvaluationTick, type EvaluationDeps, type JudgePort } from './evaluation-job';

export interface SchedulerHandle {
  stop(): Promise<void>;
}

/** Le a config do runtime do ambiente (AGENT_RUNTIME_URL + AGENT_RUNTIME_TOKEN). */
export function evaluationRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl: string; token: string } {
  const baseUrl = env['AGENT_RUNTIME_URL'];
  const token = env['AGENT_RUNTIME_TOKEN'];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('evaluation: AGENT_RUNTIME_URL ausente no ambiente.');
  }
  if (token === undefined || token.length === 0) {
    throw new Error('evaluation: AGENT_RUNTIME_TOKEN ausente no ambiente.');
  }
  return { baseUrl, token };
}

/** Constroi a JudgePort a partir do @hm/agents-client (auth Bearer interno). */
export function createJudgePort(config: { baseUrl: string; token: string }): JudgePort {
  const client = createAgentsClient({ baseUrl: config.baseUrl, token: config.token });
  return {
    evaluate: (req) => client.evaluate(req),
  };
}

function startInterval(
  intervalMs: number,
  label: string,
  logger: Logger,
  run: () => Promise<unknown>,
): SchedulerHandle {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void run()
      .catch((err: unknown) => {
        logger.error(`${label}: tick falhou`, {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  logger.info(`${label} iniciado`, { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export function startEvaluationScheduler(deps: {
  redis: RedisLike;
  logger: Logger;
  judge: JudgePort;
  intervalMs?: number;
  batchSize?: number;
  lookbackHours?: number;
}): SchedulerHandle {
  const evalDeps: EvaluationDeps = {
    redis: deps.redis,
    logger: deps.logger,
    judge: deps.judge,
    batchSize: deps.batchSize,
    lookbackHours: deps.lookbackHours,
  };
  return startInterval(
    deps.intervalMs ?? DEFAULT_EVALUATION_TICK_MS,
    'evaluation scheduler',
    deps.logger,
    () => runEvaluationTick(evalDeps),
  );
}

export {
  runEvaluationTick,
  type EvaluationDeps,
  type EvaluationTickResult,
  type JudgePort,
} from './evaluation-job';
export {
  EVALUATION_LOCK_KEY,
  DEFAULT_EVALUATION_TICK_MS,
  DEFAULT_EVALUATION_BATCH,
  DEFAULT_EVALUATION_LOOKBACK_HOURS,
  type RedisLike,
} from './scheduler';
