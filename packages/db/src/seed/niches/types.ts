/**
 * Modelo declarativo de Niche Blueprint (ONBOARDING.md §2.1).
 *
 * Um `NicheBlueprint` é a FONTE ÚNICA por nicho: descreve o pacote completo que um
 * workspace recebe ao entrar na Leadium já pronto para o seu segmento — funil,
 * agente(s), etiquetas, tipos de conversão, departamentos, respostas rápidas e
 * fluxos. O conteúdo dos 7 nichos e o registry (key → blueprint) são do F43-S03;
 * aqui definimos só os TIPOS + o instanciador genérico (`instantiate.ts`).
 *
 * Os sub-tipos espelham as colunas reais dos schemas que o instanciador escreve
 * (não inventam campos): `pipelines`/`stages` (pipeline.ts), `agent_templates`
 * (agent_templates.ts), `tags` (tags.ts), `conversion_types` (conversions.ts),
 * `departments` (org.ts), `quick_replies` (quick_replies.ts), `flows` (flows.ts).
 */
import type { CustomFieldDef } from '../../schema/pipeline';
import type { TRIGGER_TYPES } from '../../schema/flows';

/** Estágio do funil do nicho. Espelha colunas relevantes de `stages`. */
export interface BlueprintStage {
  name: string;
  color: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
  /** 0..100; gravado como numeric (string) no insert. */
  probability?: number;
}

/** Definição do pipeline do nicho (vira 1 linha em `pipelines` + N `stages`). */
export interface BlueprintPipeline {
  name: string;
  description: string;
  /** Custom field defs — gravados em `pipelines.settings.custom_fields`. */
  customFields: CustomFieldDef[];
  stages: BlueprintStage[];
}

/**
 * Referência a um `agent_templates` GLOBAL existente (criado por
 * `agent_templates_niche.ts`/F2), por `key`. `overrides` permite ajustar
 * nome/descrição/modelo do `agents` instanciado sem editar o template global.
 */
export interface AgentTemplateRef {
  /** `agent_templates.key` do template global (workspace_id IS NULL). */
  templateKey: string;
  overrides?: {
    name?: string;
    description?: string | null;
    model?: string;
  };
}

/** Etiqueta do nicho. Espelha `tags` (UNIQUE workspace+name). */
export interface BlueprintTag {
  name: string;
  color: string;
}

/**
 * Tipo de conversão do nicho. Espelha colunas de `conversion_types`
 * (UNIQUE workspace+key). `key` é o slug determinístico (âncora de idempotência);
 * `label` é o rótulo pt-BR.
 */
export interface BlueprintConversionType {
  key: string;
  label: string;
  color?: string;
  icon?: string | null;
  valueRequired?: boolean;
  valueLabel?: string | null;
  currency?: string;
  isDefault?: boolean;
  position?: number;
}

/** Departamento do nicho. Espelha `departments` (UNIQUE workspace+name). */
export interface BlueprintDepartment {
  name: string;
  description?: string | null;
}

/**
 * Resposta rápida do nicho. Espelha `quick_replies` (UNIQUE workspace+title).
 * `departmentName` (opcional) liga a resposta a um departamento do blueprint pelo
 * NOME — o instanciador resolve para `department_id` após criar os departamentos.
 */
export interface BlueprintQuickReply {
  title: string;
  body: string;
  departmentName?: string;
  position?: number;
}

/** Tipo de gatilho aceito por `flows.trigger_type`. */
export type FlowTriggerType = (typeof TRIGGER_TYPES)[number];

/**
 * Forma mínima para inserir uma linha em `flows`. O CONTEÚDO do grafo
 * (`nodes`/`edges`) é responsabilidade do F43-S03/S09 — aqui só o tipo precisa
 * existir e o insert genérico funcionar. Nichos sem flow prontos usam `flows: []`.
 */
export interface FlowTemplate {
  name: string;
  description?: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  triggerType: FlowTriggerType;
  triggerConfig?: Record<string, unknown>;
  nodes?: unknown[];
  edges?: unknown[];
}

/** Pacote declarativo completo de um nicho (ONBOARDING.md §2.1). */
export interface NicheBlueprint {
  /** ex.: 'real_estate' | 'health' | 'education' | 'solar' | 'retail' | 'law' | 'agency'. */
  key: string;
  /** Rótulo pt-BR (ex.: "Imobiliária"). */
  name: string;
  /** Gravado em `workspaces.industry`. */
  industry: string;
  pipeline: BlueprintPipeline;
  agents: AgentTemplateRef[];
  tags: BlueprintTag[];
  conversionTypes: BlueprintConversionType[];
  departments: BlueprintDepartment[];
  quickReplies: BlueprintQuickReply[];
  flows: FlowTemplate[];
}

/** Resumo do que o instanciador aplicou (ONBOARDING.md §2.2). */
export interface InstantiateResult {
  pipelineId: string;
  agentIds: string[];
  /** Contagem de recursos POR TIPO após a aplicação (idempotente). */
  createdCounts: Record<string, number>;
}
