/**
 * `deal.assign_owner` — trocar o responsável de negócios pelo Copiloto (F73-S08).
 *
 * Regras de domínio: as da tela (`assignDealOwner`: responsável precisa ser membro do workspace,
 * `deal_history` `owner_changed` com ator e `metadata = { via, proposal_id }`). O novo
 * responsável precisa estar ATIVO. Alvos: `deal_ids` ou o filtro do `list_deals`, sob
 * `dealScope` (AGENT: só os que vê); quem já é desse responsável sai da lista.
 *
 * Conflito: versão `updated_at`|estágio|responsável. Desfazer: devolve ao responsável anterior
 * se o atual ainda é o que o Copiloto colocou. `deal:updated` sai só depois do commit.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { TenantRefError, schema } from '@hm/db';
import { emitDealUpdated } from '../../../services/deal-events';
import { assignDealOwner } from '../../../services/deals/owner';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorContext,
  ExecutorPreview,
  ResolvedTargets,
  UndoItemResult,
} from '../core/executor-types';
import { loadWorkspaceFormat } from '../read-crm/common';
import {
  correlation,
  jsonString,
  lastDealEditor,
  memberActor,
  memberNames,
  plural,
  sentence,
} from './common';
import { describeDealFilter, describeSelection } from './criteria';
import {
  dealTarget,
  dealTargetShape,
  dealVersion,
  loadDealTargets,
  lockDeal,
  oneDealSelector,
  resolveDealIds,
} from './deal-targets';

const { members } = schema;

export const AssignDealsArgsSchema = z
  .object({
    ...dealTargetShape,
    owner_id: z
      .union([z.literal('me'), z.string().uuid()])
      .describe('Novo responsável (id do membro, de list_members). "me" = a própria pessoa.'),
  })
  .strict()
  .refine(oneDealSelector, { message: 'Use deal_ids OU filter (um dos dois).' });
export type AssignDealsArgs = z.infer<typeof AssignDealsArgsSchema>;

export const ASSIGN_DEALS_TOOL_DESCRIPTION =
  'Propõe trocar o responsável de negócios, por ids (deal_ids, até 200) ou pelo mesmo filtro do list_deals. ' +
  'owner_id é o id do membro (use list_members) ou "me". O sistema mostra a prévia (responsável antes e depois) e ' +
  'decide se precisa de confirmação. Se ficar aguardando confirmação, diga isso e pare.';

const NO_OWNER = 'Sem responsável';

function ownerOf(args: AssignDealsArgs, ctx: Pick<ExecutorContext, 'principal'>): string {
  return args.owner_id === 'me' ? ctx.principal.memberId : args.owner_id;
}

/** O novo responsável é membro ATIVO deste workspace? */
async function activeOwner(ctx: ExecutorContext, ownerId: string): Promise<boolean> {
  const [row] = await ctx.tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.id, ownerId),
        eq(members.workspaceId, ctx.principal.workspaceId),
        eq(members.status, 'active'),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export const assignDealsExecutor: CapabilityExecutor<AssignDealsArgs> = {
  capability: 'deal.assign_owner',
  argsSchema: AssignDealsArgsSchema,
  requires: ['pipeline.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const ownerId = ownerOf(args, ctx);
    if (!(await activeOwner(ctx, ownerId))) {
      return {
        targets: [],
        dropped: (args.deal_ids ?? []).map((id) => ({ id, reason: 'not_found' as const })),
      };
    }
    const loaded = await loadDealTargets(ctx, args);
    return {
      targets: loaded.rows.filter((r) => r.ownerId !== ownerId).map(dealTarget),
      dropped: loaded.dropped,
    };
  },

  resolveIds(ctx, refs) {
    return resolveDealIds(ctx, refs);
  },

  async preview(ctx, args, targets): Promise<ExecutorPreview> {
    const { tx, principal } = ctx;
    const ownerId = ownerOf(args, ctx);
    const previous = targets
      .map((t) => t.state['owner_id'])
      .filter((v): v is string => typeof v === 'string');
    const names = await memberNames(tx, principal.workspaceId, [ownerId, ...previous]);
    const newName = names.get(ownerId) ?? 'Membro da equipe';
    const nameOf = (id: unknown): string =>
      typeof id === 'string' ? (names.get(id) ?? 'Membro da equipe') : NO_OWNER;
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);
    const criterion = args.filter
      ? await describeDealFilter(tx, principal, args.filter, fmt)
      : describeSelection(targets.length, 'negócio', 'negócios');
    return {
      items: targets.map((t) => ({
        targetId: t.id,
        before: nameOf(t.state['owner_id']).slice(0, 200),
        after: newName.slice(0, 200),
        plannedAfter: { owner_id: ownerId },
      })),
      impact: { notified_members: [], affected_count: targets.length, criterion },
      external: false,
      irreversible: false,
      notifiesMembers: false,
      summary: sentence(
        `Passar ${plural(targets.length, 'negócio', 'negócios')} para ${newName}`,
        500,
      ),
    };
  },

  async executeItem(ctx, args, item): Promise<ExecuteItemResult> {
    const { tx, principal } = ctx;
    const ownerId = ownerOf(args, ctx);
    const deal = await lockDeal(tx, principal, item.targetId);
    if (!deal) return { status: 'failed', errorCode: 'not_found' };
    if (dealVersion(deal) !== item.expectedVersion) {
      const by = await lastDealEditor(tx, deal.id, jsonString(item.before, 'version'));
      return { status: 'skipped_conflict', ...(by ? { conflictBy: by } : {}) };
    }
    if (!(await activeOwner(ctx, ownerId)))
      return { status: 'failed', errorCode: 'owner_not_found' };
    let result: Awaited<ReturnType<typeof assignDealOwner>>;
    try {
      result = await assignDealOwner(tx, {
        workspaceId: principal.workspaceId,
        dealId: deal.id,
        ownerId,
        actor: memberActor(ctx),
        metadata: correlation(ctx),
      });
    } catch (err) {
      if (err instanceof TenantRefError) return { status: 'failed', errorCode: 'owner_not_found' };
      throw err;
    }
    if (!result) return { status: 'failed', errorCode: 'not_found' };
    const updated = result.deal;
    ctx.afterCommit(() => emitDealUpdated({ workspaceId: principal.workspaceId, deal: updated }));
    return {
      status: 'done',
      after: { owner_id: ownerId },
      undoPayload: { previous_owner_id: deal.ownerId },
    };
  },

  async undoItem(ctx, item): Promise<UndoItemResult> {
    const { tx, principal } = ctx;
    const placed = jsonString(item.after, 'owner_id');
    if (!placed) return { status: 'failed', errorCode: 'undo_payload' };
    const previous = jsonString(item.undoPayload, 'previous_owner_id');
    const deal = await lockDeal(tx, principal, item.targetId);
    if (!deal || deal.ownerId !== placed) return { status: 'undo_conflict' };
    let result: Awaited<ReturnType<typeof assignDealOwner>>;
    try {
      result = await assignDealOwner(tx, {
        workspaceId: principal.workspaceId,
        dealId: deal.id,
        ownerId: previous,
        actor: memberActor(ctx),
        metadata: correlation(ctx),
      });
    } catch (err) {
      // O responsável anterior saiu do workspace: não há para quem devolver.
      if (err instanceof TenantRefError) return { status: 'undo_conflict' };
      throw err;
    }
    if (!result) return { status: 'undo_conflict' };
    const updated = result.deal;
    ctx.afterCommit(() => emitDealUpdated({ workspaceId: principal.workspaceId, deal: updated }));
    return { status: 'undone' };
  },
};
