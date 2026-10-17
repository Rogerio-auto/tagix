/**
 * Propostas de ação e seus itens (F73-S01, ADR-004).
 *
 * - `transition` é compare-and-set: casa `id` + status de origem + `version` esperada e
 *   incrementa a versão. Duas confirmações paralelas → uma vence, a outra recebe `null`.
 * - O lease de execução é medido no relógio do BANCO (`clock_timestamp()`), e as varreduras
 *   (`listExpiredOpen`, `listStaleExecuting`) rodam no papel owner, entre workspaces, usando os
 *   índices parciais da migração 0097.
 * - A Atividade (A8) é uma view sobre propostas + contagem de itens; não há log paralelo.
 */
import { and, asc, desc, eq, getTableColumns, inArray, lte, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotActionItems,
  copilotActionProposals,
  type CopilotActionItemRow,
  type CopilotActionItemStatus,
  type CopilotProposalRow,
  type CopilotProposalStatus,
  type NewCopilotActionItemRow,
  type NewCopilotProposalRow,
} from '../../schema/copilot';
import {
  beforeCursor,
  clampLimit,
  cursorTs,
  decodeCursor,
  toPage,
  type CopilotPage,
} from './cursor';

export const COPILOT_ACTIVITY_PAGE_MAX = 50;
/** Lease padrão do lote (ADR-004 §2: `now() + 2 min`). */
export const COPILOT_PROPOSAL_LEASE_SECONDS = 120;

/** Status em que a proposta ainda espera um humano (expira). */
export const COPILOT_OPEN_PROPOSAL_STATUSES = ['proposed', 'awaiting_approval'] as const;

export type InsertCopilotProposal = Omit<
  NewCopilotProposalRow,
  'id' | 'version' | 'createdAt' | 'updatedAt'
>;
export type InsertCopilotActionItem = Omit<
  NewCopilotActionItemRow,
  'id' | 'workspaceId' | 'proposalId' | 'position' | 'createdAt'
>;

export interface CopilotProposalWithItems {
  readonly proposal: CopilotProposalRow;
  /** Na ordem de execução (`position`). */
  readonly items: CopilotActionItemRow[];
}

/** Campos que uma transição pode gravar junto com o novo status. */
export type CopilotProposalPatch = Partial<
  Omit<NewCopilotProposalRow, 'id' | 'workspaceId' | 'status' | 'version' | 'createdAt' | 'updatedAt'>
>;

/** Grava a proposta e os itens (na ordem dada) na mesma transação. */
async function insertWithItems(
  tx: DbTx,
  input: { proposal: InsertCopilotProposal; items: readonly InsertCopilotActionItem[] },
): Promise<CopilotProposalWithItems> {
  const [proposal] = await tx.insert(copilotActionProposals).values(input.proposal).returning();
  if (!proposal) throw new Error('copilot: proposta não materializou.');
  if (input.items.length === 0) return { proposal, items: [] };
  const items = await tx
    .insert(copilotActionItems)
    .values(
      input.items.map((item, position) => ({
        ...item,
        workspaceId: proposal.workspaceId,
        proposalId: proposal.id,
        position,
      })),
    )
    .returning();
  items.sort((a, b) => a.position - b.position);
  return { proposal, items };
}

async function listItems(tx: DbTx, proposalId: string): Promise<CopilotActionItemRow[]> {
  return tx
    .select()
    .from(copilotActionItems)
    .where(eq(copilotActionItems.proposalId, proposalId))
    .orderBy(asc(copilotActionItems.position));
}

async function getWithItems(tx: DbTx, id: string): Promise<CopilotProposalWithItems | null> {
  const [proposal] = await tx
    .select()
    .from(copilotActionProposals)
    .where(eq(copilotActionProposals.id, id));
  if (!proposal) return null;
  return { proposal, items: await listItems(tx, id) };
}

/**
 * Transição por CAS. Casa `id`, `status ∈ from` e `version = expectedVersion`; grava `to`,
 * `version + 1`, `updated_at` e o `patch`. `leaseSeconds` (opcional) define
 * `lease_expires_at = clock_timestamp() + leaseSeconds` no relógio do banco.
 *
 * `null` = não casou (status ou versão mudaram, ou a proposta não existe/é de outro workspace).
 */
async function transition(
  tx: DbTx,
  input: {
    id: string;
    from: readonly CopilotProposalStatus[];
    to: CopilotProposalStatus;
    expectedVersion: number;
    patch?: CopilotProposalPatch;
    leaseSeconds?: number;
  },
): Promise<CopilotProposalRow | null> {
  if (input.from.length === 0) return null;
  const [row] = await tx
    .update(copilotActionProposals)
    .set({
      ...input.patch,
      ...(input.leaseSeconds !== undefined
        ? { leaseExpiresAt: sql`clock_timestamp() + make_interval(secs => ${input.leaseSeconds})` }
        : {}),
      status: input.to,
      version: sql`${copilotActionProposals.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(copilotActionProposals.id, input.id),
        inArray(copilotActionProposals.status, [...input.from]),
        eq(copilotActionProposals.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}

/** Campos de item que a execução/desfazer grava junto com o status. */
export type CopilotActionItemPatch = Partial<
  Pick<
    NewCopilotActionItemRow,
    'before' | 'after' | 'undoPayload' | 'errorCode' | 'executedAt' | 'undoneAt' | 'expectedVersion'
  >
>;

/**
 * Muda o status de um item. Com `from`, é CAS (o item precisa estar num desses status): é o que
 * torna a retomada por lease idempotente — item já `done` não é reexecutado.
 */
async function setItemStatus(
  tx: DbTx,
  input: {
    itemId: string;
    to: CopilotActionItemStatus;
    from?: readonly CopilotActionItemStatus[];
    patch?: CopilotActionItemPatch;
  },
): Promise<CopilotActionItemRow | null> {
  const [row] = await tx
    .update(copilotActionItems)
    .set({ ...input.patch, status: input.to })
    .where(
      and(
        eq(copilotActionItems.id, input.itemId),
        input.from && input.from.length > 0
          ? inArray(copilotActionItems.status, [...input.from])
          : undefined,
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Renova o lease de uma proposta em execução (a cada item). Devolve `stopRequested` para o laço
 * conferir o "Parar" entre itens. `null` = a proposta não está mais `executing`.
 */
async function renewLease(
  tx: DbTx,
  id: string,
  leaseSeconds: number = COPILOT_PROPOSAL_LEASE_SECONDS,
): Promise<{ leaseExpiresAt: Date; stopRequested: boolean } | null> {
  const [row] = await tx
    .update(copilotActionProposals)
    .set({
      leaseExpiresAt: sql`clock_timestamp() + make_interval(secs => ${leaseSeconds})`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(copilotActionProposals.id, id), eq(copilotActionProposals.status, 'executing')))
    .returning({
      leaseExpiresAt: copilotActionProposals.leaseExpiresAt,
      stopRequested: copilotActionProposals.stopRequested,
    });
  if (!row || row.leaseExpiresAt === null) return null;
  return { leaseExpiresAt: row.leaseExpiresAt, stopRequested: row.stopRequested };
}

/** Propostas abertas vencidas (varredura de expiração). Índice parcial `open_expires`. */
async function listExpiredOpen(tx: DbTx, now: Date, limit: number): Promise<CopilotProposalRow[]> {
  return tx
    .select()
    .from(copilotActionProposals)
    .where(
      and(
        inArray(copilotActionProposals.status, [...COPILOT_OPEN_PROPOSAL_STATUSES]),
        lte(copilotActionProposals.expiresAt, now),
      ),
    )
    .orderBy(asc(copilotActionProposals.expiresAt))
    .limit(clampLimit(limit, 100, 1000));
}

/** Lotes `executing` com lease vencido (varredura de retomada). Índice parcial `executing_lease`. */
async function listStaleExecuting(
  tx: DbTx,
  now: Date,
  limit: number,
): Promise<CopilotProposalRow[]> {
  return tx
    .select()
    .from(copilotActionProposals)
    .where(
      and(
        eq(copilotActionProposals.status, 'executing'),
        lte(copilotActionProposals.leaseExpiresAt, now),
      ),
    )
    .orderBy(asc(copilotActionProposals.leaseExpiresAt))
    .limit(clampLimit(limit, 100, 1000));
}

/** Contagem de itens por desfecho (o "5 de 7" da Atividade). */
export interface CopilotItemCounts {
  readonly total: number;
  readonly pending: number;
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly undone: number;
  readonly excluded: number;
}

export type CopilotActivityEntry = CopilotProposalRow & { readonly itemCounts: CopilotItemCounts };

const EMPTY_COUNTS: CopilotItemCounts = {
  total: 0,
  pending: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  undone: 0,
  excluded: 0,
};

function parseCounts(value: unknown): CopilotItemCounts {
  const raw: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof raw !== 'object' || raw === null) return EMPTY_COUNTS;
  const rec = raw as Record<string, unknown>;
  const n = (k: keyof CopilotItemCounts): number => {
    const v = rec[k];
    return typeof v === 'number' ? v : Number(v ?? 0);
  };
  return {
    total: n('total'),
    pending: n('pending'),
    done: n('done'),
    skipped: n('skipped'),
    failed: n('failed'),
    undone: n('undone'),
    excluded: n('excluded'),
  };
}

/**
 * Atividade: propostas mais recentes primeiro. `mine` = pedidas pelo membro; `all` = do
 * workspace (a permissão `copilot.activity.view_all` é conferida na rota).
 */
async function listActivity(
  tx: DbTx,
  input: { scope: 'mine' | 'all'; memberId: string; cursor?: string | null; limit?: number },
): Promise<CopilotPage<CopilotActivityEntry>> {
  const limit = clampLimit(input.limit, 20, COPILOT_ACTIVITY_PAGE_MAX);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const p = copilotActionProposals;
  const rows = await tx
    .select({
      ...getTableColumns(p),
      cursorTs: cursorTs(p.createdAt),
      itemCounts: sql<CopilotItemCounts>`(
        select json_build_object(
          'total', count(*)::int,
          'pending', (count(*) filter (where i.status = 'pending'))::int,
          'done', (count(*) filter (where i.status = 'done'))::int,
          'skipped', (count(*) filter (where i.status in ('skipped_conflict','skipped_policy')))::int,
          'failed', (count(*) filter (where i.status = 'failed'))::int,
          'undone', (count(*) filter (where i.status = 'undone'))::int,
          'excluded', (count(*) filter (where i.status = 'excluded'))::int
        )
        from copilot_action_items i
        where i.proposal_id = ${p.id}
      )`.mapWith(parseCounts),
    })
    .from(p)
    .where(
      and(
        sql`${p.workspaceId} = app_current_workspace()`,
        input.scope === 'mine' ? eq(p.requestedByMemberId, input.memberId) : undefined,
        cursor ? beforeCursor(p.createdAt, p.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(limit + 1);
  return toPage(rows, limit);
}

export const copilotProposalsRepo = {
  insertWithItems,
  getWithItems,
  listItems,
  transition,
  setItemStatus,
  renewLease,
  listExpiredOpen,
  listStaleExecuting,
  listActivity,
} as const;
