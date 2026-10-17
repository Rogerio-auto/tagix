/**
 * Aprovar ou recusar sugestões do piloto automático, em lote (F73-S13; COPILOTO.md §5.2 e §7.2;
 * ADR-004).
 *
 * RECUSAR marca `rejected` (quem e quando). APROVAR cria UMA proposta `source='autopilot'`,
 * capacidade `deal.move`, pelo executor do F73-S08, POR ESTÁGIO DE DESTINO (o executor aceita um
 * único `to_stage_id`; um lote com destinos diferentes vira uma proposta por destino). O clique de
 * aprovar é a confirmação (`preconfirmed`): o motor executa como QUEM APROVOU (suas permissões, seu
 * escopo; `executed_as_member_id` e `audit_logs.actor_member_id`), com `actor_type='autopilot'` e
 * desfazer por 7 dias (`undo_deadline`), regras do motor.
 *
 * Passos, na ordem (cada um por uma razão):
 *   1. Carrega as sugestões SOB `dealScope` do membro: o que ele não vê é `not_found` (sem oráculo).
 *   2. Já decidida/expirada → pulada `already_decided` (decisão é única).
 *   3. Negócio que saiu do estágio ou foi fechado → `superseded` e pulada `no_longer_in_stage`.
 *      Negócio EDITADO depois que a sugestão nasceu (`deals.updated_at` > `created_at`) → `superseded`
 *      e pulada `edited` com o nome de quem editou ("editada por Paula"): a prévia do motor só
 *      vê o estado de AGORA, então sem isto a sugestão de horas atrás passaria por cima da edição.
 *      A passada seguinte do gerador cria a sugestão nova, se o negócio ainda se qualifica.
 *   4. CLAIM atômico (`UPDATE ... WHERE status='pending'`): duas decisões concorrentes sobre o mesmo
 *      id não geram duas propostas (a segunda espera o commit da primeira e não encontra pendente).
 *   5. Propõe pelo motor. Nível 2 (um negócio) executa dentro da transação; nível 3 sai `executing`
 *      e `start()` roda DEPOIS do commit (senão o sweeper retoma em até 2 min); nível 4 (a
 *      automação do estágio de destino fala com o cliente) fica `proposed` e vira
 *      `awaiting_confirmation` no resultado: a pessoa confirma com "Revisei" na Atividade.
 *      Proposta `blocked` (matriz do Copiloto, orçamento) devolve o claim: as sugestões voltam a
 *      `pending` e o resultado diz `blocked`.
 *   6. Espera a execução (até `waitMs`) para devolver o que de fato aconteceu por negócio:
 *      "Aprovadas 7, puladas 1 (editada por Paula)". Passou do prazo → `in_progress: true` e o
 *      progresso segue pelo `copilot:proposal_updated`.
 *
 * As sugestões aprovadas ficam `approved` com o `proposal_id`, mesmo as que o motor depois pulou:
 * a decisão da pessoa foi aprovar (a taxa de aceite da F73-S15 mede decisões).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  copilotAutopilotRepo,
  copilotProposalsRepo,
  schema,
  type CopilotActionItemRow,
  type CopilotProposalStatus,
  type CopilotSuggestionRow,
  type DbTx,
} from '@hm/db';
import type { CapabilityExecutor } from '../../../internal/copilot/core/executor-types';
import { lastDealEditor } from '../../../internal/copilot/act-crm/common';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import type { CopilotPrincipal } from '../identity/principal';
import { dealScope } from '../identity/scope';
import { AfterCommitQueue, proposeAction, type ProposeOutcome } from '../proposals';
import type { ProposalEngineDeps } from '../proposals/types';
import { emitSuggestionsChangedSafely, type SuggestionsChangedEmitter } from './emit';
import { countPendingSuggestions } from './suggestions';
import {
  summarizeDecision,
  summaryFamily,
  type DecideItem,
  type DecideSkipReason,
} from './summary';

const { copilotSuggestions: s, deals } = schema;

/** Prazo para esperar a execução antes de devolver "em andamento". */
export const DECIDE_EXECUTION_WAIT_MS = 15_000;

export interface DecideProposalRef {
  readonly proposal_id: string;
  readonly to_stage_id: string;
  readonly status: CopilotProposalStatus;
  readonly risk_level: number;
  /** Fim da janela de desfazer (7 dias no piloto automático); `null` até concluir. */
  readonly undo_until: string | null;
}

export interface DecideResult {
  readonly decision: 'approve' | 'reject';
  readonly approved: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly not_found: number;
  readonly awaiting_confirmation: number;
  /** Alguma proposta ainda executando quando a resposta saiu. */
  readonly in_progress: boolean;
  /** "Aprovadas 7, puladas 1 (editada por Paula)". */
  readonly summary: string;
  /** Um por id enviado, na ordem recebida. */
  readonly results: DecideItem[];
  readonly proposals: DecideProposalRef[];
  /** Pendentes do workspace depois da decisão. */
  readonly pending_count: number;
}

export interface DecideDeps {
  readonly engine: ProposalEngineDeps;
  readonly executor: CapabilityExecutor;
  readonly emit: SuggestionsChangedEmitter;
  /** Transação RLS do workspace (`req.scoped`). */
  readonly scoped: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  readonly waitMs?: number;
}

interface ProposalGroup {
  readonly proposalId: string;
  readonly toStageId: string;
  readonly kind: 'executed' | 'executing' | 'proposed';
  readonly suggestions: ReadonlyArray<{ readonly id: string; readonly dealId: string }>;
  readonly start: (() => Promise<unknown>) | null;
}

interface Claimed {
  readonly items: Map<string, DecideItem>;
  readonly groups: ProposalGroup[];
  /** Algo mudou de estado (a contagem de pendentes mudou). */
  readonly changed: boolean;
}

function skip(id: string, reason: DecideSkipReason, extra: Partial<DecideItem> = {}): DecideItem {
  return { id, status: 'skipped', reason, ...extra };
}

async function supersede(tx: DbTx, workspaceId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(s)
    .set({ status: 'superseded' })
    .where(and(eq(s.workspaceId, workspaceId), inArray(s.id, [...ids]), eq(s.status, 'pending')));
}

/** Devolve o claim de um lote cujo motor recusou (`blocked`): volta a `pending`. */
async function revertClaim(tx: DbTx, workspaceId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(s)
    .set({ status: 'pending', decidedBy: null, decidedAt: null, proposalId: null })
    .where(and(eq(s.workspaceId, workspaceId), inArray(s.id, [...ids]), eq(s.status, 'approved')));
}

async function claimAndPropose(
  tx: DbTx,
  deps: DecideDeps,
  principal: CopilotPrincipal,
  input: { readonly ids: readonly string[]; readonly decision: 'approve' | 'reject' },
  queue: AfterCommitQueue,
): Promise<Claimed> {
  const ws = principal.workspaceId;
  // O predicado de escopo do AGENT dispara o JIT do Postgres (18 ms vs 800 ms): desligado nesta transação.
  await tx.execute(sql`set local jit = off`);
  const rows = await tx
    .select({
      id: s.id,
      status: s.status,
      dealId: s.dealId,
      fromStageId: s.fromStageId,
      createdAt: s.createdAt,
      dealStageId: deals.stageId,
      dealClosedAt: deals.closedAt,
      dealUpdatedAt: deals.updatedAt,
    })
    .from(s)
    .innerJoin(deals, eq(deals.id, s.dealId))
    .where(
      and(eq(s.workspaceId, ws), inArray(s.id, [...input.ids]), dealScope(principal) ?? undefined),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const items = new Map<string, DecideItem>();
  const groups: ProposalGroup[] = [];
  let changed = false;

  const eligible: string[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    if (!row) {
      items.set(id, { id, status: 'not_found' });
    } else if (row.status !== 'pending') {
      items.set(id, skip(id, 'already_decided'));
    } else {
      eligible.push(id);
    }
  }

  if (input.decision === 'reject') {
    const flipped = await copilotAutopilotRepo.decideSuggestions(tx, {
      ids: eligible,
      decision: 'reject',
      memberId: principal.memberId,
    });
    const flippedIds = new Set(flipped.map((r) => r.id));
    for (const id of eligible) {
      items.set(id, flippedIds.has(id) ? { id, status: 'rejected' } : skip(id, 'already_decided'));
    }
    return { items, groups, changed: flipped.length > 0 };
  }

  // Aprovar: tira do caminho o que mudou desde que a sugestão nasceu.
  const stale: string[] = [];
  const ok: string[] = [];
  for (const id of eligible) {
    const row = byId.get(id);
    if (!row) continue;
    if (row.dealClosedAt !== null || row.dealStageId !== row.fromStageId) {
      stale.push(id);
      items.set(id, skip(id, 'no_longer_in_stage'));
    } else if (
      row.dealUpdatedAt !== null &&
      row.dealUpdatedAt.getTime() > row.createdAt.getTime()
    ) {
      stale.push(id);
      const by = await lastDealEditor(tx, row.dealId, row.createdAt.toISOString());
      items.set(id, skip(id, 'edited', by ? { edited_by: by } : {}));
    } else {
      ok.push(id);
    }
  }
  await supersede(tx, ws, stale);
  if (stale.length > 0) changed = true;

  const claimed = await copilotAutopilotRepo.decideSuggestions(tx, {
    ids: ok,
    decision: 'approve',
    memberId: principal.memberId,
  });
  const claimedIds = new Set(claimed.map((r) => r.id));
  for (const id of ok) if (!claimedIds.has(id)) items.set(id, skip(id, 'already_decided'));
  if (claimed.length > 0) changed = true;

  const byDestination = new Map<string, CopilotSuggestionRow[]>();
  for (const row of claimed) {
    const list = byDestination.get(row.toStageId) ?? [];
    list.push(row);
    byDestination.set(row.toStageId, list);
  }

  for (const [toStageId, list] of byDestination) {
    const outcome: ProposeOutcome = await proposeAction(
      deps.engine,
      {
        tx,
        principal,
        source: 'autopilot',
        turnId: null,
        sessionId: null,
        preconfirmed: true,
        afterCommit: (fn) => queue.push(fn),
      },
      deps.executor,
      { deal_ids: list.map((r) => r.dealId), to_stage_id: toStageId, notify_owners: false },
    );

    if (outcome.kind === 'invalid_args' || outcome.kind === 'batch_too_large') {
      // Não acontece com ids validados (<= 200, uuid): bug, não entrada. Desfaz tudo.
      throw new Error(`copilot autopilot: o motor recusou o lote (${outcome.kind}).`);
    }
    if (outcome.kind === 'blocked') {
      await revertClaim(
        tx,
        ws,
        list.map((r) => r.id),
      );
      for (const r of list) items.set(r.id, skip(r.id, 'blocked'));
      continue;
    }

    await tx
      .update(s)
      .set({ proposalId: outcome.row.id })
      .where(
        and(
          eq(s.workspaceId, ws),
          inArray(
            s.id,
            list.map((r) => r.id),
          ),
        ),
      );
    for (const r of list) {
      items.set(
        r.id,
        outcome.kind === 'proposed'
          ? { id: r.id, status: 'awaiting_confirmation', proposal_id: outcome.row.id }
          : { id: r.id, status: 'approved', proposal_id: outcome.row.id },
      );
    }
    groups.push({
      proposalId: outcome.row.id,
      toStageId,
      kind: outcome.kind,
      suggestions: list.map((r) => ({ id: r.id, dealId: r.dealId })),
      start: outcome.kind === 'executing' ? () => outcome.start() : null,
    });
  }
  return { items, groups, changed };
}

function conflictBy(item: CopilotActionItemRow): string | undefined {
  const by = item.after?.['conflict_by'];
  return typeof by === 'string' && by.length > 0 ? by : undefined;
}

const TERMINAL: ReadonlySet<CopilotProposalStatus> = new Set([
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
  'expired',
  'undone',
  'partially_undone',
]);

/** Decide o lote (recusar ou aprovar) e devolve o que aconteceu com cada sugestão. */
export async function decideSuggestions(
  deps: DecideDeps,
  principal: CopilotPrincipal,
  input: { readonly ids: readonly string[]; readonly decision: 'approve' | 'reject' },
): Promise<DecideResult> {
  const queue = new AfterCommitQueue();
  const claimed = await deps.scoped((tx) => claimAndPropose(tx, deps, principal, input, queue));

  // Depois do commit: efeitos do nível 2 (socket, deal:stage_changed) e o início do nível 3.
  await queue.drain(deps.engine.logger);
  const starts = claimed.groups
    .map((g) => g.start)
    .filter((fn): fn is () => Promise<unknown> => fn !== null)
    .map((fn) =>
      fn().catch((err: unknown) => {
        deps.engine.logger.error('copilot-autopilot: execução da proposta falhou', {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }),
    );
  if (starts.length > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(starts),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deps.waitMs ?? DECIDE_EXECUTION_WAIT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  // O que de fato aconteceu com cada negócio.
  const items = claimed.items;
  const proposals: DecideProposalRef[] = [];
  let inProgress = false;
  const fin = await deps.scoped(async (tx) => {
    for (const g of claimed.groups) {
      const loaded = await copilotProposalsRepo.getWithItems(tx, g.proposalId);
      if (!loaded) continue;
      const { proposal, items: actionItems } = loaded;
      proposals.push({
        proposal_id: proposal.id,
        to_stage_id: g.toStageId,
        status: proposal.status,
        risk_level: proposal.riskLevel,
        undo_until: proposal.undoDeadline ? proposal.undoDeadline.toISOString() : null,
      });
      if (g.kind === 'proposed') continue;
      if (!TERMINAL.has(proposal.status)) inProgress = true;
      const byDeal = new Map(actionItems.map((it) => [it.targetId, it]));
      for (const sug of g.suggestions) {
        const it = byDeal.get(sug.dealId);
        const base = { proposal_id: proposal.id };
        if (!it) {
          items.set(sug.id, skip(sug.id, 'no_longer_in_stage', base));
        } else if (it.status === 'done' || it.status === 'pending') {
          items.set(sug.id, { id: sug.id, status: 'approved', ...base });
        } else if (it.status === 'skipped_conflict') {
          const by = conflictBy(it);
          items.set(sug.id, skip(sug.id, 'edited', { ...base, ...(by ? { edited_by: by } : {}) }));
        } else if (it.status === 'skipped_policy') {
          items.set(sug.id, skip(sug.id, 'policy', base));
        } else {
          items.set(sug.id, skip(sug.id, 'failed', base));
        }
      }
    }
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    return {
      locale: fmt.locale,
      pending: await countPendingSuggestions(tx, principal.workspaceId),
    };
  });

  const results = input.ids.map((id) => items.get(id) ?? { id, status: 'not_found' as const });
  const done = results.filter(
    (r) => r.status === (input.decision === 'approve' ? 'approved' : 'rejected'),
  );
  const skipped = results.filter((r) => r.status === 'skipped');
  const notFound = results.filter((r) => r.status === 'not_found').length;
  const awaiting = results.filter((r) => r.status === 'awaiting_confirmation').length;

  if (claimed.changed) {
    await emitSuggestionsChangedSafely(deps.emit, principal.workspaceId, fin.pending);
  }

  return {
    decision: input.decision,
    approved: input.decision === 'approve' ? done.length : 0,
    rejected: input.decision === 'reject' ? done.length : 0,
    skipped: skipped.length,
    not_found: notFound,
    awaiting_confirmation: awaiting,
    in_progress: inProgress,
    summary: summarizeDecision({
      family: summaryFamily(fin.locale),
      decision: input.decision,
      done: done.length,
      skipped,
      notFound,
      awaiting,
    }),
    results,
    proposals,
    pending_count: fin.pending,
  };
}
