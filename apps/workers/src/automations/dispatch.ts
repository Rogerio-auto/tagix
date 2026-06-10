/**
 * Agendamento de automacoes ao mudar de stage (PIPELINE.md 3.2).
 *
 * `dispatchAutomationRules` e chamado pelo seam `onStageChanged` (F5-S05): ao
 * trocar de stage, agenda em `pending_automations` as regras `on_exit` do stage
 * antigo + `on_enter` do novo (com `delay_seconds` -> scheduled_at). Persistir em
 * tabela duravel garante que sobrevive a crash do worker.
 *
 * NAO executa nada aqui — so enfileira. O drainer (worker.ts) processa depois.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { AutomationContext, AutomationRule, AutomationTrigger } from './types';

const { stages, pendingAutomations } = schema;

/** Le as automation_rules de um stage (cross-tenant: bootstrap/seam ja garante escopo). */
async function rulesForStage(stageId: string): Promise<AutomationRule[]> {
  const [row] = await getDb()
    .select({ rules: stages.automationRules })
    .from(stages)
    .where(eq(stages.id, stageId))
    .limit(1);
  return (row?.rules ?? []) as AutomationRule[];
}

function dueAt(rule: AutomationRule, now: Date): Date {
  const delayMs = Math.max(0, (rule.delaySeconds ?? 0) * 1000);
  return new Date(now.getTime() + delayMs);
}

/** Enfileira as regras de um trigger especifico (filtra enabled) p/ um deal. */
export async function scheduleRules(args: {
  workspaceId: string;
  dealId: string;
  rules: readonly AutomationRule[];
  trigger: AutomationTrigger;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const due = args.rules.filter((r) => r.trigger === args.trigger && r.enabled);
  if (due.length === 0) return 0;
  await getDb()
    .insert(pendingAutomations)
    .values(
      due.map((rule) => ({
        workspaceId: args.workspaceId,
        dealId: args.dealId,
        rule,
        scheduledAt: dueAt(rule, now),
        status: 'pending' as const,
      })),
    );
  return due.length;
}

/**
 * Hook do seam onStageChanged: agenda on_exit (stage antigo) + on_enter (novo).
 * Best-effort por design (o seam isola erros) — mas qualquer falha de DB sobe.
 */
export async function dispatchAutomationRules(ctx: AutomationContext): Promise<void> {
  const now = new Date();
  if (ctx.fromStageId) {
    const exitRules = await rulesForStage(ctx.fromStageId);
    await scheduleRules({
      workspaceId: ctx.workspaceId,
      dealId: ctx.dealId,
      rules: exitRules,
      trigger: 'on_exit',
      now,
    });
  }
  if (ctx.toStageId) {
    const enterRules = await rulesForStage(ctx.toStageId);
    await scheduleRules({
      workspaceId: ctx.workspaceId,
      dealId: ctx.dealId,
      rules: enterRules,
      trigger: 'on_enter',
      now,
    });
  }
}
