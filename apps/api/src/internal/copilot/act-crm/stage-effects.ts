/**
 * Automação de estágio é efeito da movimentação (F73-S08; COPILOTO.md §6.2 e §11.7).
 *
 * `stages.automation_rules` roda sozinha quando um negócio entra (`on_enter`) num estágio ou sai
 * (`on_exit`) dele. Mover um negócio pode, portanto, falar com o cliente sem que o pedido diga
 * isso. A prévia de `propose_move_deals` lê as regras ATIVAS do estágio de destino e dos de
 * origem e as classifica:
 *
 *   send_message · trigger_flow · register_conversion → `external` (nível 4) + linha na prévia
 *       ("Ao entrar em Reativação, a automação envia a mensagem 'retomada' ao cliente");
 *       `register_conversion` sai para as plataformas de anúncio (Meta CAPI);
 *   notify_members → avisa membros (nível ≥ 3) e entra em "quem é avisado";
 *   create_event · add_tag · remove_tag → internas: só a linha da prévia.
 *
 * `transition_rules.requiresApproval` do destino faz cada item ficar `skipped_policy`
 * ("este estágio exige aprovação no Pipeline"): o Copiloto não fura a aprovação do Pipeline.
 *
 * Os textos citam nomes de estágio, de flow, de modelo de mensagem e de tag (dados da empresa),
 * nunca dados de contato.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';

const { stages, flows, tags } = schema;

type AutomationRule = schema.AutomationRule;

export const EXTERNAL_AUTOMATION_ACTIONS = new Set<AutomationRule['action']>([
  'send_message',
  'trigger_flow',
  'register_conversion',
]);

export interface StageRef {
  readonly id: string;
  readonly name: string;
  readonly pipelineId: string;
  readonly requiresApproval: boolean;
  readonly rules: readonly AutomationRule[];
}

export interface StageEffectLine {
  readonly trigger: 'on_enter' | 'on_exit';
  readonly stageId: string;
  readonly action: AutomationRule['action'];
  readonly external: boolean;
  /** "Ao entrar em Reativação, a automação envia a mensagem 'retomada' ao cliente". ≤ 200. */
  readonly text: string;
}

export interface StageEffects {
  readonly external: boolean;
  /** Membros avisados por `notify_members` (ids únicos). */
  readonly notifyMemberIds: readonly string[];
  readonly lines: readonly StageEffectLine[];
  /** O destino exige aprovação no Pipeline: os itens ficam `skipped_policy`. */
  readonly requiresApproval: boolean;
}

/** Estágios por id (com as regras), no workspace do RLS. */
export async function loadStages(
  tx: DbTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, StageRef>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, StageRef>();
  if (unique.length === 0) return out;
  const rows = await tx
    .select({
      id: stages.id,
      name: stages.name,
      pipelineId: stages.pipelineId,
      rules: stages.automationRules,
      transition: stages.transitionRules,
    })
    .from(stages)
    .where(and(eq(stages.workspaceId, workspaceId), inArray(stages.id, unique)));
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.name,
      pipelineId: r.pipelineId,
      requiresApproval: r.transition?.requiresApproval === true,
      rules: Array.isArray(r.rules) ? r.rules : [],
    });
  }
  return out;
}

function delayText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ` depois de ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return ` depois de ${hours} h`;
  return ` depois de ${Math.round(hours / 24)} dias`;
}

function quote(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? `'${v.slice(0, 60)}'` : fallback;
}

interface Names {
  readonly flows: ReadonlyMap<string, string>;
  readonly tags: ReadonlyMap<string, string>;
}

function describe(rule: AutomationRule, names: Names): string {
  const c = rule.config;
  switch (c.kind) {
    case 'send_message':
      return `envia a mensagem ${quote(c.templateName, 'de modelo')} ao cliente`;
    case 'trigger_flow':
      return `dispara o flow ${quote(names.flows.get(c.flowId), 'configurado')} para o cliente`;
    case 'register_conversion':
      return `registra a conversão ${quote(c.conversionTypeKey, 'configurada')} nas plataformas de anúncio`;
    case 'notify_members':
      return `avisa ${c.memberIds.length === 1 ? '1 pessoa' : `${c.memberIds.length} pessoas`} da equipe`;
    case 'create_event':
      return `cria o compromisso ${quote(c.title, 'configurado')} na agenda`;
    case 'add_tag':
      return `adiciona a tag ${quote(names.tags.get(c.tagId), 'configurada')} ao contato`;
    case 'remove_tag':
      return `remove a tag ${quote(names.tags.get(c.tagId), 'configurada')} do contato`;
  }
}

function activeRules(stage: StageRef, trigger: 'on_enter' | 'on_exit'): AutomationRule[] {
  return stage.rules.filter((r) => r.enabled && r.trigger === trigger);
}

/**
 * Efeitos da movimentação para `to` saindo de cada estágio em `from`. Só leitura (uma query
 * por catálogo citado: flows e tags).
 */
export async function stageEffects(
  tx: DbTx,
  to: StageRef,
  from: readonly StageRef[],
): Promise<StageEffects> {
  const plan: { trigger: 'on_enter' | 'on_exit'; stage: StageRef; rule: AutomationRule }[] = [];
  for (const rule of activeRules(to, 'on_enter'))
    plan.push({ trigger: 'on_enter', stage: to, rule });
  for (const stage of from) {
    if (stage.id === to.id) continue;
    for (const rule of activeRules(stage, 'on_exit'))
      plan.push({ trigger: 'on_exit', stage, rule });
  }

  const flowIds: string[] = [];
  const tagIds: string[] = [];
  for (const { rule } of plan) {
    const c = rule.config;
    if (c.kind === 'trigger_flow') flowIds.push(c.flowId);
    if (c.kind === 'add_tag' || c.kind === 'remove_tag') tagIds.push(c.tagId);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const flowRows =
    flowIds.filter((id) => uuid.test(id)).length > 0
      ? await tx
          .select({ id: flows.id, name: flows.name })
          .from(flows)
          .where(inArray(flows.id, [...new Set(flowIds.filter((id) => uuid.test(id)))]))
      : [];
  const tagRows =
    tagIds.filter((id) => uuid.test(id)).length > 0
      ? await tx
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(inArray(tags.id, [...new Set(tagIds.filter((id) => uuid.test(id)))]))
      : [];
  const names: Names = {
    flows: new Map(flowRows.map((r) => [r.id, r.name])),
    tags: new Map(tagRows.map((r) => [r.id, r.name])),
  };

  const notify = new Set<string>();
  const lines: StageEffectLine[] = plan.map(({ trigger, stage, rule }) => {
    if (rule.config.kind === 'notify_members') {
      for (const id of rule.config.memberIds) notify.add(id);
    }
    const when = trigger === 'on_enter' ? `Ao entrar em ${stage.name}` : `Ao sair de ${stage.name}`;
    const text = `${when}, a automação ${describe(rule, names)}${delayText(rule.delaySeconds)}`;
    return {
      trigger,
      stageId: stage.id,
      action: rule.action,
      external: EXTERNAL_AUTOMATION_ACTIONS.has(rule.action),
      text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
    };
  });

  return {
    external: lines.some((l) => l.external),
    notifyMemberIds: [...notify],
    lines,
    requiresApproval: to.requiresApproval,
  };
}
