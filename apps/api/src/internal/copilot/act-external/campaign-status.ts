/**
 * `campaign.pause` / `campaign.resume` / `campaign.cancel` — status de campanha pelo Copiloto
 * (F73-S09; COPILOTO.md §6.2 e §8 R6). Sempre nível 4 (fala com cliente; cancelar não tem volta).
 *
 * - Uma ferramenta para o modelo (`propose_campaign_status`, `action`), três executores no motor
 *   (um por capacidade do catálogo): a permissão é a da AÇÃO (`campaign.pause` para pausar e
 *   retomar, `campaign.cancel` para cancelar), decidida pelo motor com o papel atual.
 * - Nunca usa `DELETE /api/campaigns/:id` (achado pré-existente: `campaign.edit` e sem conferir
 *   status). Tudo passa por `services/campaigns/lifecycle`: pausar e retomar são as MESMAS
 *   transições da rota; cancelar é o serviço estrito (status + `campaign.cancel` + números).
 * - Prévia: status atual → novo, enviadas, agendadas e custo (para quem vê custo); no cancelar,
 *   `alternatives: [{ kind: 'pause_instead' }]`. "Pausar em vez disso" é o `adjust` com
 *   `params.pause_instead = true`: a proposta de cancelar vira pausa (mesma proposta, versão
 *   nova, prévia e política recalculadas; o executor de cancelar declara o parâmetro).
 * - Desfazer: pausar ↔ retomar (enquanto o status for o que a ação deixou); cancelar: nenhum.
 */
import { z } from 'zod';
import type { CapabilityKey } from '@hm/shared';
import type {
  CapabilityExecutor,
  ExecutableItem,
  ExecuteItemResult,
  ExecutorContext,
  ExecutorPreview,
  ResolvedTargets,
  Target,
  TargetRef,
  UndoItemResult,
  UndoableItem,
} from '../core/executor-types';
import { defineEngineTool, type CopilotToolDefinition } from '../core/registry';
import {
  createExecutorRegistry,
  createProposalEngineDeps,
  proposeAction,
  proposeEnvelope,
  type ProposalEngineDeps,
} from '../../../services/copilot/proposals';
import { resolveVisible } from '../../../services/copilot/identity/scope';
import {
  cancelCampaign,
  loadCampaignProgress,
  pauseCampaign,
  resumeCampaign,
  type CampaignActor,
} from '../../../services/campaigns/lifecycle';
import { canSeeCosts } from '../read-ops/campaigns';
import {
  campaignPolicy,
  campaignStatusLabel,
  isValidCampaignTransition,
  type CampaignAction,
} from './policy';

export const CAMPAIGN_STATUS_TOOL_KEY = 'propose_campaign_status';

export const CAMPAIGN_STATUS_TOOL_DESCRIPTION =
  'Propõe pausar, retomar ou cancelar UMA campanha pelo id (action = pause | resume | cancel). ' +
  'Nada muda sem a pessoa revisar e confirmar na tela. A prévia mostra o status atual e o novo, quantas mensagens já saíram e quantas ainda iam sair. ' +
  'Cancelar não tem volta: se a pessoa só quer parar por um tempo, proponha pausar. Se ficar aguardando confirmação, diga isso e pare.';

export const CampaignStatusArgsSchema = z
  .object({
    campaign_id: z.string().uuid(),
    action: z.enum(['pause', 'resume', 'cancel']),
  })
  .strict();
export type CampaignStatusArgs = z.infer<typeof CampaignStatusArgsSchema>;

const CAPABILITY_OF: Readonly<Record<CampaignAction, CapabilityKey>> = {
  pause: 'campaign.pause',
  resume: 'campaign.resume',
  cancel: 'campaign.cancel',
};

const VERB: Readonly<Record<CampaignAction, string>> = {
  pause: 'Pausar',
  resume: 'Retomar',
  cancel: 'Cancelar',
};

const AFTER_STATUS: Readonly<Record<CampaignAction, string>> = {
  pause: 'paused',
  resume: 'running',
  cancel: 'cancelled',
};

function actorOf(ctx: ExecutorContext): CampaignActor {
  return {
    workspaceId: ctx.principal.workspaceId,
    memberId: ctx.principal.memberId,
    role: ctx.principal.role,
  };
}

async function resolveCampaign(ctx: ExecutorContext, id: string): Promise<Target | null> {
  const visible = await resolveVisible(ctx.tx, ctx.principal, { type: 'campaign', id });
  if (!visible) return null;
  const progress = await loadCampaignProgress(ctx.tx, visible.id);
  if (!progress) return null;
  return {
    type: 'campaign',
    id: progress.id,
    label: visible.label,
    // O status é a versão: a campanha em envio tem `updated_at` mexido pelo worker a cada tick,
    // e isso não é conflito; mudar de status é.
    expectedVersion: progress.status,
    state: { status: progress.status },
  };
}

/** Executor da capacidade `capability`, que aceita as ações `actions`. */
function makeCampaignExecutor(
  capability: CapabilityKey,
  actions: readonly CampaignAction[],
): CapabilityExecutor<CampaignStatusArgs> {
  const argsSchema = CampaignStatusArgsSchema.refine((a) => actions.includes(a.action), {
    message: `Ação inválida para ${capability}.`,
    path: ['action'],
  });
  const executor: CapabilityExecutor<CampaignStatusArgs> = {
    capability,
    argsSchema,
    requires: ['campaign.list'],
    ...(capability === 'campaign.cancel'
      ? {
          adjustableParams: ['pause_instead'] as const,
          applyAdjustments(args: CampaignStatusArgs, params: { pause_instead?: true }) {
            return params.pause_instead ? { ...args, action: 'pause' as const } : args;
          },
        }
      : {}),

    async resolveTargets(ctx, args): Promise<ResolvedTargets> {
      const target = await resolveCampaign(ctx, args.campaign_id);
      return target
        ? { targets: [target], dropped: [] }
        : { targets: [], dropped: [{ id: args.campaign_id, reason: 'not_found' }] };
    },

    async resolveIds(ctx, refs: readonly TargetRef[]): Promise<ResolvedTargets> {
      const targets: Target[] = [];
      const dropped: { id: string; reason: 'not_found' }[] = [];
      for (const ref of refs) {
        const t = ref.type === 'campaign' ? await resolveCampaign(ctx, ref.id) : null;
        if (t) targets.push(t);
        else dropped.push({ id: ref.id, reason: 'not_found' });
      }
      return { targets, dropped };
    },

    async preview(ctx, args, targets): Promise<ExecutorPreview> {
      const target = targets[0];
      const progress = target ? await loadCampaignProgress(ctx.tx, target.id) : null;
      const status = progress?.status ?? 'draft';
      const name = (target?.label ?? 'Campanha').slice(0, 120);
      const canPause = isValidCampaignTransition('pause', status);
      return {
        items: targets.map((t) => ({
          targetId: t.id,
          before: campaignStatusLabel(status),
          after: campaignStatusLabel(AFTER_STATUS[args.action]),
          plannedAfter: { status: AFTER_STATUS[args.action] },
        })),
        impact: {
          notified_members: [],
          affected_count: progress?.scheduled ?? 0,
          criterion: `${progress?.scheduled ?? 0} destinatário(s) ainda não receberam; ${progress?.alreadySent ?? 0} mensagem(ns) já saíram.`,
        },
        external: true,
        irreversible: args.action === 'cancel',
        notifiesMembers: false,
        summary: `${VERB[args.action]} a campanha "${name}"`,
        beforeAfter: [
          {
            label: 'Campanha',
            before: campaignStatusLabel(status),
            after: campaignStatusLabel(AFTER_STATUS[args.action]),
            count: targets.length,
          },
        ],
        ...(args.action === 'cancel' && canPause
          ? { alternatives: [{ kind: 'pause_instead' as const, label: 'Pausar em vez disso' }] }
          : {}),
      };
    },

    async policyCheck(ctx, args, targets) {
      const target = targets[0];
      const progress = target ? await loadCampaignProgress(ctx.tx, target.id) : null;
      if (!progress) {
        return [
          {
            key: 'campaign_status',
            status: 'block',
            label: 'Status da campanha',
            detail: 'Campanha não encontrada.',
          },
        ];
      }
      return campaignPolicy(args.action, progress, { canSeeCosts: canSeeCosts(ctx.principal) });
    },

    async executeItem(ctx, args, item: ExecutableItem): Promise<ExecuteItemResult> {
      const progress = await loadCampaignProgress(ctx.tx, item.targetId);
      if (!progress) return { status: 'failed', errorCode: 'not_found' };
      if (item.expectedVersion !== null && progress.status !== item.expectedVersion) {
        return { status: 'skipped_conflict', errorCode: 'status_changed' };
      }
      const origin = { via: ctx.source, proposalId: ctx.proposalId };
      const actor = actorOf(ctx);
      switch (args.action) {
        case 'pause': {
          const out = await pauseCampaign(ctx.tx, actor, item.targetId, origin);
          if (out.kind !== 'paused') return { status: 'failed', errorCode: out.kind };
          return {
            status: 'done',
            after: { status: out.campaign.status },
            undoPayload: { action: 'resume' },
          };
        }
        case 'resume': {
          const out = await resumeCampaign(ctx.tx, actor, item.targetId, origin);
          if (out.kind !== 'resumed') {
            return {
              status: 'failed',
              errorCode: out.kind === 'ended' ? 'campaign_ended' : out.kind,
            };
          }
          return {
            status: 'done',
            after: { status: out.campaign.status },
            undoPayload: { action: 'pause' },
          };
        }
        case 'cancel': {
          const out = await cancelCampaign(ctx.tx, actor, item.targetId, origin);
          if (out.kind !== 'cancelled') return { status: 'failed', errorCode: out.kind };
          return {
            status: 'done',
            after: {
              status: out.campaign.status,
              already_sent: out.already_sent,
              cancelled_scheduled: out.cancelled_scheduled,
              in_flight: out.in_flight,
              cost_used: out.cost_used,
            },
          };
        }
      }
    },

    /** Pausar ↔ retomar, só se o status ainda é o que a ação deixou. */
    async undoItem(ctx, item: UndoableItem): Promise<UndoItemResult> {
      const progress = await loadCampaignProgress(ctx.tx, item.targetId);
      if (!progress) return { status: 'failed', errorCode: 'not_found' };
      const expected = item.after?.['status'];
      if (typeof expected !== 'string' || progress.status !== expected) {
        return { status: 'undo_conflict' };
      }
      const back = item.undoPayload?.['action'];
      const origin = { via: ctx.source, proposalId: ctx.proposalId };
      if (back === 'resume') {
        const out = await resumeCampaign(ctx.tx, actorOf(ctx), item.targetId, origin);
        return out.kind === 'resumed' ? { status: 'undone' } : { status: 'undo_conflict' };
      }
      if (back === 'pause') {
        const out = await pauseCampaign(ctx.tx, actorOf(ctx), item.targetId, origin);
        return out.kind === 'paused' ? { status: 'undone' } : { status: 'undo_conflict' };
      }
      return { status: 'failed', errorCode: 'not_undoable' };
    },

    /** Pausar e retomar voltam; cancelar não. */
    allowsUndoAtLevel4(args: CampaignStatusArgs): boolean {
      return args.action !== 'cancel';
    },
  };
  return executor;
}

export const campaignPauseExecutor = makeCampaignExecutor('campaign.pause', ['pause']);
export const campaignResumeExecutor = makeCampaignExecutor('campaign.resume', ['resume']);
/** Aceita `pause` só depois do "Pausar em vez disso" (o ajuste). */
export const campaignCancelExecutor = makeCampaignExecutor('campaign.cancel', ['cancel', 'pause']);

export const CAMPAIGN_EXECUTORS: readonly CapabilityExecutor[] = [
  campaignPauseExecutor,
  campaignResumeExecutor,
  campaignCancelExecutor,
];

function executorFor(action: CampaignAction): CapabilityExecutor<CampaignStatusArgs> {
  switch (CAPABILITY_OF[action]) {
    case 'campaign.cancel':
      return campaignCancelExecutor;
    case 'campaign.resume':
      return campaignResumeExecutor;
    default:
      return campaignPauseExecutor;
  }
}

/**
 * `propose_campaign_status`: UMA ferramenta para o modelo, despachada para o executor da
 * capacidade da ação. Mesmo handler do `makeProposeTool` (motor de propostas: valida, resolve,
 * classifica, autoriza com o papel ATUAL e grava a proposta), só que escolhendo o executor pela
 * `action`. A oferta ao modelo usa `campaign.pause` (o menor degrau): quem só pode pausar vê a
 * ferramenta, e um pedido de cancelar vira proposta `blocked` (papel) com "Pedir aprovação".
 */
export function makeCampaignStatusTool(
  options: { readonly deps?: () => ProposalEngineDeps } = {},
): CopilotToolDefinition {
  let cached: ProposalEngineDeps | null = null;
  const depsOf = (): ProposalEngineDeps =>
    options.deps?.() ??
    (cached ??= createProposalEngineDeps({
      executors: createExecutorRegistry(CAMPAIGN_EXECUTORS),
    }));
  return defineEngineTool<CampaignStatusArgs>({
    key: CAMPAIGN_STATUS_TOOL_KEY,
    capability: 'campaign.pause',
    description: CAMPAIGN_STATUS_TOOL_DESCRIPTION,
    args: CampaignStatusArgsSchema,
    requires: ['campaign.list'],
    taintsTurn: false,
    async handler(ctx, args) {
      const outcome = await proposeAction(
        depsOf(),
        {
          tx: ctx.tx,
          principal: ctx.principal,
          source: 'copilot',
          turnId: ctx.turn.turnId,
          sessionId: ctx.turn.sessionId,
          turnTainted: ctx.turn.tainted,
          afterCommit: (fn) => ctx.afterCommit(fn),
        },
        executorFor(args.action),
        args,
      );
      return proposeEnvelope(outcome);
    },
  });
}

export const campaignStatusTool = makeCampaignStatusTool();
