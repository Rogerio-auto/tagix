/**
 * Servico central de movimentacao de deal entre stages (PIPELINE.md 3.2/4.2).
 *
 * `moveDealToStage` e o PONTO UNICO de transicao — reusado por:
 *   - a rota POST /api/deals/:id/move-stage (F5-S05),
 *   - o agent tool `move_deal_stage` (F5-S08),
 *   - o handler `move_stage` do flow-engine (F5-S16).
 *
 * Responsabilidades: validar transition_rules (4.2) -> update deals -> registrar
 * deal_history -> disparar o SEAM `onStageChanged`. O seam e um registry de hooks
 * preenchido fora deste modulo (automation dispatch F5-S06, socket emit F5-S07,
 * trigger stage_change F5-S16) — este servico NAO acopla nenhum deles.
 *
 * Tudo roda dentro de UMA transacao RLS (`req.scoped`): o caller passa o `tx`.
 */
import { and, eq } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { Role } from '@hm/shared';

const { deals, stages, dealHistory } = schema;

export type DealActorType = 'member' | 'agent' | 'system' | 'api';

export interface DealActor {
  type: DealActorType;
  memberId?: string | null;
  role?: Role | null;
}

export interface StageChangeEvent {
  workspaceId: string;
  dealId: string;
  pipelineId: string;
  fromStageId: string;
  toStageId: string;
  actor: DealActor;
}

/** Hook do seam onStageChanged. Roda DEPOIS do commit logico da transicao. */
export type StageChangeHook = (event: StageChangeEvent) => void | Promise<void>;

const stageChangeHooks: StageChangeHook[] = [];

/**
 * Registra um hook no seam onStageChanged. Idempotente por referencia.
 * Chamado no bootstrap por F5-S06 (automation), F5-S07 (socket), F5-S16 (trigger).
 */
export function onStageChanged(hook: StageChangeHook): void {
  if (!stageChangeHooks.includes(hook)) stageChangeHooks.push(hook);
}

/** Limpa hooks (uso em testes). */
export function __resetStageChangeHooks(): void {
  stageChangeHooks.length = 0;
}

async function emitStageChanged(event: StageChangeEvent): Promise<void> {
  for (const hook of stageChangeHooks) {
    // Hooks nao devem derrubar a transicao; cada um isola seu erro.
    try {
      await hook(event);
    } catch {
      // Best-effort: automation/socket/trigger sao side-effects pos-transicao.
    }
  }
}

/** Erro de violacao de transition rules (4.2). Mapeado a 422 pela rota. */
export class TransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
  }
}

type StageRow = typeof stages.$inferSelect;
type DealRow = typeof deals.$inferSelect;

/** Valida transition_rules do stage destino (PIPELINE.md 4.2). */
export function validateTransition(input: {
  from: StageRow;
  to: StageRow;
  deal: DealRow;
  actor: DealActor;
}): void {
  const rules = input.to.transitionRules ?? {};

  const allowed = rules.allowedFromStageIds ?? [];
  if (allowed.length > 0 && !allowed.includes(input.from.id)) {
    throw new TransitionError(
      'transition_not_allowed',
      `Nao e permitido mover de "${input.from.name}" para "${input.to.name}".`,
    );
  }

  const customFields = (input.deal.customFields ?? {}) as Record<string, unknown>;
  for (const fieldKey of rules.requiredFields ?? []) {
    const v = customFields[fieldKey];
    if (v === undefined || v === null || v === '') {
      throw new TransitionError(
        'required_field_missing',
        `Campo obrigatorio ausente para "${input.to.name}": ${fieldKey}.`,
      );
    }
  }

  const requiredRoles = rules.requiredRoles ?? [];
  if (requiredRoles.length > 0) {
    const role = input.actor.role ?? null;
    // Agentes/sistema (sem role de membro) so passam se a regra nao exigir role.
    if (!role || !requiredRoles.includes(role as 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'AGENT')) {
      throw new TransitionError(
        'role_not_allowed',
        `Apenas ${requiredRoles.join('/')} pode mover para "${input.to.name}".`,
      );
    }
  }
}

export interface MoveDealResult {
  deal: DealRow;
  fromStageId: string;
  toStageId: string;
}

/**
 * Move um deal para `newStageId` dentro da transacao `tx` (RLS ja escopada).
 * Valida transition rules -> update -> deal_history('stage_changed') -> seam.
 * Lanca TransitionError (regra) ou Error('deal_not_found'/'stage_not_found').
 */
export async function moveDealToStage(
  tx: DbTx,
  args: { dealId: string; newStageId: string; actor: DealActor; workspaceId: string },
): Promise<MoveDealResult> {
  const { dealId, newStageId, actor, workspaceId } = args;

  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new Error('deal_not_found');

  if (deal.stageId === newStageId) {
    return { deal, fromStageId: deal.stageId, toStageId: newStageId };
  }

  const [fromStage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId)).limit(1);
  const [toStage] = await tx
    .select()
    .from(stages)
    .where(and(eq(stages.id, newStageId), eq(stages.pipelineId, deal.pipelineId)))
    .limit(1);
  if (!toStage) throw new Error('stage_not_found');
  if (!fromStage) throw new Error('stage_not_found');

  validateTransition({ from: fromStage, to: toStage, deal, actor });

  const [updated] = await tx
    .update(deals)
    .set({ stageId: newStageId, position: 0, updatedAt: new Date() })
    .where(eq(deals.id, dealId))
    .returning();
  if (!updated) throw new Error('deal_not_found');

  await tx.insert(dealHistory).values({
    dealId,
    workspaceId,
    eventType: 'stage_changed',
    fromValue: { stageId: deal.stageId },
    toValue: { stageId: newStageId },
    actorMemberId: actor.memberId ?? null,
    actorType: actor.type,
  });

  await emitStageChanged({
    workspaceId,
    dealId,
    pipelineId: deal.pipelineId,
    fromStageId: deal.stageId,
    toStageId: newStageId,
    actor,
  });

  return { deal: updated, fromStageId: deal.stageId, toStageId: newStageId };
}
