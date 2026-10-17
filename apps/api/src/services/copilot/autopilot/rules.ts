/**
 * Regras do piloto automático por estágio (F73-S13; COPILOTO.md §4 e §7.2).
 *
 * `GET` devolve as regras GRAVADAS (estágio sem regra = nunca configurado = desligado; a tela junta
 * com a lista de estágios do funil). `PUT` grava um lote, tudo ou nada:
 *
 *   - `mode: 'auto'` ("mover sozinho") → 409 `feature_not_available`: o banco aceita o valor, a API
 *     recusa até a v1.1 (F73-S16). Vem ANTES de qualquer outra validação e nada é gravado;
 *   - cada regra: estágio do workspace, e (se ligada) `target_stage_id` do MESMO funil e diferente
 *     do estágio. `idle_days` 1..60 e `daily_limit` 1..50 já são do Zod do contrato;
 *   - desligar a regra ou trocar o destino tira da fila, na hora, as sugestões pendentes dela
 *     (`superseded`): a lista não mostra uma sugestão que a regra de hoje não geraria;
 *   - `audit_logs` por regra que mudou ("Ligado por Bruna em 10/10" sai de `enabled_by/enabled_at`
 *     da própria regra; a trilha guarda o antes/depois, sem PII).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  copilotAutopilotRepo,
  schema,
  type CopilotAutopilotMode,
  type CopilotAutopilotRuleRow,
  type DbTx,
} from '@hm/db';
import { AutopilotCriteriaSchema, type AutopilotRule, type AutopilotRulesUpdate } from '@hm/shared';

const { stages, members, auditLogs, copilotSuggestions } = schema;

export const AUTOPILOT_AUDIT_RESOURCE = 'copilot_autopilot_rule' as const;

export type RulesFailure =
  | { readonly ok: false; readonly error: 'feature_not_available' }
  | { readonly ok: false; readonly error: 'duplicate_stage' }
  | {
      readonly ok: false;
      readonly error: 'invalid_rule';
      readonly stageId: string;
      readonly reason:
        | 'stage_not_found'
        | 'target_not_found'
        | 'target_other_pipeline'
        | 'target_is_stage';
    };

export const RULES_FAILURE_MESSAGES = {
  feature_not_available:
    '"Mover sozinho" ainda não está disponível. Use "Só sugerir" ou "Aprovação diária".',
  duplicate_stage: 'O mesmo estágio aparece mais de uma vez na lista de regras.',
  stage_not_found: 'Um dos estágios não existe nesta empresa.',
  target_not_found: 'O estágio de destino não existe nesta empresa.',
  target_other_pipeline: 'O estágio de destino precisa ser do mesmo funil do estágio de origem.',
  target_is_stage: 'O estágio de destino precisa ser diferente do estágio de origem.',
} as const;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function toRuleDTO(
  row: CopilotAutopilotRuleRow,
  stage: { readonly name: string; readonly pipelineId: string },
  enabledByName: string | null,
): AutopilotRule | null {
  const criteria = AutopilotCriteriaSchema.safeParse({
    idle_days: row.criteria.idle_days,
    target_stage_id: row.criteria.target_stage_id,
    require_last_outbound: row.criteria.require_last_outbound ?? false,
  });
  // Linha sem critério legível (gravada fora da API): fica de fora; o gerador também a ignora.
  if (!criteria.success) return null;
  return {
    stage_id: row.stageId,
    stage_name: stage.name.slice(0, 120),
    pipeline_id: stage.pipelineId,
    mode: row.mode,
    criteria: criteria.data,
    daily_limit: row.dailyLimit,
    enabled_by:
      row.enabledBy && enabledByName
        ? { member_id: row.enabledBy, name: enabledByName.slice(0, 120) }
        : null,
    enabled_at: iso(row.enabledAt),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** As regras gravadas do workspace, na ordem do funil. */
export async function listAutopilotRules(tx: DbTx): Promise<AutopilotRule[]> {
  const rules = await copilotAutopilotRepo.listRules(tx);
  if (rules.length === 0) return [];
  const stageRows = await tx
    .select({
      id: stages.id,
      name: stages.name,
      pipelineId: stages.pipelineId,
      position: stages.position,
    })
    .from(stages)
    .where(
      inArray(
        stages.id,
        rules.map((r) => r.stageId),
      ),
    )
    .orderBy(asc(stages.pipelineId), asc(stages.position), asc(stages.id));
  const memberIds = [...new Set(rules.map((r) => r.enabledBy).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (memberIds.length > 0) {
    const rows = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, memberIds));
    for (const m of rows) names.set(m.id, m.name ?? 'Membro da equipe');
  }
  const ruleByStage = new Map(rules.map((r) => [r.stageId, r]));
  const out: AutopilotRule[] = [];
  for (const s of stageRows) {
    const row = ruleByStage.get(s.id);
    if (!row) continue;
    const dto = toRuleDTO(row, s, row.enabledBy ? (names.get(row.enabledBy) ?? null) : null);
    if (dto) out.push(dto);
  }
  return out;
}

function auditAction(before: CopilotAutopilotMode | null, after: CopilotAutopilotMode): string {
  const wasOn = before !== null && before !== 'off';
  const isOn = after !== 'off';
  if (!wasOn && isOn) return 'copilot.autopilot.enabled';
  if (wasOn && !isOn) return 'copilot.autopilot.disabled';
  return 'copilot.autopilot.rule_changed';
}

function sameRule(
  row: CopilotAutopilotRuleRow | undefined,
  next: AutopilotRulesUpdate['rules'][number],
): boolean {
  if (!row) return false;
  const c = row.criteria;
  return (
    row.mode === next.mode &&
    row.dailyLimit === next.daily_limit &&
    c.idle_days === next.criteria.idle_days &&
    c.target_stage_id === next.criteria.target_stage_id &&
    (c.require_last_outbound ?? false) === next.criteria.require_last_outbound
  );
}

export interface RulesUpdated {
  readonly ok: true;
  readonly rules: AutopilotRule[];
  /** Pendentes tiradas da fila por desligar a regra ou trocar o destino. */
  readonly superseded: number;
}

/** Grava o lote (tudo ou nada: uma falha desfaz a transação do chamador, nada foi escrito antes). */
export async function updateAutopilotRules(
  tx: DbTx,
  actor: { readonly workspaceId: string; readonly memberId: string },
  body: AutopilotRulesUpdate,
): Promise<RulesUpdated | RulesFailure> {
  if (body.rules.some((r) => r.mode === 'auto')) {
    return { ok: false, error: 'feature_not_available' };
  }
  const stageIds = body.rules.map((r) => r.stage_id);
  if (new Set(stageIds).size !== stageIds.length) return { ok: false, error: 'duplicate_stage' };

  const wanted = [...new Set([...stageIds, ...body.rules.map((r) => r.criteria.target_stage_id)])];
  const stageRows = await tx
    .select({ id: stages.id, pipelineId: stages.pipelineId })
    .from(stages)
    .where(and(eq(stages.workspaceId, actor.workspaceId), inArray(stages.id, wanted)));
  const pipelineOf = new Map(stageRows.map((s) => [s.id, s.pipelineId]));

  for (const r of body.rules) {
    const from = pipelineOf.get(r.stage_id);
    if (!from) {
      return { ok: false, error: 'invalid_rule', stageId: r.stage_id, reason: 'stage_not_found' };
    }
    if (r.mode === 'off') continue;
    const target = r.criteria.target_stage_id;
    if (target === r.stage_id) {
      return { ok: false, error: 'invalid_rule', stageId: r.stage_id, reason: 'target_is_stage' };
    }
    const to = pipelineOf.get(target);
    if (!to) {
      return { ok: false, error: 'invalid_rule', stageId: r.stage_id, reason: 'target_not_found' };
    }
    if (to !== from) {
      return {
        ok: false,
        error: 'invalid_rule',
        stageId: r.stage_id,
        reason: 'target_other_pipeline',
      };
    }
  }

  const existing = new Map((await copilotAutopilotRepo.listRules(tx)).map((r) => [r.stageId, r]));
  let superseded = 0;
  for (const r of body.rules) {
    const before = existing.get(r.stage_id);
    if (sameRule(before, r)) continue;

    await copilotAutopilotRepo.upsertRule(tx, {
      workspaceId: actor.workspaceId,
      stageId: r.stage_id,
      mode: r.mode,
      criteria: {
        idle_days: r.criteria.idle_days,
        target_stage_id: r.criteria.target_stage_id,
        require_last_outbound: r.criteria.require_last_outbound,
      },
      dailyLimit: r.daily_limit,
      memberId: actor.memberId,
    });

    const targetChanged =
      before !== undefined && before.criteria.target_stage_id !== r.criteria.target_stage_id;
    if (r.mode === 'off' || targetChanged) {
      const rows = await tx
        .update(copilotSuggestions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(copilotSuggestions.workspaceId, actor.workspaceId),
            eq(copilotSuggestions.fromStageId, r.stage_id),
            eq(copilotSuggestions.status, 'pending'),
          ),
        )
        .returning({ id: copilotSuggestions.id });
      superseded += rows.length;
    }

    await tx.insert(auditLogs).values({
      workspaceId: actor.workspaceId,
      actorType: 'member',
      actorMemberId: actor.memberId,
      action: auditAction(before?.mode ?? null, r.mode),
      resourceType: AUTOPILOT_AUDIT_RESOURCE,
      resourceId: r.stage_id,
      metadata: {
        stage_id: r.stage_id,
        from_mode: before?.mode ?? null,
        to_mode: r.mode,
        idle_days: r.criteria.idle_days,
        target_stage_id: r.criteria.target_stage_id,
        require_last_outbound: r.criteria.require_last_outbound,
        daily_limit: r.daily_limit,
      },
    });
  }

  return { ok: true, rules: await listAutopilotRules(tx), superseded };
}
