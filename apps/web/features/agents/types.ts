/**
 * Tipos e schemas Zod compartilhados da feature de agentes IA.
 *
 * Espelham o JSON público de @hm/api (F2-S16) — sem segredos (`apiTokenHash`
 * NUNCA trafega). Owned por F2-S17; F2-S18 (detail) e F2-S19 (playground)
 * importam estes tipos read-only e adicionam o que for específico nos seus
 * diretórios.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Agente                                                              */
/* ------------------------------------------------------------------ */

export const AGENT_STATUSES = ['active', 'inactive', 'archived'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Agente como devolvido por `GET /api/agents` (PUBLIC_AGENT_COLUMNS). */
export interface Agent {
  id: string;
  workspaceId: string;
  templateId: string | null;
  name: string;
  description: string | null;
  systemPrompt: string;
  model: string | null;
  modelParams: Record<string, unknown> | null;
  visionModel: string | null;
  transcriptionModel: string | null;
  status: AgentStatus;
  aggregationEnabled: boolean;
  aggregationWindowSec: number;
  maxBatchMessages: number;
  replyIfIdleSec: number | null;
  allowHandoff: boolean;
  ignoreGroupMessages: boolean;
  enabledChannelIds: string[] | null;
  createdAt: string;
  updatedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Catálogo de modelos (policy do workspace)                          */
/* ------------------------------------------------------------------ */

/**
 * Modelo disponível para seleção no wizard.
 *
 * Vem de `GET /api/agents/models` → `{ models: AgentModel[] }`. `allowed` =
 * permitido pela policy do workspace (F2-S09). Endpoint é um gap-fill do
 * orchestrator; quando ausente o wizard degrada graciosamente (ver queries.ts).
 */
export interface AgentModel {
  slug: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  promptUsd: number;
  completionUsd: number;
  supportsTools: boolean;
  supportsVision: boolean;
  /** Permitido pela policy do workspace. */
  allowed: boolean;
}

/* ------------------------------------------------------------------ */
/* Templates + perguntas do wizard                                    */
/* ------------------------------------------------------------------ */

/** Tipos de pergunta suportados (espelha o CHECK de `agent_template_questions`). */
export const TEMPLATE_QUESTION_TYPES = [
  'text',
  'textarea',
  'select',
  'number',
  'boolean',
  'multiselect',
] as const;
export type TemplateQuestionType = (typeof TEMPLATE_QUESTION_TYPES)[number];

/** Pergunta do template que vira input do formulário do wizard. */
export interface TemplateQuestion {
  key: string;
  label: string;
  type: TemplateQuestionType;
  required: boolean;
  help?: string | null;
  /** Opções para `select`/`multiselect`. */
  options?: string[];
}

/**
 * Template de agente disponível para criação.
 *
 * Vem de `GET /api/agents/templates` → `{ templates: AgentTemplate[] }`.
 * Endpoint é um gap-fill do orchestrator (contrato abaixo).
 */
export interface AgentTemplate {
  id: string;
  key: string;
  name: string;
  category: string | null;
  description?: string | null;
  defaultModel: string;
  questions: TemplateQuestion[];
}

/* ------------------------------------------------------------------ */
/* Payload de criação (POST /api/agents)                              */
/* ------------------------------------------------------------------ */

/**
 * Schema do passo de detalhes do agente (nome + modelo escolhido). As respostas
 * às `agent_template_questions` são validadas dinamicamente em runtime no wizard
 * (cada pergunta `required` precisa de valor) — aqui ficam os campos fixos.
 */
export const createAgentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Dê um nome ao agente')
    .max(120, 'No máximo 120 caracteres'),
  templateId: z.string().uuid('Selecione um template'),
  model: z.string().trim().min(1).max(120).optional(),
});
export type CreateAgentFields = z.infer<typeof createAgentSchema>;

/** Valor de uma resposta a uma `agent_template_question`. */
export type TemplateAnswerValue = string | number | boolean | string[];

/** Body completo enviado ao `POST /api/agents`. */
export interface CreateAgentInput {
  name: string;
  templateId: string;
  model?: string;
  description?: string;
  /**
   * Respostas às `agent_template_questions`, indexadas por `question.key`.
   * O backend materializa o `system_prompt` do template a partir delas. Campo
   * forward-compat: a API atual ignora chaves desconhecidas (Zod strip), então
   * é seguro enviar mesmo antes do wiring de materialização.
   */
  answers?: Record<string, TemplateAnswerValue>;
}
