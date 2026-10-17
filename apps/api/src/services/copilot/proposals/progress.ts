/**
 * Emissão de `copilot:proposal_updated` (COPILOTO.md §5.5) com throttle por proposta.
 *
 * Num lote de 200, emitir um evento por item inundaria o socket do dono e do aprovador. O
 * throttle emite na hora o primeiro, depois no máximo um a cada `intervalMs` (o mais recente
 * vence) e, no `flush`, o estado final, sempre. Emissão é best-effort: falha vira log, nunca
 * erro do motor.
 */
import type { CopilotActionItemRow, CopilotProposalRow } from '@hm/db';
import type { CopilotProposalUpdatedPayload } from '@hm/shared';
import { countItems, progressOf } from './items';
import type { ProposalEngineDeps } from './types';

/** Salas `member:<id>` interessadas: quem pediu, quem aprova e quem executou. */
export function proposalAudience(row: CopilotProposalRow): string[] {
  return [
    ...new Set(
      [row.requestedByMemberId, row.approverMemberId, row.executedAsMemberId].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  ];
}

export function proposalPayload(
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
): CopilotProposalUpdatedPayload {
  return {
    proposal_id: row.id,
    status: row.status,
    progress: progressOf(countItems(items)),
    version: row.version,
  };
}

/** Emite agora (transições discretas: confirmar, cancelar, aprovar). Nunca lança. */
export async function publishProposalState(
  deps: ProposalEngineDeps,
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
): Promise<void> {
  try {
    await deps.emit({
      workspaceId: row.workspaceId,
      memberIds: proposalAudience(row),
      payload: proposalPayload(row, items),
    });
  } catch (err) {
    deps.logger.warn('copilot-proposals: falha ao emitir proposal_updated', {
      proposalId: row.id,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

/** Throttle de progresso de UMA proposta em execução. */
export class ProgressThrottle {
  private lastAt = 0;
  private pending: CopilotProposalUpdatedPayload | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: ProposalEngineDeps,
    private readonly workspaceId: string,
    private readonly memberIds: readonly string[],
    private readonly intervalMs: number = deps.progressThrottleMs ?? 250,
  ) {}

  push(payload: CopilotProposalUpdatedPayload): void {
    const now = Date.now();
    if (now - this.lastAt >= this.intervalMs && this.timer === null) {
      this.send(payload);
      return;
    }
    this.pending = payload;
    if (this.timer === null) {
      const wait = Math.max(0, this.intervalMs - (now - this.lastAt));
      this.timer = setTimeout(() => {
        this.timer = null;
        const next = this.pending;
        this.pending = null;
        if (next) this.send(next);
      }, wait);
      this.timer.unref();
    }
  }

  /** Estado final: cancela o pendente e emite este, sempre. */
  async flush(payload: CopilotProposalUpdatedPayload): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    await this.emitSafely(payload);
  }

  private send(payload: CopilotProposalUpdatedPayload): void {
    this.lastAt = Date.now();
    void this.emitSafely(payload);
  }

  private async emitSafely(payload: CopilotProposalUpdatedPayload): Promise<void> {
    try {
      await this.deps.emit({ workspaceId: this.workspaceId, memberIds: this.memberIds, payload });
    } catch (err) {
      this.deps.logger.warn('copilot-proposals: falha ao emitir progresso', {
        proposalId: payload.proposal_id,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
  }
}
