/**
 * Wiring do seam onStageChanged (gap-fill orchestrator F5, padrao F2-S19).
 *
 * Liga a transicao de stage (deal-move.ts) a seus side-effects:
 *   1. socket: emite deal:stage_changed para a room do workspace (F5-S07);
 *   2. automacoes: agenda on_exit (stage antigo) + on_enter (novo) em
 *      pending_automations (F5-S06) — insert direto no DB (sem importar workers).
 *
 * Idempotente: registerDealHooks roda uma vez no boot do app.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import { emitDealStageChanged } from './deal-events';
import { onStageChanged, type DealMoveMetadata, type StageChangeEvent } from './deal-move';

const { stages, pendingAutomations } = schema;

type AutomationRule = (typeof pendingAutomations.$inferSelect)['rule'];

async function rulesForStage(stageId: string): Promise<AutomationRule[]> {
  const [row] = await getDb()
    .select({ rules: stages.automationRules })
    .from(stages)
    .where(eq(stages.id, stageId))
    .limit(1);
  return (row?.rules ?? []) as AutomationRule[];
}

/**
 * A regra agendada leva a correlação da movimentação (`rule.metadata`, F73-S08): é por ela que
 * o desfazer de uma movimentação do Copiloto acha e cancela o que ela deixou na fila
 * (`cancelPendingAutomationsOfProposal`). `pending_automations` não tem coluna de metadados; o
 * `rule` é o snapshot jsonb da regra e o worker ignora chaves que não conhece.
 */
function withCorrelation(
  rule: AutomationRule,
  metadata: DealMoveMetadata | undefined,
): AutomationRule {
  if (!metadata?.proposal_id) return rule;
  const tagged: AutomationRule & { metadata: DealMoveMetadata } = {
    ...rule,
    metadata: {
      ...(metadata.via ? { via: metadata.via } : {}),
      proposal_id: metadata.proposal_id,
    },
  };
  return tagged;
}

async function scheduleStageRules(
  e: StageChangeEvent,
  stageId: string,
  trigger: 'on_enter' | 'on_exit',
  now: Date,
): Promise<void> {
  const rules = (await rulesForStage(stageId)).filter((r) => r.trigger === trigger && r.enabled);
  if (rules.length === 0) return;
  await getDb()
    .insert(pendingAutomations)
    .values(
      rules.map((rule) => ({
        workspaceId: e.workspaceId,
        dealId: e.dealId,
        rule: withCorrelation(rule, e.metadata),
        scheduledAt: new Date(now.getTime() + Math.max(0, (rule.delaySeconds ?? 0) * 1000)),
        status: 'pending' as const,
      })),
    );
}

/**
 * Agenda as automações de saída/entrada da movimentação. Desfazer (`origin: 'undo'`) não agenda
 * nada: voltar para onde estava não é entrar no estágio de novo (o cancelamento das pendentes da
 * movimentação desfeita já aconteceu na transação, em `moveDealToStage`).
 */
export async function scheduleStageAutomations(
  e: StageChangeEvent,
  now = new Date(),
): Promise<void> {
  if (e.origin === 'undo') return;
  await scheduleStageRules(e, e.fromStageId, 'on_exit', now);
  await scheduleStageRules(e, e.toStageId, 'on_enter', now);
}

let registered = false;

/** Registra os hooks do seam (socket + automation scheduling). Idempotente. */
export function registerDealHooks(): void {
  if (registered) return;
  registered = true;

  onStageChanged(async (e: StageChangeEvent) => {
    await emitDealStageChanged({
      workspaceId: e.workspaceId,
      dealId: e.dealId,
      fromStageId: e.fromStageId,
      toStageId: e.toStageId,
      movedBy: e.actor.memberId ?? e.actor.type,
    });
  });

  onStageChanged(async (e: StageChangeEvent) => {
    await scheduleStageAutomations(e);
  });
}
