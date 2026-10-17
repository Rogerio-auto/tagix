/**
 * Propor uma ação (ADR-004 §1). O modelo NUNCA executa nível 3 ou 4: para ele, toda escrita é
 * `propose_<capability>`, e este handler decide, nesta ordem:
 *
 *   1. valida `args` (Zod `.strict()` do executor);
 *   2. resolve os alvos sob o escopo do membro; o que ele não vê é descartado e informado;
 *   3. lê o estado e grava `expected_version` por alvo;
 *   4. classifica (`classifyRisk`, com `turn_tainted` lido do BANCO, nunca do modelo);
 *   5. autoriza (papel ∧ matriz ∧ assinatura ∧ orçamento). Negado → proposta `blocked`;
 *   6. monta a prévia e, no nível 4, a checagem de política;
 *   7. nível 2 executa na hora (recibo com Desfazer); 3 e 4 ficam `proposed` (15/10 min).
 *
 * A resposta ao modelo é curta (`awaiting_confirmation` + resumo, recibo ou bloqueio), e o
 * evento público (`action_*`) sai do que o Node gravou, nunca do texto do modelo.
 *
 * O piloto automático (F73-S13) usa o MESMO caminho com `source: 'autopilot'`.
 */
import { eq } from 'drizzle-orm';
import {
  COPILOT_PROPOSAL_LEASE_SECONDS,
  copilotProposalsRepo,
  schema,
  type CopilotActionItemRow,
  type CopilotBlockedReason,
  type CopilotProposalRow,
  type CopilotProposalSource,
  type DbTx,
  type InsertCopilotActionItem,
} from '@hm/db';
import {
  ActionBlockedEventSchema,
  ActionProposedEventSchema,
  ActionReceiptEventSchema,
  BATCH_LIMIT,
  CAPABILITIES,
  COPILOT_STREAM_VERSION,
  PolicyCheckSchema,
  ProposalPreviewSchema,
  classifyRisk,
  isRiskRefused,
  type CopilotToolEnvelope,
  type PolicyCheck,
  type ProposalDTO,
  type ProposalPreview,
} from '@hm/shared';
import type {
  CapabilityExecutor,
  ExecutorContext,
  ExecutorPreview,
  Target,
} from '../../../internal/copilot/core/executor-types';
import {
  defineCopilotTool,
  type CopilotToolContext,
  type CopilotToolDefinition,
} from '../../../internal/copilot/core/registry';
import { authorizeCapability, type CopilotDenialReason } from '../identity/authorize';
import { loadCopilotBudget } from '../identity/budget';
import type { CopilotPrincipal } from '../identity/principal';
import { listApprovers } from './approval';
import { recordProposalAudit } from './audit';
import { createExecutorRegistry, createProposalEngineDeps } from './deps';
import { buildProposalDTO, capabilityOf } from './dto';
import { runProposalExecution, savepointRunner, startProposalExecution } from './execute';
import { auditCounts, countItems, encodeAfter, encodeBefore, itemReason } from './items';
import { PROPOSAL_TTL_SECONDS, type ProposalEngineDeps } from './types';

/** Quem pede e de onde. Tudo resolvido no servidor. */
export interface ProposeContext {
  /** Transação RLS do workspace do principal. */
  readonly tx: DbTx;
  readonly principal: CopilotPrincipal;
  readonly source: CopilotProposalSource;
  readonly turnId: string | null;
  readonly sessionId: string | null;
  /**
   * Contaminação conhecida pelo chamador. Ausente: lida de `copilot_turns.tainted` (se houver
   * turno). Só pode ENDURECER: `false` aqui não limpa um turno contaminado no banco.
   */
  readonly turnTainted?: boolean;
  /**
   * F73-S13: a pessoa já confirmou ESTA prévia (aprovar sugestões do piloto). Níveis 2 e 3
   * executam sem novo clique; o nível 4 continua exigindo o confirmar com "Revisei".
   */
  readonly preconfirmed?: boolean;
}

export interface Dropped {
  readonly id: string;
  readonly reason: 'not_found';
}

interface Persisted {
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
  readonly dropped: readonly Dropped[];
}

export type ProposeOutcome =
  | { readonly kind: 'invalid_args' }
  | { readonly kind: 'batch_too_large'; readonly targetCount: number }
  | (Persisted & {
      readonly kind: 'blocked';
      readonly reason: CopilotBlockedReason;
      readonly canRequestApproval: boolean;
    })
  | (Persisted & { readonly kind: 'proposed' })
  /** Nível 2: executado na hora (completed, partially_completed ou failed). */
  | (Persisted & { readonly kind: 'executed' })
  /**
   * Pré-confirmado nível 3 (S13): gravado `executing`. Chame `start()` DEPOIS do commit da
   * transação do chamador; se não chamar, a varredura retoma pelo lease (2 min).
   */
  | (Persisted & {
      readonly kind: 'executing';
      start(): Promise<CopilotProposalRow | null>;
    });

const BLOCKED_MESSAGES: Record<CopilotBlockedReason, string> = {
  role: 'O seu papel não permite esta ação. Você pode pedir a quem pode aprovar.',
  capability_disabled: 'Esta ação está desligada para o seu papel nas configurações do Copiloto.',
  subscription_inactive:
    'A empresa está em modo só leitura (assinatura inativa): consultas seguem, mudanças não.',
  budget: 'O orçamento do Copiloto chegou ao limite para ações neste mês.',
  scope: 'Não encontrei nenhum registro que você possa alterar com esse pedido.',
};

function blockedReasonOf(denial: CopilotDenialReason): CopilotBlockedReason {
  return denial === 'copilot_disabled' ? 'capability_disabled' : denial;
}

/** Dedupe por (tipo, id): um alvo aparece uma vez por proposta (índice único no banco). */
function uniqueTargets(targets: readonly Target[]): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of targets) {
    const key = `${t.type}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export async function readTurnTainted(tx: DbTx, turnId: string | null): Promise<boolean> {
  if (!turnId) return false;
  const [row] = await tx
    .select({ tainted: schema.copilotTurns.tainted })
    .from(schema.copilotTurns)
    .where(eq(schema.copilotTurns.id, turnId))
    .limit(1);
  return row?.tainted ?? false;
}

/** Agrupa os itens por (antes, depois) quando o executor não manda o resumo pronto. */
function groupBeforeAfter(
  capabilityLabel: string,
  preview: ExecutorPreview,
): ProposalPreview['before_after'] {
  const groups = new Map<string, { before: string; after: string; count: number }>();
  for (const item of preview.items) {
    const before = (item.before ?? '—').slice(0, 200);
    const after = (item.after ?? '—').slice(0, 200);
    const key = `${before}\u0000${after}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { before, after, count: 1 });
  }
  return [...groups.values()]
    .slice(0, 20)
    .map((g) => ({ label: capabilityLabel.slice(0, 200), ...g }));
}

/** `ProposalPreview` validado a partir da prévia do executor. */
export function buildPreviewJson(
  capabilityLabel: string,
  preview: ExecutorPreview,
): ProposalPreview {
  return ProposalPreviewSchema.parse({
    before_after: preview.beforeAfter ?? groupBeforeAfter(capabilityLabel, preview),
    impact: preview.impact,
    ...(preview.messagePreview ? { message_preview: preview.messagePreview } : {}),
    ...(preview.alternatives ? { alternatives: preview.alternatives } : {}),
  });
}

const EMPTY_PREVIEW: ExecutorPreview = {
  items: [],
  impact: { notified_members: [], affected_count: 0, criterion: '' },
  external: false,
  irreversible: false,
  notifiesMembers: false,
  summary: '',
};

/** `args` canônicos como objeto JSON (o que vai para `copilot_action_proposals.args`). */
export function argsJson(args: unknown): Record<string, unknown> {
  const json: unknown = JSON.parse(JSON.stringify(args ?? null));
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('copilot: args da capacidade precisam ser um objeto.');
  }
  return json as Record<string, unknown>;
}

export function summaryOf(preview: ExecutorPreview, fallback: string): string {
  const s = preview.summary.trim();
  return (s.length > 0 ? s : fallback).slice(0, 500);
}

/**
 * Cria a proposta a partir de alvos JÁ resolvidos (usado pelo propor e pelo "tentar de novo").
 */
export async function createProposal<Args>(
  deps: ProposalEngineDeps,
  ctx: ProposeContext,
  executor: CapabilityExecutor<Args>,
  args: Args,
  resolved: { readonly targets: readonly Target[]; readonly dropped: readonly Dropped[] },
  options: { readonly forceProposed?: boolean } = {},
): Promise<ProposeOutcome> {
  const { tx, principal } = ctx;
  const now = deps.now();
  const capability = executor.capability;
  const def = CAPABILITIES[capability];
  const targets = uniqueTargets(resolved.targets);
  if (targets.length > BATCH_LIMIT) return { kind: 'batch_too_large', targetCount: targets.length };

  const ectx: ExecutorContext = {
    tx,
    principal,
    requestedByMemberId: principal.requestedByMemberId,
    proposalId: null,
    source: ctx.source,
    now,
  };
  const tainted = (ctx.turnTainted ?? false) || (await readTurnTainted(tx, ctx.turnId));
  const preview = targets.length > 0 ? await executor.preview(ectx, args, targets) : EMPTY_PREVIEW;

  const risk = classifyRisk({
    capability,
    target_count: targets.length,
    external: preview.external,
    irreversible: preview.irreversible,
    notifies_members: preview.notifiesMembers,
    turn_tainted: tainted,
  });
  if (isRiskRefused(risk)) return { kind: 'batch_too_large', targetCount: targets.length };

  const budget = await loadCopilotBudget(tx, principal.settings, now);
  const auth =
    targets.length === 0
      ? ({ allowed: false, reason: 'scope' } as const)
      : authorizeCapability(principal, capability, {
          budget: budget.state,
          targetCount: targets.length,
          isWrite: true,
        });
  const blockedReason: CopilotBlockedReason | null = auth.allowed
    ? null
    : auth.reason === 'scope'
      ? 'scope'
      : blockedReasonOf(auth.reason);

  const previewJson = buildPreviewJson(def.label, preview);

  const previewByTarget = new Map(preview.items.map((p) => [p.targetId, p]));
  const items: InsertCopilotActionItem[] = targets.map((t) => {
    const p = previewByTarget.get(t.id);
    return {
      targetType: t.type,
      targetId: t.id,
      status: 'pending',
      expectedVersion: t.expectedVersion,
      before: encodeBefore({ label: t.label, display: p?.before ?? null, state: t.state }),
      after: encodeAfter({ display: p?.after ?? null, planned: p?.plannedAfter ?? null }),
    };
  });

  let policyChecks: PolicyCheck[] | null = null;
  if (!blockedReason && risk.level === 4 && executor.policyCheck) {
    policyChecks = (await executor.policyCheck(ectx, args, targets)).map((c) =>
      PolicyCheckSchema.parse(c),
    );
  }

  const executeNow =
    !blockedReason &&
    !options.forceProposed &&
    (risk.level === 2 || (risk.level === 3 && ctx.preconfirmed === true));
  const status = blockedReason ? 'blocked' : executeNow ? 'executing' : 'proposed';
  const ttl = risk.level === 4 ? PROPOSAL_TTL_SECONDS[4] : PROPOSAL_TTL_SECONDS[3];

  const inserted = await copilotProposalsRepo.insertWithItems(tx, {
    proposal: {
      workspaceId: principal.workspaceId,
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: ctx.source,
      capability,
      riskLevel: risk.level,
      status,
      requestedByMemberId: principal.requestedByMemberId,
      executedAsMemberId: executeNow ? principal.memberId : null,
      args: argsJson(args),
      preview: previewJson,
      policyChecks,
      blockedReason,
      summary:
        blockedReason === 'scope'
          ? 'Nenhum registro encontrado no seu escopo'
          : summaryOf(preview, def.label),
      expiresAt: status === 'proposed' ? new Date(now.getTime() + ttl * 1000) : null,
      confirmedAt: executeNow ? now : null,
      executedAt: executeNow ? now : null,
      leaseExpiresAt: executeNow
        ? new Date(now.getTime() + COPILOT_PROPOSAL_LEASE_SECONDS * 1000)
        : null,
    },
    items: blockedReason === 'scope' ? [] : items,
  });
  await recordProposalAudit(tx, {
    proposal: inserted.proposal,
    event: status,
    from: null,
    actorMemberId: principal.memberId,
    counts: auditCounts(countItems(inserted.items)),
    extra: { dropped: resolved.dropped.length, tainted },
  });

  const persisted = async (
    row: CopilotProposalRow,
    rowItems: CopilotActionItemRow[],
  ): Promise<Persisted> => ({
    proposal: await buildProposalDTO(tx, row, rowItems, principal, deps.now()),
    row,
    items: rowItems,
    dropped: resolved.dropped,
  });

  if (blockedReason) {
    const canRequestApproval =
      blockedReason === 'role' &&
      (await listApprovers(tx, principal, capability, targets.length)).length > 0;
    return {
      kind: 'blocked',
      reason: blockedReason,
      canRequestApproval,
      ...(await persisted(inserted.proposal, inserted.items)),
    };
  }

  if (status === 'proposed') {
    return { kind: 'proposed', ...(await persisted(inserted.proposal, inserted.items)) };
  }

  const proposalId = inserted.proposal.id;
  const registry = { get: () => executor, list: () => [executor] } as const;
  const runDeps: ProposalEngineDeps = { ...deps, executors: registry };
  if (risk.level === 2) {
    // Na hora, dentro da transação do chamador (savepoint por item).
    await runProposalExecution(runDeps, {
      workspaceId: principal.workspaceId,
      proposalId,
      run: savepointRunner(tx),
    });
    const final = await copilotProposalsRepo.getWithItems(tx, proposalId);
    if (!final) throw new Error('copilot: proposta executada sumiu.');
    return { kind: 'executed', ...(await persisted(final.proposal, final.items)) };
  }
  return {
    kind: 'executing',
    ...(await persisted(inserted.proposal, inserted.items)),
    start: () =>
      startProposalExecution(runDeps, { workspaceId: principal.workspaceId, proposalId }),
  };
}

/** Propor: valida, resolve e cria (ADR-004 §1). */
export async function proposeAction<Args>(
  deps: ProposalEngineDeps,
  ctx: ProposeContext,
  executor: CapabilityExecutor<Args>,
  rawArgs: unknown,
): Promise<ProposeOutcome> {
  const parsed = executor.argsSchema.safeParse(rawArgs);
  if (!parsed.success) return { kind: 'invalid_args' };
  const args = parsed.data;
  const resolved = await executor.resolveTargets(
    {
      tx: ctx.tx,
      principal: ctx.principal,
      requestedByMemberId: ctx.principal.requestedByMemberId,
      proposalId: null,
      source: ctx.source,
      now: deps.now(),
    },
    args,
  );
  return createProposal(deps, ctx, executor, args, resolved);
}

// ─── Ferramenta `propose_<capability>` ─────────────────────────────────────────

const MODEL_INSTRUCTIONS = {
  awaiting:
    'A proposta está aguardando a confirmação da pessoa na tela. Pare aqui: resuma o que será feito e não diga que já foi feito.',
  executed: 'Feito. A pessoa pode desfazer pelo recibo ou pela Atividade.',
  notExecuted:
    'A ação não foi concluída por inteiro. Diga o que aconteceu com base nos números, sem inventar.',
  batch: `São mais de ${BATCH_LIMIT} registros: grande demais para o Copiloto. Sugira fazer pela tela, com filtro e seleção. Nada foi executado.`,
} as const;

/** Envelope do callback a partir do resultado do motor (o que o modelo e a tela recebem). */
export function proposeEnvelope(outcome: ProposeOutcome): CopilotToolEnvelope {
  switch (outcome.kind) {
    case 'invalid_args':
      return {
        ok: false,
        decision: 'invalid_args',
        model_view: 'Os argumentos não seguem o formato desta ferramenta; nada foi executado.',
      };
    case 'batch_too_large':
      return { ok: false, decision: 'invalid_args', model_view: MODEL_INSTRUCTIONS.batch };
    case 'blocked': {
      const message = BLOCKED_MESSAGES[outcome.reason];
      return {
        ok: false,
        decision: 'blocked',
        model_view: {
          status: 'blocked',
          proposal_id: outcome.row.id,
          reason: outcome.reason,
          can_request_approval: outcome.canRequestApproval,
          not_found: outcome.dropped.length,
          message: `${message} Nada foi executado.`,
        },
        public_event: ActionBlockedEventSchema.parse({
          v: COPILOT_STREAM_VERSION,
          type: 'action_blocked',
          proposal_id: outcome.row.id,
          reason: outcome.reason,
          capability: capabilityOf(outcome.row),
          can_request_approval: outcome.canRequestApproval,
          message,
        }),
      };
    }
    case 'proposed':
    case 'executing':
      return {
        ok: true,
        decision: 'proposed',
        model_view: {
          status: 'awaiting_confirmation',
          proposal_id: outcome.row.id,
          risk_level: outcome.row.riskLevel,
          summary: outcome.row.summary,
          items: outcome.items.length,
          not_found: outcome.dropped.length,
          instruction: MODEL_INSTRUCTIONS.awaiting,
        },
        public_event: ActionProposedEventSchema.parse({
          v: COPILOT_STREAM_VERSION,
          type: 'action_proposed',
          proposal: outcome.proposal,
        }),
      };
    case 'executed': {
      const { row, items } = outcome;
      const counts = countItems(items);
      if (row.status === 'completed' && row.undoDeadline) {
        return {
          ok: true,
          decision: 'executed',
          model_view: {
            status: 'executed',
            proposal_id: row.id,
            summary: row.summary,
            undo_until: row.undoDeadline.toISOString(),
            not_found: outcome.dropped.length,
            instruction: MODEL_INSTRUCTIONS.executed,
          },
          public_event: ActionReceiptEventSchema.parse({
            v: COPILOT_STREAM_VERSION,
            type: 'action_receipt',
            proposal_id: row.id,
            risk_level: 2,
            summary: row.summary,
            undo_until: row.undoDeadline.toISOString(),
          }),
        };
      }
      return {
        ok: row.status === 'completed',
        decision: row.status === 'completed' ? 'executed' : 'error',
        model_view: {
          status: row.status,
          proposal_id: row.id,
          summary: row.summary,
          done: counts.done,
          total: counts.total,
          reasons: [...new Set(items.map(itemReason).filter((r): r is string => r !== null))],
          instruction: MODEL_INSTRUCTIONS.notExecuted,
        },
      };
    }
  }
}

export interface ProposeToolOptions<Args> {
  /** Para o modelo: o que faz e quando usar. Texto do código, nunca de dado de cliente. */
  readonly description: string;
  /** Default `propose_<capability com _>` (ex.: `propose_deal_move`). */
  readonly key?: string;
  /** Permissões de entidade além da capacidade. */
  readonly requires?: CopilotToolDefinition['requires'];
  /** Volume real (`message.send` com 2+ muda a permissão no callback). */
  readonly targetCount?: (args: Args) => number;
  /** Dependências do motor (testes). Default: as de produção, com este executor. */
  readonly deps?: () => ProposalEngineDeps;
}

/** `propose_deal_move` a partir de `deal.move`. */
export function proposeToolKey(capability: string): string {
  return `propose_${capability.replace(/[^a-z0-9]+/g, '_')}`;
}

/**
 * Gera a ferramenta `propose_<capability>` de um executor. É a ÚNICA forma de uma capacidade de
 * escrita chegar ao modelo: o handler é o motor, e o nível vem do sistema.
 */
export function makeProposeTool<Args>(
  executor: CapabilityExecutor<Args>,
  options: ProposeToolOptions<Args>,
): CopilotToolDefinition {
  let cachedDeps: ProposalEngineDeps | null = null;
  const depsOf = (): ProposalEngineDeps =>
    options.deps?.() ??
    (cachedDeps ??= createProposalEngineDeps({ executors: createExecutorRegistry([executor]) }));
  return defineCopilotTool<Args>({
    key: options.key ?? proposeToolKey(executor.capability),
    capability: executor.capability,
    description: options.description,
    args: executor.argsSchema,
    ...(options.requires ? { requires: options.requires } : {}),
    taintsTurn: false,
    ...(options.targetCount ? { targetCount: options.targetCount } : {}),
    async handler(ctx: CopilotToolContext, args: Args): Promise<CopilotToolEnvelope> {
      const outcome = await proposeAction(
        depsOf(),
        {
          tx: ctx.tx,
          principal: ctx.principal,
          source: 'copilot',
          turnId: ctx.turn.turnId,
          sessionId: ctx.turn.sessionId,
          turnTainted: ctx.turn.tainted,
        },
        executor,
        args,
      );
      return proposeEnvelope(outcome);
    },
  });
}
