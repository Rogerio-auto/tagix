/**
 * Templates de pipeline por nicho.
 *
 * Pipelines/stages sao SEMPRE workspace-scoped (nao ha pipeline global). Aqui
 * definimos as DEFINICOES de template (stages + custom_fields) e um instanciador
 * idempotente `instantiatePipelineTemplate(db, workspaceId, key)` que cria o
 * pipeline + stages no workspace (usado pelo onboarding wizard, F5-S15 web).
 *
 * FONTE ÚNICA (F43-S03): os pipelines dos 7 nichos vivem nos Niche Blueprints
 * (`seed/niches/blueprints/**`). Este módulo DERIVA `PIPELINE_TEMPLATES` do registry
 * `NICHE_BLUEPRINTS` — não duplica conteúdo. Mantém-se a chave histórica `clinic`
 * como alias do nicho `health`, para o caminho legado `POST /api/onboarding/niche`.
 *
 * Idempotencia: a UNIQUE (workspace_id, name) de pipelines ancora o upsert; os
 * stages usam UNIQUE (pipeline_id, position). Re-rodar nao duplica.
 *
 * Spec: PIPELINE.md §1/§8; ROADMAP F5-S11; ONBOARDING.md §2.3.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../client';
import { pipelines, stages } from '../schema';
import type { CustomFieldDef } from '../schema/pipeline';
import { NICHE_BLUEPRINTS, type NicheKey } from './niches';

/** Chaves aceitas pelo instanciador legado: as 7 do registry + alias `clinic`→`health`. */
export type NichePipelineKey = NicheKey | 'clinic';

interface StageTemplate {
  name: string;
  color: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
  probability?: number;
}

export interface PipelineTemplate {
  key: NichePipelineKey;
  name: string;
  description: string;
  industry: string;
  customFields: CustomFieldDef[];
  stages: StageTemplate[];
}

/** Deriva um `PipelineTemplate` a partir do pipeline de um Niche Blueprint. */
function fromBlueprint(key: NichePipelineKey, blueprintKey: NicheKey): PipelineTemplate {
  const bp = NICHE_BLUEPRINTS[blueprintKey];
  return {
    key,
    name: bp.pipeline.name,
    description: bp.pipeline.description,
    industry: bp.industry,
    customFields: bp.pipeline.customFields,
    stages: bp.pipeline.stages,
  };
}

/** Templates de pipeline = um por nicho (derivado do registry) + alias `clinic`. */
export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  fromBlueprint('real_estate', 'real_estate'),
  fromBlueprint('health', 'health'),
  fromBlueprint('education', 'education'),
  fromBlueprint('solar', 'solar'),
  fromBlueprint('retail', 'retail'),
  fromBlueprint('law', 'law'),
  fromBlueprint('agency', 'agency'),
  // Alias histórico: 'clinic' aponta para o nicho 'health' (caminho legado).
  fromBlueprint('clinic', 'health'),
];

export function getPipelineTemplate(key: NichePipelineKey): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((t) => t.key === key);
}

/**
 * Instancia um template de pipeline num workspace (idempotente). Cria o pipeline
 * (com custom_fields em settings) + os stages. Re-rodar nao duplica (ancora na
 * UNIQUE workspace+name do pipeline e pipeline+position dos stages).
 * Roda como OWNER (seed/onboarding server-side) — sem RLS.
 */
export async function instantiatePipelineTemplate(
  db: DB,
  workspaceId: string,
  key: NichePipelineKey,
): Promise<{ pipelineId: string } | null> {
  const tpl = getPipelineTemplate(key);
  if (!tpl) return null;

  const existing = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, workspaceId), eq(pipelines.name, tpl.name)))
    .limit(1);

  let pipelineId = existing[0]?.id;
  if (!pipelineId) {
    const [created] = await db
      .insert(pipelines)
      .values({
        workspaceId,
        name: tpl.name,
        description: tpl.description,
        industry: tpl.industry,
        isDefault: false,
        settings: { custom_fields: tpl.customFields },
      })
      .returning({ id: pipelines.id });
    if (!created) throw new Error('Falha ao criar pipeline do template.');
    pipelineId = created.id;
  } else {
    await db
      .update(pipelines)
      .set({ settings: { custom_fields: tpl.customFields }, updatedAt: new Date() })
      .where(eq(pipelines.id, pipelineId));
  }

  for (const s of tpl.stages) {
    await db
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

  return { pipelineId };
}
