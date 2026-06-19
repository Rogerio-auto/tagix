/**
 * Instanciador único de Niche Blueprint (ONBOARDING.md §2.2).
 *
 * `instantiateNicheBlueprint(tx, workspaceId, blueprint)` aplica TODOS os recursos
 * de um nicho num workspace, de forma IDEMPOTENTE e RLS-safe: recebe a transação
 * já escopada (`req.scoped`/`withWorkspace`), nunca abre conexão própria nem roda
 * como OWNER. Re-aplicar o mesmo blueprint não duplica nada.
 *
 * Âncora de idempotência por recurso (o risco-chave da fase):
 *  - pipeline:        select-then-insert por (workspace_id, name) — `pipelines` NÃO
 *                     tem UNIQUE no banco (só índice), igual à rota onboarding atual.
 *  - stages:          UNIQUE (pipeline_id, position) → onConflictDoNothing.
 *  - agents:          select-then-insert por (workspace_id, name) — sem UNIQUE natural;
 *                     (workspace_id + name do template) é a combinação determinística.
 *  - agent_templates: lookup do template GLOBAL por (key, workspace_id IS NULL).
 *  - tags:            UNIQUE (workspace_id, name) → onConflictDoNothing.
 *  - conversionTypes: UNIQUE (workspace_id, key) → onConflictDoUpdate (blueprint vence).
 *  - departments:     UNIQUE (workspace_id, name) → onConflictDoUpdate.
 *  - quickReplies:    UNIQUE (workspace_id, title) → quickRepliesRepo.upsert.
 *  - flows:           select-then-insert por (workspace_id, name) — sem UNIQUE natural.
 *  - workspaces.industry: update por id (idempotente por natureza).
 *
 * `createdCounts` reporta quantos recursos de cada tipo o blueprint declara e que
 * estão garantidos após a aplicação — determinístico entre execuções (1ª == 2ª).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  agentTemplates,
  agents,
  conversionTypes,
  departments,
  flows,
  pipelines,
  stages,
  tags,
  workspaces,
} from '../../schema';
import { quickRepliesRepo } from '../../repos/quick-replies';
import type { NicheBlueprint, InstantiateResult } from './types';

export async function instantiateNicheBlueprint(
  tx: DbTx,
  workspaceId: string,
  blueprint: NicheBlueprint,
): Promise<InstantiateResult> {
  const createdCounts: Record<string, number> = {};

  // ─── Pipeline (idempotente por workspace+name) + stages (UNIQUE pipeline+position).
  const [existingPipeline] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), eq(pipelines.name, blueprint.pipeline.name)))
    .limit(1);

  let pipelineId = existingPipeline?.id;
  if (!pipelineId) {
    const [created] = await tx
      .insert(pipelines)
      .values({
        workspaceId,
        name: blueprint.pipeline.name,
        description: blueprint.pipeline.description,
        industry: blueprint.industry,
        settings: { custom_fields: blueprint.pipeline.customFields },
      })
      .returning({ id: pipelines.id });
    if (!created) throw new Error('Falha ao criar pipeline do blueprint.');
    pipelineId = created.id;
  } else {
    // Re-aplicar: blueprint vence em custom_fields/descrição (mantém o id estável).
    await tx
      .update(pipelines)
      .set({
        description: blueprint.pipeline.description,
        industry: blueprint.industry,
        settings: { custom_fields: blueprint.pipeline.customFields },
        updatedAt: new Date(),
      })
      .where(eq(pipelines.id, pipelineId));
  }
  createdCounts['pipelines'] = 1;

  for (const s of blueprint.pipeline.stages) {
    await tx
      .insert(stages)
      .values({
        workspaceId,
        pipelineId,
        name: s.name,
        color: s.color,
        position: s.position,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
        probability: s.probability == null ? null : String(s.probability),
      })
      .onConflictDoNothing({ target: [stages.pipelineId, stages.position] });
  }
  createdCounts['stages'] = blueprint.pipeline.stages.length;

  // ─── Agentes a partir de agent_templates GLOBAIS (idempotente por workspace+name).
  const agentIds: string[] = [];
  for (const ref of blueprint.agents) {
    const [template] = await tx
      .select()
      .from(agentTemplates)
      .where(and(eq(agentTemplates.key, ref.templateKey), isNull(agentTemplates.workspaceId)))
      .limit(1);
    if (!template) continue; // template do nicho ausente → ignora (F43-S03 garante o seed).

    const agentName = ref.overrides?.name ?? template.name;
    const [existingAgent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, agentName)))
      .limit(1);

    if (existingAgent) {
      agentIds.push(existingAgent.id);
      continue;
    }

    const [agent] = await tx
      .insert(agents)
      .values({
        workspaceId,
        templateId: template.id,
        name: agentName,
        description:
          ref.overrides?.description !== undefined
            ? ref.overrides.description
            : template.description,
        systemPrompt: template.promptTemplate,
        model: ref.overrides?.model ?? template.defaultModel,
        modelParams: template.defaultModelParams,
      })
      .returning({ id: agents.id });
    if (agent) agentIds.push(agent.id);
  }
  createdCounts['agents'] = agentIds.length;

  // ─── Tags (UNIQUE workspace+name).
  for (const tag of blueprint.tags) {
    await tx
      .insert(tags)
      .values({ workspaceId, name: tag.name, color: tag.color })
      .onConflictDoNothing({ target: [tags.workspaceId, tags.name] });
  }
  createdCounts['tags'] = blueprint.tags.length;

  // ─── Conversion types (UNIQUE workspace+key) — blueprint vence no conflito.
  for (const ct of blueprint.conversionTypes) {
    await tx
      .insert(conversionTypes)
      .values({
        workspaceId,
        key: ct.key,
        label: ct.label,
        color: ct.color ?? '#1FFF13',
        icon: ct.icon ?? null,
        valueRequired: ct.valueRequired ?? false,
        valueLabel: ct.valueLabel ?? null,
        currency: ct.currency ?? 'BRL',
        isDefault: ct.isDefault ?? false,
        position: ct.position ?? 0,
      })
      .onConflictDoUpdate({
        target: [conversionTypes.workspaceId, conversionTypes.key],
        set: {
          label: ct.label,
          color: ct.color ?? '#1FFF13',
          icon: ct.icon ?? null,
          valueRequired: ct.valueRequired ?? false,
          valueLabel: ct.valueLabel ?? null,
          currency: ct.currency ?? 'BRL',
          isDefault: ct.isDefault ?? false,
          position: ct.position ?? 0,
          updatedAt: new Date(),
        },
      });
  }
  createdCounts['conversionTypes'] = blueprint.conversionTypes.length;

  // ─── Departments (UNIQUE workspace+name) — resolve name→id p/ as quick replies.
  const departmentIdByName = new Map<string, string>();
  for (const dept of blueprint.departments) {
    const [row] = await tx
      .insert(departments)
      .values({ workspaceId, name: dept.name, description: dept.description ?? null })
      .onConflictDoUpdate({
        target: [departments.workspaceId, departments.name],
        set: { description: dept.description ?? null, updatedAt: new Date() },
      })
      .returning({ id: departments.id, name: departments.name });
    if (row) departmentIdByName.set(row.name, row.id);
  }
  createdCounts['departments'] = blueprint.departments.length;

  // ─── Quick replies (UNIQUE workspace+title) via repo upsert; liga ao depto pelo nome.
  for (const qr of blueprint.quickReplies) {
    const departmentId =
      qr.departmentName != null ? (departmentIdByName.get(qr.departmentName) ?? null) : null;
    await quickRepliesRepo.upsert(tx, {
      workspaceId,
      title: qr.title,
      body: qr.body,
      departmentId,
      position: qr.position ?? 0,
    });
  }
  createdCounts['quickReplies'] = blueprint.quickReplies.length;

  // ─── Flows (idempotente por workspace+name; `flows` não tem UNIQUE natural).
  for (const flow of blueprint.flows) {
    const [existingFlow] = await tx
      .select({ id: flows.id })
      .from(flows)
      .where(and(eq(flows.workspaceId, workspaceId), eq(flows.name, flow.name)))
      .limit(1);
    if (existingFlow) continue;
    await tx.insert(flows).values({
      workspaceId,
      name: flow.name,
      description: flow.description ?? null,
      status: flow.status,
      triggerType: flow.triggerType,
      triggerConfig: flow.triggerConfig ?? {},
      nodes: flow.nodes ?? [],
      edges: flow.edges ?? [],
    });
  }
  createdCounts['flows'] = blueprint.flows.length;

  // ─── workspaces.industry (idempotente por natureza).
  await tx
    .update(workspaces)
    .set({ industry: blueprint.industry, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  return { pipelineId, agentIds, createdCounts };
}
