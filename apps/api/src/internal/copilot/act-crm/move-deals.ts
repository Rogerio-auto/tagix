/**
 * `deal.move` — mover negócios de estágio pelo Copiloto (F73-S08; o fluxo da A4: "mover os
 * parados há 7 dias para Reativação").
 *
 * Regras de domínio: as MESMAS da tela (`moveDeal` → `moveDealToStage`: `transition_rules`,
 * `deal_history`, seam e outbox), com `actor = membro` e `metadata = { via, proposal_id }`.
 *
 * - Alvos: `deal_ids` (até 200) ou o filtro do `list_deals`, sob `dealScope` (AGENT: só os que
 *   vê). O filtro fica preso ao funil do estágio de destino; quem já está no destino sai da
 *   lista (mover para onde já está não é ação).
 * - Prévia: estágio antes → depois por grupo, Δ na previsão com a `p(estágio)` do
 *   `forecast_revenue`, quem é avisado, o critério e as automações do estágio
 *   (`stage-effects.ts`): mensagem, flow ou conversão tornam a movimentação EXTERNA (nível 4).
 * - Execução por item: relê travado e sob o escopo de quem executa; versão divergente
 *   (`updated_at`|estágio|responsável) → `skipped_conflict` com quem editou; destino que exige
 *   aprovação no Pipeline → `skipped_policy`; `TransitionError` → `failed` com o código.
 *   `deal:stage_changed` e o agendamento das automações saem SÓ depois do commit do item.
 * - Avisar responsáveis (`notify_owners`, ajustável): nota interna na conversa do negócio
 *   mencionando o responsável ("Movido pelo Copiloto a pedido de <nome>"), pelo mecanismo
 *   `note:mentioned`. Nada vai ao cliente.
 * - Desfazer: volta ao estágio de origem com `origin: 'undo'` (sem `allowedFromStageIds`, sem
 *   agendar automação, cancelando as pendentes desta movimentação) e apaga a nota de aviso.
 *   Só age se o negócio ainda está no estágio para onde foi movido.
 */
import { z } from 'zod';
import type { PolicyCheck, ProposalPreview } from '@hm/shared';
import {
  createNote,
  deleteNote,
  notifyNoteMentions,
} from '../../../services/conversation-notes/create';
import { TransitionError } from '../../../services/deal-move';
import { moveDeal } from '../../../services/deals/move';
import type {
  CapabilityExecutor,
  ExecutableItem,
  ExecuteItemResult,
  ExecutorContext,
  ExecutorPreview,
  ResolvedTargets,
  Target,
  UndoItemResult,
  UndoableItem,
} from '../core/executor-types';
import { loadWorkspaceFormat } from '../read-crm/common';
import {
  correlation,
  jsonString,
  lastDealEditor,
  memberActor,
  memberNames,
  memberRefs,
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
import { forecastDelta, loadDecidedStats } from './forecast-impact';
import { loadStages, stageEffects, type StageRef } from './stage-effects';

export const MoveDealsArgsSchema = z
  .object({
    ...dealTargetShape,
    to_stage_id: z.string().uuid().describe('Estágio de destino (do mesmo funil dos negócios).'),
    notify_owners: z
      .boolean()
      .default(false)
      .describe('Avisar os responsáveis com uma nota interna (o cliente não vê).'),
  })
  .strict()
  .refine(oneDealSelector, { message: 'Use deal_ids OU filter (um dos dois).' });
export type MoveDealsArgs = z.infer<typeof MoveDealsArgsSchema>;

export const MOVE_DEALS_TOOL_DESCRIPTION =
  'Propõe mover negócios de estágio no pipeline, por ids (deal_ids, até 200) ou pelo mesmo filtro do list_deals ' +
  '(ex.: parados há 7 dias ou mais em um estágio). O sistema mostra a prévia (antes e depois, impacto na previsão, ' +
  'automações do estágio) e decide se precisa de confirmação; respeita as regras do Pipeline. notify_owners avisa os ' +
  'responsáveis por nota interna. Se ficar aguardando confirmação, diga isso e pare.';

const STATE_STAGE = 'stage_id';

function stageName(map: ReadonlyMap<string, StageRef>, id: string | null): string {
  return (id ? map.get(id)?.name : undefined) ?? 'Estágio';
}

function stateStage(t: Target): string | null {
  const v = t.state[STATE_STAGE];
  return typeof v === 'string' ? v : null;
}

/** Responsáveis que recebem o aviso: dono ≠ quem pede, com conversa vinculada (onde vai a nota). */
function ownersToNotify(targets: readonly Target[], actorId: string): string[] {
  const out = new Set<string>();
  for (const t of targets) {
    const owner = t.state['owner_id'];
    const conv = t.state['conversation_id'];
    if (typeof owner === 'string' && owner !== actorId && typeof conv === 'string') out.add(owner);
  }
  return [...out];
}

async function requesterName(ctx: ExecutorContext): Promise<string> {
  const names = await memberNames(ctx.tx, ctx.principal.workspaceId, [ctx.requestedByMemberId]);
  return names.get(ctx.requestedByMemberId) ?? 'um membro da equipe';
}

export const moveDealsExecutor: CapabilityExecutor<MoveDealsArgs> = {
  capability: 'deal.move',
  argsSchema: MoveDealsArgsSchema,
  requires: ['pipeline.view'],
  adjustableParams: ['target_stage_id', 'notify_members'],

  applyAdjustments(args, params) {
    return {
      ...args,
      ...(params.target_stage_id ? { to_stage_id: params.target_stage_id } : {}),
      ...(params.notify_members !== undefined ? { notify_owners: params.notify_members } : {}),
    };
  },

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const stages = await loadStages(ctx.tx, ctx.principal.workspaceId, [args.to_stage_id]);
    const to = stages.get(args.to_stage_id);
    if (!to) {
      return {
        targets: [],
        dropped: (args.deal_ids ?? []).map((id) => ({ id, reason: 'not_found' as const })),
      };
    }
    // O filtro fica preso ao funil do destino (mover entre funis não é esta ação).
    if (args.filter?.pipeline_id && args.filter.pipeline_id !== to.pipelineId) {
      return { targets: [], dropped: [] };
    }
    const loaded = await loadDealTargets(
      ctx,
      args.filter ? { filter: { ...args.filter, pipeline_id: to.pipelineId } } : args,
    );
    return {
      targets: loaded.rows.filter((r) => r.stageId !== to.id).map(dealTarget),
      dropped: loaded.dropped,
    };
  },

  resolveIds(ctx, refs) {
    return resolveDealIds(ctx, refs);
  },

  async preview(ctx, args, targets): Promise<ExecutorPreview> {
    const { tx, principal } = ctx;
    const fromIds = targets.map(stateStage).filter((s): s is string => s !== null);
    const stages = await loadStages(tx, principal.workspaceId, [args.to_stage_id, ...fromIds]);
    const to = stages.get(args.to_stage_id);
    if (!to) throw new Error('copilot deal.move: estágio de destino sumiu.');
    const fromStages = [...new Set(fromIds)]
      .map((id) => stages.get(id))
      .filter((s): s is StageRef => s !== undefined);
    const effects = await stageEffects(tx, to, fromStages);
    const fmt = await loadWorkspaceFormat(tx, principal.workspaceId);

    const owners = args.notify_owners ? ownersToNotify(targets, principal.memberId) : [];
    const notifyIds = [...new Set([...owners, ...effects.notifyMemberIds])];
    const names = await memberNames(tx, principal.workspaceId, notifyIds);

    const moved = targets.map((t) => ({
      fromStageId: stateStage(t) ?? '',
      pipelineId: typeof t.state['pipeline_id'] === 'string' ? t.state['pipeline_id'] : '',
      valueCents: typeof t.state['value_cents'] === 'number' ? t.state['value_cents'] : 0,
      open: t.state['open'] === true,
    }));
    const anyOpen = moved.some((m) => m.open);
    const stats = anyOpen
      ? await loadDecidedStats(tx, principal, [...new Set(moved.map((m) => m.pipelineId))])
      : null;

    // Antes → depois, agrupado por estágio de origem; depois as automações e a aprovação.
    const byFrom = new Map<string, number>();
    for (const id of fromIds) byFrom.set(id, (byFrom.get(id) ?? 0) + 1);
    const rows: ProposalPreview['before_after'] = [...byFrom.entries()].map(([from, count]) => ({
      label: 'Estágio',
      before: stageName(stages, from).slice(0, 200),
      after: to.name.slice(0, 200),
      count,
    }));
    for (const line of effects.lines) {
      rows.push({
        label: line.external ? 'Automação do estágio (fala com o cliente)' : 'Automação do estágio',
        before: '—',
        after: line.text,
        count: line.trigger === 'on_enter' ? targets.length : (byFrom.get(line.stageId) ?? 0),
      });
    }
    if (effects.requiresApproval) {
      rows.push({
        label: 'Regra do Pipeline',
        before: '—',
        after: `${to.name} exige aprovação no Pipeline: nenhum negócio será movido por aqui`.slice(
          0,
          200,
        ),
        count: targets.length,
      });
    }

    const criterion = args.filter
      ? await describeDealFilter(tx, principal, args.filter, fmt)
      : describeSelection(targets.length, 'negócio', 'negócios');
    const fromLabel =
      fromStages.length === 1 && fromStages[0]
        ? `de ${fromStages[0].name}`
        : `de ${plural(fromStages.length, 'estágio', 'estágios')}`;

    return {
      items: targets.map((t) => ({
        targetId: t.id,
        before: stageName(stages, stateStage(t)).slice(0, 200),
        after: to.name.slice(0, 200),
        plannedAfter: { stage_id: to.id },
      })),
      impact: {
        ...(stats ? { forecast_delta_brl: forecastDelta(stats, moved, to.id) } : {}),
        notified_members: memberRefs(notifyIds, names),
        affected_count: targets.length,
        criterion,
      },
      external: effects.external,
      irreversible: false,
      notifiesMembers: notifyIds.length > 0,
      summary: sentence(
        `Mover ${plural(targets.length, 'negócio', 'negócios')} ${fromLabel} para ${to.name}`,
        500,
      ),
      beforeAfter: rows.slice(0, 20),
    };
  },

  /** Nível 4 (automação que fala com o cliente): as linhas da automação e a regra do Pipeline. */
  async policyCheck(ctx, args, targets): Promise<PolicyCheck[]> {
    const fromIds = targets.map(stateStage).filter((s): s is string => s !== null);
    const stages = await loadStages(ctx.tx, ctx.principal.workspaceId, [
      args.to_stage_id,
      ...fromIds,
    ]);
    const to = stages.get(args.to_stage_id);
    if (!to) return [];
    const effects = await stageEffects(
      ctx.tx,
      to,
      [...new Set(fromIds)]
        .map((id) => stages.get(id))
        .filter((s): s is StageRef => s !== undefined),
    );
    const checks: PolicyCheck[] = effects.lines
      .filter((l) => l.external)
      .slice(0, 19)
      .map((l) => ({
        key: 'stage_automation',
        status: 'warn' as const,
        label: 'Automação do estágio',
        detail: l.text,
      }));
    if (effects.requiresApproval) {
      checks.push({
        key: 'stage_approval',
        status: 'warn',
        label: 'Aprovação no Pipeline',
        detail: `${to.name} exige aprovação no Pipeline: os negócios não serão movidos pelo Copiloto.`,
      });
    }
    return checks;
  },

  async executeItem(ctx, args, item: ExecutableItem): Promise<ExecuteItemResult> {
    const { tx, principal } = ctx;
    const deal = await lockDeal(tx, principal, item.targetId);
    if (!deal) return { status: 'failed', errorCode: 'not_found' };
    if (dealVersion(deal) !== item.expectedVersion) {
      const by = await lastDealEditor(tx, deal.id, jsonString(item.before, 'version'));
      return { status: 'skipped_conflict', ...(by ? { conflictBy: by } : {}) };
    }
    const to = (await loadStages(tx, principal.workspaceId, [args.to_stage_id])).get(
      args.to_stage_id,
    );
    if (!to) return { status: 'failed', errorCode: 'stage_not_found' };
    if (to.pipelineId !== deal.pipelineId) {
      return { status: 'failed', errorCode: 'stage_not_in_pipeline' };
    }
    if (to.requiresApproval) return { status: 'skipped_policy', errorCode: 'requires_approval' };

    try {
      await moveDeal(tx, {
        dealId: deal.id,
        newStageId: to.id,
        actor: memberActor(ctx),
        workspaceId: principal.workspaceId,
        metadata: correlation(ctx),
        afterCommit: (fn) => ctx.afterCommit(fn),
      });
    } catch (err) {
      if (err instanceof TransitionError) return { status: 'failed', errorCode: err.code };
      if (
        err instanceof Error &&
        (err.message === 'deal_not_found' || err.message === 'stage_not_found')
      ) {
        return { status: 'failed', errorCode: err.message };
      }
      throw err;
    }

    let noteId: string | null = null;
    if (
      args.notify_owners &&
      deal.ownerId &&
      deal.ownerId !== principal.memberId &&
      deal.conversationId
    ) {
      const note = await createNote(tx, {
        workspaceId: principal.workspaceId,
        conversationId: deal.conversationId,
        author: { memberId: principal.memberId, role: principal.role },
        body: `Movido pelo Copiloto a pedido de ${await requesterName(ctx)}: ${deal.title.slice(0, 120)} agora está em ${to.name}.`,
        mentions: [deal.ownerId],
      });
      if (note) {
        noteId = note.id;
        ctx.afterCommit(() => notifyNoteMentions(principal.workspaceId, note));
      }
    }

    return {
      status: 'done',
      after: { stage_id: to.id },
      undoPayload: { from_stage_id: deal.stageId, ...(noteId ? { note_id: noteId } : {}) },
    };
  },

  async undoItem(ctx, item: UndoableItem): Promise<UndoItemResult> {
    const { tx, principal } = ctx;
    const movedTo = jsonString(item.after, 'stage_id');
    const back = jsonString(item.undoPayload, 'from_stage_id');
    if (!movedTo || !back) return { status: 'failed', errorCode: 'undo_payload' };
    const deal = await lockDeal(tx, principal, item.targetId);
    // Sumiu do escopo de quem desfaz, ou já saiu de onde o Copiloto o deixou: não mexe.
    if (!deal || deal.stageId !== movedTo) return { status: 'undo_conflict' };
    const origin = (await loadStages(tx, principal.workspaceId, [back])).get(back);
    if (!origin) return { status: 'failed', errorCode: 'stage_not_found' };
    if (origin.requiresApproval) return { status: 'failed', errorCode: 'requires_approval' };
    try {
      await moveDeal(tx, {
        dealId: deal.id,
        newStageId: back,
        actor: memberActor(ctx),
        workspaceId: principal.workspaceId,
        origin: 'undo',
        metadata: correlation(ctx),
        afterCommit: (fn) => ctx.afterCommit(fn),
      });
    } catch (err) {
      if (err instanceof TransitionError) return { status: 'failed', errorCode: err.code };
      throw err;
    }
    const noteId = jsonString(item.undoPayload, 'note_id');
    if (noteId) await deleteNote(tx, { noteId });
    return { status: 'undone' };
  },
};
