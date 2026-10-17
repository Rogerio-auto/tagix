/**
 * Alvos "negócios" das ações do Copiloto (`deal.move`, `deal.assign_owner`; F73-S08).
 *
 * Os alvos vêm por ids (`deal_ids`, até 200) OU pelo MESMO filtro do `list_deals`
 * (`dealFilterShape` + `buildDealWhere` de `read-crm/deal-filters.ts`, por import): o que a
 * pessoa viu listado é o que a proposta move. Sempre sob `dealScope` (AGENT: os seus ou os de
 * conversa visível), dentro do RLS do workspace. Sem filtro de status, o padrão é "em aberto"
 * (o mesmo do `list_deals`).
 *
 * Estado lido de cada negócio (o `before` do item) e versão:
 *   state   = { stage_id, owner_id, pipeline_id, conversation_id, value_cents, open, version }
 *   versão  = `<updated_at::text>|<stage_id>|<owner_id>` (o que a ação compara antes de escrever)
 */
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { BATCH_LIMIT } from '@hm/shared';
import { z } from 'zod';
import type { CopilotPrincipal } from '../../../services/copilot/identity/principal';
import { dealScope } from '../../../services/copilot/identity/scope';
import type { ExecutorContext, ResolvedTargets, Target, TargetRef } from '../core/executor-types';
import { loadWorkspaceFormat } from '../read-crm/common';
import { buildDealWhere, dealFilterShape, type DealFilterArgs } from '../read-crm/deal-filters';
import { TARGET_IDS_MAX, clipText, versionSql } from './common';

const { deals } = schema;

/** Filtro de negócios do `list_deals` (o mesmo Zod). */
export const DealFilterSchema = z
  .object(dealFilterShape)
  .strict()
  .describe('O mesmo filtro do list_deals. Sem status, vale "em aberto".');

export const dealTargetShape = {
  deal_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(TARGET_IDS_MAX)
    .optional()
    .describe('Negócios escolhidos (até 200). Use OU deal_ids OU filter.'),
  filter: DealFilterSchema.optional(),
} as const;

export interface DealTargetArgs {
  readonly deal_ids?: readonly string[] | undefined;
  readonly filter?: DealFilterArgs | undefined;
}

/** Exatamente um dos dois. */
export function oneDealSelector(v: DealTargetArgs): boolean {
  return (v.deal_ids !== undefined) !== (v.filter !== undefined);
}

export interface DealState {
  readonly stage_id: string;
  readonly owner_id: string | null;
  readonly pipeline_id: string;
  readonly conversation_id: string | null;
  readonly value_cents: number;
  readonly open: boolean;
  /** `coalesce(updated_at, created_at)::text`. */
  readonly version: string;
}

export interface DealRowLite {
  readonly id: string;
  readonly title: string;
  readonly stageId: string;
  readonly ownerId: string | null;
  readonly pipelineId: string;
  readonly conversationId: string | null;
  readonly valueCents: number;
  readonly open: boolean;
  readonly version: string;
}

export function dealVersion(row: Pick<DealRowLite, 'version' | 'stageId' | 'ownerId'>): string {
  return `${row.version}|${row.stageId}|${row.ownerId ?? ''}`;
}

export function dealStateOf(row: DealRowLite): DealState {
  return {
    stage_id: row.stageId,
    owner_id: row.ownerId,
    pipeline_id: row.pipelineId,
    conversation_id: row.conversationId,
    value_cents: row.valueCents,
    open: row.open,
    version: row.version,
  };
}

export function dealTarget(row: DealRowLite): Target {
  return {
    type: 'deal',
    id: row.id,
    label: clipText(row.title, 200) ?? 'Negócio',
    expectedVersion: dealVersion(row),
    state: { ...dealStateOf(row) },
  };
}

const dealColumns = {
  id: deals.id,
  title: deals.title,
  stageId: deals.stageId,
  ownerId: deals.ownerId,
  pipelineId: deals.pipelineId,
  conversationId: deals.conversationId,
  valueCents: deals.valueCents,
  closedAt: deals.closedAt,
  version: versionSql(deals.updatedAt, deals.createdAt),
};

type DealSelectRow = {
  id: string;
  title: string;
  stageId: string;
  ownerId: string | null;
  pipelineId: string;
  conversationId: string | null;
  valueCents: number;
  closedAt: Date | null;
  version: string;
};

function lite(r: DealSelectRow): DealRowLite {
  return {
    id: r.id,
    title: r.title,
    stageId: r.stageId,
    ownerId: r.ownerId,
    pipelineId: r.pipelineId,
    conversationId: r.conversationId,
    valueCents: Number(r.valueCents),
    open: r.closedAt === null,
    version: r.version,
  };
}

function scopedDealWhere(principal: CopilotPrincipal, extra: SQL | undefined): SQL {
  const scope = dealScope(principal);
  const conds: SQL[] = [eq(deals.workspaceId, principal.workspaceId)];
  if (scope) conds.push(scope);
  if (extra) conds.push(extra);
  return and(...conds) as SQL;
}

/**
 * Negócios do pedido, sob o escopo do principal. Por ids: os invisíveis/inexistentes voltam em
 * `dropped`. Por filtro: até `BATCH_LIMIT + 1` (o motor recusa o lote grande demais).
 */
export async function loadDealTargets(
  ctx: Pick<ExecutorContext, 'tx' | 'principal'>,
  args: DealTargetArgs,
): Promise<{ rows: DealRowLite[]; dropped: { id: string; reason: 'not_found' }[] }> {
  const { tx, principal } = ctx;
  if (args.deal_ids) {
    const ids = [...new Set(args.deal_ids)];
    const found = await tx
      .select(dealColumns)
      .from(deals)
      .where(scopedDealWhere(principal, inArray(deals.id, ids)));
    const byId = new Map(found.map((r) => [r.id, lite(r)]));
    const rows: DealRowLite[] = [];
    const dropped: { id: string; reason: 'not_found' }[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) rows.push(row);
      else dropped.push({ id, reason: 'not_found' });
    }
    return { rows, dropped };
  }
  const filter = args.filter ?? {};
  const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
  const found = await tx
    .select(dealColumns)
    .from(deals)
    .where(buildDealWhere(principal, filter, { defaultStatus: 'open', timezone: fmt.timezone }))
    .orderBy(desc(deals.valueCents), asc(deals.id))
    .limit(BATCH_LIMIT + 1);
  return { rows: found.map(lite), dropped: [] };
}

/** `resolveIds` dos executores de negócio: os mesmos alvos sob OUTRO principal. */
export async function resolveDealIds(
  ctx: Pick<ExecutorContext, 'tx' | 'principal'>,
  refs: readonly TargetRef[],
): Promise<ResolvedTargets> {
  const ids = refs.filter((r) => r.type === 'deal').map((r) => r.id);
  const dropped = refs
    .filter((r) => r.type !== 'deal')
    .map((r) => ({ id: r.id, reason: 'not_found' as const }));
  if (ids.length === 0) return { targets: [], dropped };
  const loaded = await loadDealTargets(ctx, { deal_ids: ids });
  return { targets: loaded.rows.map(dealTarget), dropped: [...dropped, ...loaded.dropped] };
}

/**
 * Relê UM negócio para escrever, travado (`FOR UPDATE`) e sob o escopo do principal (quem
 * executa pode ser o aprovador). `null` = sumiu ou saiu do escopo.
 */
export async function lockDeal(
  tx: DbTx,
  principal: CopilotPrincipal,
  dealId: string,
): Promise<DealRowLite | null> {
  const [row] = await tx
    .select(dealColumns)
    .from(deals)
    .where(scopedDealWhere(principal, eq(deals.id, dealId)))
    .limit(1)
    .for('update', { of: deals });
  return row ? lite(row) : null;
}
