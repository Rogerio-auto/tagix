/**
 * Templates de pipeline por nicho (F5-S15): imobiliaria + clinica.
 *
 * Pipelines/stages sao SEMPRE workspace-scoped (nao ha pipeline global). Aqui
 * definimos as DEFINICOES de template (stages + custom_fields) e um instanciador
 * idempotente `instantiatePipelineTemplate(db, workspaceId, key)` que cria o
 * pipeline + stages no workspace (usado pelo onboarding wizard, F5-S15 web).
 *
 * Idempotencia: a UNIQUE (workspace_id, name) de pipelines ancora o upsert; os
 * stages usam UNIQUE (pipeline_id, position). Re-rodar nao duplica.
 *
 * Spec: PIPELINE.md §1/§8; ROADMAP F5-S11.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../client';
import { pipelines, stages } from '../schema';
import type { CustomFieldDef } from '../schema/pipeline';

export type NichePipelineKey = 'real_estate' | 'clinic';

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

export const PIPELINE_TEMPLATES: readonly PipelineTemplate[] = [
  {
    key: 'real_estate',
    name: 'Funil Imobiliário',
    description: 'Pipeline para captação e venda/locação de imóveis.',
    industry: 'real_estate',
    customFields: [
      { key: 'property_type', label: 'Tipo de imóvel', type: 'select', required: false, options: ['Apartamento', 'Casa', 'Terreno', 'Comercial'], position: 0 },
      { key: 'budget_brl', label: 'Orçamento (R$)', type: 'currency', required: false, position: 1 },
      { key: 'neighborhood', label: 'Bairro de interesse', type: 'text', required: false, position: 2 },
      { key: 'visit_date', label: 'Data da visita', type: 'date', required: false, position: 3 },
    ],
    stages: [
      { name: 'Novo lead', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Qualificação', color: '#13C7FF', position: 1, probability: 25 },
      { name: 'Visita agendada', color: '#FFB413', position: 2, probability: 50 },
      { name: 'Proposta', color: '#9B13FF', position: 3, probability: 75 },
      { name: 'Fechado (ganho)', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Perdido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
  {
    key: 'clinic',
    name: 'Funil Clínica',
    description: 'Pipeline para captação de pacientes e agendamento de consultas.',
    industry: 'clinic',
    customFields: [
      { key: 'procedure', label: 'Procedimento de interesse', type: 'text', required: false, position: 0 },
      { key: 'insurance', label: 'Convênio', type: 'text', required: false, position: 1 },
      { key: 'appointment_date', label: 'Data da consulta', type: 'date', required: false, position: 2 },
      { key: 'estimated_value_brl', label: 'Valor estimado (R$)', type: 'currency', required: false, position: 3 },
    ],
    stages: [
      { name: 'Novo contato', color: '#1FFF13', position: 0, probability: 10 },
      { name: 'Triagem', color: '#13C7FF', position: 1, probability: 30 },
      { name: 'Consulta agendada', color: '#FFB413', position: 2, probability: 60 },
      { name: 'Compareceu', color: '#9B13FF', position: 3, probability: 80 },
      { name: 'Tratamento fechado', color: '#13FF6B', position: 4, isWon: true, probability: 100 },
      { name: 'Não convertido', color: '#FF4136', position: 5, isLost: true, probability: 0 },
    ],
  },
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
