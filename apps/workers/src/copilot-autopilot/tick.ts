/**
 * Tick do piloto automático (F73-S13; COPILOTO.md §7.2): para cada workspace com regra ligada,
 * `generateSuggestions` (`@hm/db`) cria, revalida e expira as sugestões.
 *
 *   - UMA instância por vez, por lock Redis (`acquireSchedulerLock`): dois ticks simultâneos, um
 *     processa e o outro devolve `ran: false`.
 *   - Em LOTES: os workspaces vêm por página keyset (`COPILOT_AUTOPILOT_WORKSPACE_BATCH`), em
 *     sequência, cada um na PRÓPRIA transação `withWorkspace` (RLS como cinto). Um workspace que
 *     falha vira log e contagem; os demais seguem.
 *   - Só quem tem regra `suggest` ou `daily_approval` e o Copiloto ligado entra.
 *   - Prazo: o tick para de abrir workspace novo ao passar de 90% da posse do lock (o resto fica
 *     para o tick seguinte), para nunca trabalhar sem o lock.
 *   - Mudou a fila (criou, expirou ou substituiu)? Emite `copilot:suggestions_changed` com a
 *     contagem de pendentes, best-effort pela fila `socket.relay`.
 */
import { sql } from 'drizzle-orm';
import { generateSuggestions, getDb, withWorkspace, type GenerateSuggestionsResult } from '@hm/db';
import type { Logger } from '@hm/logger';
import type { SuggestionsChangedEmitter } from './emit';
import {
  COPILOT_AUTOPILOT_LOCK_KEY,
  COPILOT_AUTOPILOT_LOCK_TTL_MS,
  COPILOT_AUTOPILOT_WORKSPACE_BATCH,
  acquireSchedulerLock,
  type RedisLike,
} from './scheduler';

/** Porta de banco do tick (injetável; a real é `createDbCopilotAutopilotPort`). */
export interface CopilotAutopilotPort {
  /** Workspaces com regra ligada e Copiloto ligado, em ordem de id, depois de `afterId`. */
  listWorkspaces(afterId: string | null, limit: number): Promise<string[]>;
  generate(workspaceId: string, now: Date): Promise<GenerateSuggestionsResult>;
}

export function createDbCopilotAutopilotPort(): CopilotAutopilotPort {
  return {
    async listWorkspaces(afterId, limit) {
      // Entre workspaces: roda como owner (padrão dos agendadores cross-tenant).
      const rows = await getDb().execute<{ workspace_id: string }>(sql`
        select r.workspace_id
          from (
            select distinct workspace_id
              from copilot_autopilot_rules
             where mode in ('suggest', 'daily_approval')
               ${afterId ? sql`and workspace_id > ${afterId}::uuid` : sql``}
          ) r
          left join copilot_settings s on s.workspace_id = r.workspace_id
         where coalesce(s.enabled, true)
         order by r.workspace_id
         limit ${limit}
      `);
      return Array.from(rows, (r) => r.workspace_id);
    },
    generate(workspaceId, now) {
      return withWorkspace(workspaceId, (tx) => generateSuggestions(tx, workspaceId, now));
    },
  };
}

export interface CopilotAutopilotTickDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly port: CopilotAutopilotPort;
  readonly emit: SuggestionsChangedEmitter;
  readonly now: () => Date;
  /** Testes: chave de lock própria e tamanho de página. */
  readonly lockKey?: string;
  readonly lockTtlMs?: number;
  readonly workspaceBatch?: number;
}

export interface CopilotAutopilotTickResult {
  /** `false` = outra instância detém o lock e este tick não processou nada. */
  readonly ran: boolean;
  readonly workspaces: number;
  readonly created: number;
  readonly expired: number;
  readonly superseded: number;
  readonly invalidRules: number;
  readonly errors: number;
  /** Parou antes de acabar por falta de tempo de posse do lock (o próximo tick continua). */
  readonly reachedDeadline: boolean;
}

const NOT_RUN: CopilotAutopilotTickResult = {
  ran: false,
  workspaces: 0,
  created: 0,
  expired: 0,
  superseded: 0,
  invalidRules: 0,
  errors: 0,
  reachedDeadline: false,
};

export async function runCopilotAutopilotTick(
  deps: CopilotAutopilotTickDeps,
): Promise<CopilotAutopilotTickResult> {
  const lockTtl = deps.lockTtlMs ?? COPILOT_AUTOPILOT_LOCK_TTL_MS;
  const release = await acquireSchedulerLock(
    deps.redis,
    deps.lockKey ?? COPILOT_AUTOPILOT_LOCK_KEY,
    lockTtl,
  );
  if (release === null) return NOT_RUN;

  const deadline = Date.now() + lockTtl * 0.9;
  const batch = Math.max(1, deps.workspaceBatch ?? COPILOT_AUTOPILOT_WORKSPACE_BATCH);
  const totals = {
    workspaces: 0,
    created: 0,
    expired: 0,
    superseded: 0,
    invalidRules: 0,
    errors: 0,
  };
  let reachedDeadline = false;

  try {
    let after: string | null = null;
    paging: for (;;) {
      const page: string[] = await deps.port.listWorkspaces(after, batch);
      if (page.length === 0) break;
      for (const workspaceId of page) {
        if (Date.now() >= deadline) {
          reachedDeadline = true;
          break paging;
        }
        totals.workspaces += 1;
        try {
          const r = await deps.port.generate(workspaceId, deps.now());
          totals.created += r.created;
          totals.expired += r.expired;
          totals.superseded += r.superseded;
          totals.invalidRules += r.invalidRules;
          if (r.created + r.expired + r.superseded > 0) {
            await deps.emit(workspaceId, { pending_count: r.pendingCount });
          }
        } catch (err: unknown) {
          totals.errors += 1;
          deps.logger.error('copilot-autopilot: geração falhou para o workspace', {
            workspaceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      after = page[page.length - 1] ?? null;
      if (page.length < batch) break;
    }
    if (
      totals.created + totals.expired + totals.superseded + totals.errors > 0 ||
      reachedDeadline
    ) {
      deps.logger.info('copilot-autopilot: tick', { ...totals, reachedDeadline });
    }
    return { ran: true, ...totals, reachedDeadline };
  } finally {
    await release();
  }
}
