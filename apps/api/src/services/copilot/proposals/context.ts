/**
 * Contexto dos executores e autorização do motor (F73-S05).
 *
 * - `AfterCommitQueue`: efeitos (socket, fila) que só podem sair DEPOIS do commit da transação
 *   que os produziu. O motor drena a fila depois do `run` do item; no nível 2 (dentro do
 *   callback) repassa para a fila do callback, que drena depois do commit DELE. Transação que
 *   desfaz = fila descartada.
 * - `executorContext`: monta o `ExecutorContext`. Nas fases de leitura (resolver, prévia,
 *   política, `resolveIds`) o `afterCommit` lança: leitura não publica nada.
 * - `authorizeWrite`: a ÚNICA forma de o motor chamar `authorizeCapability`, sempre com as
 *   permissões de entidade do executor (`requires`) e `isWrite`.
 */
import type { CopilotProposalSource, DbTx } from '@hm/db';
import type { Logger } from '@hm/logger';
import type { CapabilityKey, CopilotBudgetState } from '@hm/shared';
import type {
  AfterCommitFn,
  CapabilityExecutor,
  ExecutorContext,
} from '../../../internal/copilot/core/executor-types';
import { authorizeCapability, type CopilotAuthorization } from '../identity/authorize';
import type { CopilotPrincipal } from '../identity/principal';

/** Fila de efeitos pós-commit. */
export class AfterCommitQueue {
  private fns: AfterCommitFn[] = [];

  push(fn: AfterCommitFn): void {
    this.fns.push(fn);
  }

  get size(): number {
    return this.fns.length;
  }

  /** Descarta (a transação desfez). */
  clear(): void {
    this.fns = [];
  }

  /** Move tudo para outra fila (savepoint confirmado dentro de uma transação maior). */
  moveTo(sink: (fn: AfterCommitFn) => void): void {
    const fns = this.fns;
    this.fns = [];
    for (const fn of fns) sink(fn);
  }

  /** Roda em ordem, depois do commit. Nunca lança: falha vira log. */
  async drain(logger: Logger): Promise<void> {
    const fns = this.fns;
    this.fns = [];
    for (const fn of fns) {
      try {
        await fn();
      } catch (err) {
        logger.warn('copilot-proposals: efeito pós-commit falhou', {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }
    }
  }
}

function readOnlyAfterCommit(): never {
  throw new Error('copilot executor: afterCommit só existe em executeItem/undoItem.');
}

export function executorContext(input: {
  readonly tx: DbTx;
  readonly principal: CopilotPrincipal;
  readonly requestedByMemberId: string;
  readonly proposalId: string | null;
  readonly source: CopilotProposalSource;
  readonly now: Date;
  /** Ausente = fase de leitura (lança). */
  readonly afterCommit?: (fn: AfterCommitFn) => void;
}): ExecutorContext {
  return {
    tx: input.tx,
    principal: input.principal,
    requestedByMemberId: input.requestedByMemberId,
    proposalId: input.proposalId,
    source: input.source,
    now: input.now,
    afterCommit: input.afterCommit ?? readOnlyAfterCommit,
  };
}

/** Autorização de escrita do motor: papel ∧ matriz ∧ `requires` ∧ assinatura ∧ orçamento. */
export function authorizeWrite(
  principal: CopilotPrincipal,
  executor: Pick<CapabilityExecutor, 'requires'> | undefined,
  capability: CapabilityKey,
  options: { readonly targetCount: number; readonly budget: CopilotBudgetState },
): CopilotAuthorization {
  return authorizeCapability(principal, capability, {
    budget: options.budget,
    targetCount: options.targetCount,
    isWrite: true,
    ...(executor?.requires ? { permissions: executor.requires } : {}),
  });
}
