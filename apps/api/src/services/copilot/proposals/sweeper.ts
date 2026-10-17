/**
 * Varredura das propostas (ADR-004 §3), a cada 60 s, no processo HTTP da API:
 *
 *   1. expira `proposed`/`awaiting_approval` vencidas (`expired` + trilha);
 *   2. retoma `executing` com lease vencido: renova o lease (para a próxima varredura não pegar
 *      de novo) e executa SÓ os itens `pending` (o item é idempotente por status e versão).
 *
 * Singleton entre réplicas por lock Redis (`SET NX PX` + liberação por token), o mesmo padrão
 * do `acquireSchedulerLock` dos workers (que vive em `apps/workers` e não é importável daqui).
 * As listagens rodam no papel owner, entre workspaces (índices parciais da 0097); cada
 * transição roda sob `withWorkspace` do workspace da proposta.
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { copilotProposalsRepo, getDb, withWorkspace } from '@hm/db';
import { loadConfig } from '../../../config';
import { recordProposalAudit } from './audit';
import { drainProposalExecutions, startProposalExecution } from './execute';
import { auditCounts, countItems } from './items';
import { publishProposalState } from './progress';
import type { ProposalEngineDeps } from './types';

export const PROPOSAL_SWEEP_INTERVAL_MS = 60_000;
export const PROPOSAL_SWEEP_LOCK_KEY = 'hm:lock:scheduler:copilot-proposals' as const;
const PROPOSAL_SWEEP_LOCK_TTL_MS = 55_000;
const EXPIRE_BATCH = 200;
const RESUME_BATCH = 20;

/** O mínimo de Redis que o lock usa (ioredis real ou fake de teste). */
export interface SweepRedis {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Lock singleton: devolve a liberação, ou `null` se outra réplica está varrendo. */
export async function acquireSweepLock(
  redis: SweepRedis,
  key: string,
  ttlMs: number,
): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(UNLOCK_LUA, 1, key, token);
  };
}

export interface SweepResult {
  readonly locked: boolean;
  readonly expired: number;
  readonly resumed: number;
}

/** Uma passada. `awaitResumes` (testes) espera as retomadas terminarem. */
export async function sweepProposalsOnce(
  deps: ProposalEngineDeps,
  redis: SweepRedis,
  options: { readonly awaitResumes?: boolean } = {},
): Promise<SweepResult> {
  const release = await acquireSweepLock(
    redis,
    PROPOSAL_SWEEP_LOCK_KEY,
    PROPOSAL_SWEEP_LOCK_TTL_MS,
  );
  if (!release) return { locked: false, expired: 0, resumed: 0 };
  let expired = 0;
  const resumes: Promise<unknown>[] = [];
  try {
    const now = deps.now();
    for (const stale of await copilotProposalsRepo.listExpiredOpen(getDb(), now, EXPIRE_BATCH)) {
      const closed = await withWorkspace(stale.workspaceId, async (tx) => {
        const row = await copilotProposalsRepo.transition(tx, {
          id: stale.id,
          from: [stale.status],
          to: 'expired',
          expectedVersion: stale.version,
        });
        if (!row) return null;
        const items = await copilotProposalsRepo.listItems(tx, row.id);
        await recordProposalAudit(tx, {
          proposal: row,
          event: 'expired',
          from: stale.status,
          actorMemberId: null,
          counts: auditCounts(countItems(items)),
        });
        return { row, items };
      });
      if (closed) {
        expired++;
        await publishProposalState(deps, closed.row, closed.items);
      }
    }

    for (const stale of await copilotProposalsRepo.listStaleExecuting(getDb(), now, RESUME_BATCH)) {
      // Reivindica renovando o lease: a próxima varredura não pega a mesma proposta.
      const claimed = await withWorkspace(stale.workspaceId, (tx) =>
        copilotProposalsRepo.renewLease(tx, stale.id),
      );
      if (!claimed) continue;
      deps.logger.info('copilot-proposals: retomando execução com lease vencido', {
        proposalId: stale.id,
        workspaceId: stale.workspaceId,
      });
      resumes.push(
        startProposalExecution(deps, { workspaceId: stale.workspaceId, proposalId: stale.id }),
      );
    }
  } finally {
    await release().catch(() => undefined);
  }
  if (options.awaitResumes) await Promise.allSettled(resumes);
  return { locked: true, expired, resumed: resumes.length };
}

export interface ProposalSweeper {
  /** Para o timer e espera a passada e as execuções em andamento. */
  stop(): Promise<void>;
}

/**
 * Liga a varredura. O timer é `unref` (não segura o processo vivo); `stop()` no shutdown.
 * Sem `redis`, abre um cliente próprio (fechado no `stop`).
 */
export function startProposalSweeper(
  deps: ProposalEngineDeps,
  options: { readonly intervalMs?: number; readonly redis?: SweepRedis } = {},
): ProposalSweeper {
  const ownRedis = options.redis
    ? null
    : new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const redis: SweepRedis = options.redis ?? (ownRedis as Redis);
  let running: Promise<unknown> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running) return;
    running = sweepProposalsOnce(deps, redis)
      .catch((err: unknown) => {
        deps.logger.error('copilot-proposals: varredura falhou', {
          ref: 'hm_copilot_proposal_sweep',
          errorName: err instanceof Error ? err.name : typeof err,
        });
      })
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, options.intervalMs ?? PROPOSAL_SWEEP_INTERVAL_MS);
  timer.unref();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (running) await running;
      await drainProposalExecutions();
      if (ownRedis) await ownRedis.quit().catch(() => undefined);
    },
  };
}
