/**
 * `flow.trigger` — disparar um flow publicado para contatos (F73-S09; COPILOTO.md §6.2).
 * Sempre nível 4 (o catálogo marca o flow como externo: ele pode falar com o cliente).
 *
 * - Disparo: o MESMO da rota `POST /api/flows/:id/trigger`, por import (`flowEngine` de
 *   `routes/flows/engine.ts`): `createExecution` grava a execução e o primeiro passo na outbox
 *   numa transação própria da engine. Só flow `active` com versão publicada.
 * - Um item por contato, idempotente: a execução carrega `trigger.copilot_item_id`; se o item
 *   rodar de novo (retomada pela varredura depois de uma queda entre o disparo e o fechamento do
 *   item), a execução já existente é reconhecida e NÃO há segundo disparo.
 * - Conversa: a mais recente que o membro VÊ (régua da inbox); sem conversa, o flow roda sem
 *   ela (nós de envio não têm para onde enviar — a prévia avisa).
 * - Consentimento: se o flow tem nó de envio, contato suprimido (ou sem consentimento para a
 *   finalidade) é pulado (`skipped_policy`). Os nós de envio do flow passam ainda pelo portão do
 *   worker (última barreira).
 * - Desfazer: cancela as execuções que ainda não terminaram (`cancelFlowExecution`). O que o
 *   flow já enviou não volta.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DbTx } from '@hm/db';
import { BATCH_LIMIT, type PolicyCheck } from '@hm/shared';
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
import { makeProposeTool } from '../../../services/copilot/proposals';
import { checkOutboundInTx } from '../../../services/consent';
import {
  contactScope,
  conversationScope,
  VISIBLE_LABEL_MAX,
} from '../../../services/copilot/identity/scope';
import { isChannelKind } from '../../../services/messaging/send-on-behalf';
import { flowEngine } from '../../../routes/flows/engine';

const { flows, flowVersions, flowExecutions, contacts, conversations, channels } = schema;

export const TRIGGER_FLOW_TOOL_KEY = 'propose_trigger_flow';

export const TRIGGER_FLOW_TOOL_DESCRIPTION =
  'Propõe disparar um flow PUBLICADO (flow_id) para até 200 contatos (contact_ids). Nada roda sem a pessoa revisar e confirmar na tela. ' +
  'A prévia diz se o flow pode enviar mensagens. Se ficar aguardando confirmação, diga isso e pare.';

export const TriggerFlowArgsSchema = z
  .object({
    flow_id: z.string().uuid(),
    contact_ids: z.array(z.string().uuid()).min(1).max(BATCH_LIMIT),
  })
  .strict();
export type TriggerFlowArgs = z.infer<typeof TriggerFlowArgsSchema>;

/** Tipos de nó que falam com o contato (ou podem falar, como a IA e o subflow). */
export const SENDING_NODE_TYPES: ReadonlySet<string> = new Set([
  'message',
  'interactive',
  'template',
  'meta_flow',
  'ai_action',
  'go_to_flow',
]);

const TERMINAL_EXECUTION_STATUSES = ['completed', 'failed', 'cancelled'] as const;

interface FlowInfo {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly published: boolean;
  readonly sendingNodes: number;
}

function nodeTypeOf(node: unknown): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const type = (node as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : null;
}

/** Flow do workspace + a versão publicada corrente (a que roda). */
async function loadFlow(tx: DbTx, flowId: string): Promise<FlowInfo | null> {
  const [flow] = await tx
    .select({ id: flows.id, name: flows.name, status: flows.status })
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1);
  if (!flow) return null;
  const [version] = await tx
    .select({ nodes: flowVersions.nodes })
    .from(flowVersions)
    .where(eq(flowVersions.flowId, flowId))
    .orderBy(desc(flowVersions.version))
    .limit(1);
  const nodes = Array.isArray(version?.nodes) ? version.nodes : [];
  return {
    ...flow,
    published: version !== undefined,
    sendingNodes: nodes.filter((n) => SENDING_NODE_TYPES.has(nodeTypeOf(n) ?? '')).length,
  };
}

function isRunnable(flow: FlowInfo | null): flow is FlowInfo {
  return flow !== null && flow.status === 'active' && flow.published;
}

function labelOf(displayName: string | null, profileName: string | null): string {
  const raw = (displayName ?? profileName ?? '').trim();
  const value = raw.length > 0 ? raw : 'Contato sem nome';
  return value.length > VISIBLE_LABEL_MAX ? `${value.slice(0, VISIBLE_LABEL_MAX - 1)}…` : value;
}

/** Contatos visíveis + a conversa mais recente que o membro vê de cada um. */
async function resolveContacts(
  ctx: ExecutorContext,
  ids: readonly string[],
): Promise<ResolvedTargets> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { targets: [], dropped: [] };
  const scope = contactScope(ctx.principal);
  const rows = await ctx.tx
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      profileName: contacts.profileName,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, ctx.principal.workspaceId),
        inArray(contacts.id, unique),
        isNull(contacts.deletedAt),
        ...(scope ? [scope] : []),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const convScope = conversationScope(ctx.principal);
  const convs = rows.length
    ? await ctx.tx
        .selectDistinctOn([conversations.contactId], {
          id: conversations.id,
          contactId: conversations.contactId,
          provider: channels.provider,
        })
        .from(conversations)
        .innerJoin(channels, eq(channels.id, conversations.channelId))
        .where(
          and(
            eq(conversations.workspaceId, ctx.principal.workspaceId),
            inArray(conversations.contactId, [...byId.keys()]),
            ...(convScope ? [convScope] : []),
          ),
        )
        .orderBy(
          conversations.contactId,
          sql`${conversations.lastMessageAt} desc nulls last`,
          desc(conversations.id),
        )
    : [];
  const convByContact = new Map(
    convs.flatMap((c) => (c.contactId ? [[c.contactId, c] as const] : [])),
  );
  const targets: Target[] = [];
  const dropped: { id: string; reason: 'not_found' }[] = [];
  for (const id of unique) {
    const c = byId.get(id);
    if (!c) {
      dropped.push({ id, reason: 'not_found' });
      continue;
    }
    const conv = convByContact.get(id);
    targets.push({
      type: 'contact',
      id,
      label: labelOf(c.displayName, c.profileName),
      expectedVersion: null,
      state: { conversation_id: conv?.id ?? null, provider: conv?.provider ?? null },
    });
  }
  return { targets, dropped };
}

function stateOf(state: Record<string, unknown> | null | undefined): {
  conversationId: string | null;
  provider: string | null;
} {
  const conv = state?.['conversation_id'];
  const provider = state?.['provider'];
  return {
    conversationId: typeof conv === 'string' ? conv : null,
    provider: typeof provider === 'string' ? provider : null,
  };
}

/** Contato pode receber pelo canal da conversa? (só importa se o flow envia) */
async function consentAllows(
  ctx: ExecutorContext,
  contactId: string,
  provider: string | null,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (provider === null || !isChannelKind(provider)) return { allowed: true };
  const decision = await checkOutboundInTx(ctx.tx, {
    workspaceId: ctx.principal.workspaceId,
    contactId,
    channel: provider,
    purpose: 'transactional',
    now: ctx.now,
  });
  return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
}

export const triggerFlowExecutor: CapabilityExecutor<TriggerFlowArgs> = {
  capability: 'flow.trigger',
  argsSchema: TriggerFlowArgsSchema,
  requires: ['contact.view'],

  async resolveTargets(ctx, args): Promise<ResolvedTargets> {
    const flow = await loadFlow(ctx.tx, args.flow_id);
    // Flow inexistente (ou de outro workspace, invisível pela RLS): nada a disparar.
    if (!flow) {
      return { targets: [], dropped: args.contact_ids.map((id) => ({ id, reason: 'not_found' })) };
    }
    return resolveContacts(ctx, args.contact_ids);
  },

  async resolveIds(ctx, refs: readonly TargetRef[]): Promise<ResolvedTargets> {
    const contactRefs = refs.filter((r) => r.type === 'contact');
    const out = await resolveContacts(
      ctx,
      contactRefs.map((r) => r.id),
    );
    const other = refs
      .filter((r) => r.type !== 'contact')
      .map((r) => ({ id: r.id, reason: 'not_found' as const }));
    return { targets: out.targets, dropped: [...out.dropped, ...other] };
  },

  async preview(ctx, args, targets): Promise<ExecutorPreview> {
    const flow = await loadFlow(ctx.tx, args.flow_id);
    const sends = (flow?.sendingNodes ?? 0) > 0;
    const name = (flow?.name ?? 'Flow').slice(0, 120);
    return {
      items: targets.map((t) => {
        const s = stateOf(t.state);
        return {
          targetId: t.id,
          before: null,
          after: sends && s.conversationId === null ? 'Flow inicia (sem conversa)' : 'Flow inicia',
          plannedAfter: { flow_id: args.flow_id },
        };
      }),
      impact: {
        notified_members: [],
        affected_count: targets.length,
        criterion: sends
          ? `O flow "${name}" pode enviar mensagens aos contatos.`.slice(0, 300)
          : `O flow "${name}" não tem nó de envio.`.slice(0, 300),
      },
      external: true,
      irreversible: false,
      notifiesMembers: false,
      summary: `Disparar o flow "${name}" para ${targets.length === 1 ? '1 contato' : `${targets.length} contatos`}`,
    };
  },

  async policyCheck(ctx, args, targets): Promise<PolicyCheck[]> {
    const flow = await loadFlow(ctx.tx, args.flow_id);
    const checks: PolicyCheck[] = [];
    checks.push(
      isRunnable(flow)
        ? {
            key: 'flow_published',
            status: 'ok',
            label: 'Flow publicado',
            detail: `"${flow.name.slice(0, 120)}" está ativo.`,
          }
        : {
            key: 'flow_published',
            status: 'block',
            label: 'Flow publicado',
            detail: flow
              ? 'O flow não está ativo ou não tem versão publicada.'
              : 'Flow não encontrado.',
          },
    );
    const sends = (flow?.sendingNodes ?? 0) > 0;
    if (!sends) {
      checks.push({
        key: 'flow_sends',
        status: 'ok',
        label: 'Mensagens',
        detail: 'O flow não tem nó de envio.',
      });
      return checks;
    }
    checks.push({
      key: 'flow_sends',
      status: 'warn',
      label: 'Mensagens',
      detail: `O flow pode enviar mensagens (${flow?.sendingNodes ?? 0} nó(s) de envio).`,
    });
    let denied = 0;
    let withoutConversation = 0;
    for (const t of targets) {
      const s = stateOf(t.state);
      if (s.conversationId === null) withoutConversation++;
      const ok = await consentAllows(ctx, t.id, s.provider);
      if (!ok.allowed) denied++;
    }
    checks.push(
      denied === 0
        ? {
            key: 'consent',
            status: 'ok',
            label: 'Consentimento',
            detail: `${targets.length} de ${targets.length} podem receber.`,
          }
        : {
            key: 'consent',
            status: denied === targets.length ? 'block' : 'warn',
            label: 'Consentimento',
            detail: `${targets.length - denied} de ${targets.length} · ${denied} ${denied === 1 ? 'será pulado' : 'serão pulados'}.`,
          },
    );
    if (withoutConversation > 0) {
      checks.push({
        key: 'recipients',
        status: 'warn',
        label: 'Conversas',
        detail: `${withoutConversation} sem conversa que você vê: os nós de envio não terão para onde enviar.`,
      });
    }
    return checks;
  },

  async executeItem(ctx, args, item: ExecutableItem): Promise<ExecuteItemResult> {
    // Idempotente: um disparo por item, mesmo que o item rode de novo.
    const [existing] = await ctx.tx
      .select({ id: flowExecutions.id })
      .from(flowExecutions)
      .where(
        and(
          eq(flowExecutions.workspaceId, ctx.principal.workspaceId),
          eq(flowExecutions.flowId, args.flow_id),
          eq(flowExecutions.contactId, item.targetId),
          sql`${flowExecutions.variables} #>> '{trigger,copilot_item_id}' = ${item.id}`,
        ),
      )
      .limit(1);
    if (existing) {
      return {
        status: 'done',
        after: { execution_id: existing.id },
        undoPayload: { execution_id: existing.id },
      };
    }
    const flow = await loadFlow(ctx.tx, args.flow_id);
    if (!isRunnable(flow)) return { status: 'failed', errorCode: 'flow_not_active' };

    // Conversa e consentimento relidos agora, sob as permissões de quem executa.
    const fresh = await resolveContacts(ctx, [item.targetId]);
    const target = fresh.targets[0];
    if (!target) return { status: 'failed', errorCode: 'not_found' };
    const s = stateOf(target.state);
    if (flow.sendingNodes > 0) {
      const ok = await consentAllows(ctx, item.targetId, s.provider);
      if (!ok.allowed) return { status: 'skipped_policy', errorCode: ok.reason };
    }

    // O disparo existente (mesmo da rota manual). A engine grava execução + primeiro passo na
    // outbox numa transação própria; a chave `copilot_item_id` torna a repetição inofensiva.
    const { executionId } = await flowEngine.triggerFlow({
      workspaceId: ctx.principal.workspaceId,
      flowId: args.flow_id,
      contactId: item.targetId,
      ...(s.conversationId ? { conversationId: s.conversationId } : {}),
      triggeredBy: 'manual',
      triggeredByMemberId: ctx.principal.memberId,
      triggerData: { via: ctx.source, proposal_id: ctx.proposalId, copilot_item_id: item.id },
    });
    return {
      status: 'done',
      after: { execution_id: executionId },
      undoPayload: { execution_id: executionId },
    };
  },

  /** Cancela a execução se ela ainda não terminou. Terminada = já rodou: conflito. */
  async undoItem(ctx, item: UndoableItem): Promise<UndoItemResult> {
    const executionId = item.undoPayload?.['execution_id'];
    if (typeof executionId !== 'string') return { status: 'failed', errorCode: 'not_undoable' };
    const [row] = await ctx.tx
      .select({ status: flowExecutions.status })
      .from(flowExecutions)
      .where(
        and(
          eq(flowExecutions.id, executionId),
          eq(flowExecutions.workspaceId, ctx.principal.workspaceId),
        ),
      )
      .limit(1);
    if (!row) return { status: 'failed', errorCode: 'not_found' };
    if ((TERMINAL_EXECUTION_STATUSES as readonly string[]).includes(row.status)) {
      return { status: 'undo_conflict' };
    }
    await flowEngine.cancelFlowExecution(ctx.principal.workspaceId, executionId, 'copilot_undo');
    return { status: 'undone' };
  },

  /** O desfazer cancela as execuções pendentes (catálogo: `undoable`). */
  allowsUndoAtLevel4(): boolean {
    return true;
  },
};

export const triggerFlowTool = makeProposeTool(triggerFlowExecutor, {
  key: TRIGGER_FLOW_TOOL_KEY,
  description: TRIGGER_FLOW_TOOL_DESCRIPTION,
});
