/**
 * Tipos da feature de onboarding por nicho (F5-S15).
 *
 * O wizard escolhe um nicho canonico (imobiliaria/clinica) e cria, no workspace
 * atual, um pipeline (a partir do template) e opcionalmente um agente (a partir do
 * agent_template do nicho). Os templates de pipeline/agente sao seeds globais
 * (packages/db/src/seed/*).
 */
export type NicheKey = 'real_estate' | 'clinic';

export interface NicheOption {
  key: NicheKey;
  name: string;
  description: string;
  /** Chave do agent_template do nicho (seed global). */
  agentTemplateKey: string;
  /** Pré-visualização dos estágios do funil. */
  stages: string[];
}

export interface InstantiateNicheInput {
  niche: NicheKey;
  /** Cria também um agente a partir do template do nicho. */
  createAgent: boolean;
}

export interface InstantiateNicheResult {
  pipelineId: string;
  agentId: string | null;
}
