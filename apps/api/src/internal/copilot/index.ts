/**
 * Composição do callback interno do Copiloto (F73-S03).
 *
 * Cada área registra as próprias ferramentas no seu `index.ts`; este arquivo só as junta.
 * Ferramenta nova = entrada no array da área dona, nunca aqui.
 *
 *   read-crm      F73-S06   consultas de CRM
 *   read-ops      F73-S07   consultas operacionais
 *   act-crm       F73-S08   ações de CRM (+ executores)
 *   act-external  F73-S09   ações externas (+ executores)
 *   memory-tools  F73-S11   memória
 *
 * Montado em `app.ts` fora de `requireAuth` (auth de serviço + grant), como o caminho de agente.
 */
import type { Router } from 'express';
import type { DbTx } from '@hm/db';
import type { CopilotToolDescriptor } from '@hm/shared';
import type { CopilotPrincipal } from '../../services/copilot/identity/principal';
import { executors as actCrmExecutors, tools as actCrmTools } from './act-crm';
import { executors as actExternalExecutors, tools as actExternalTools } from './act-external';
import type { CapabilityExecutor } from './core/executor-types';
import {
  listToolDescriptorsFor,
  loadToolOfferContext,
  type CopilotToolDefinition,
} from './core/registry';
import { createCopilotToolsRouter, type CopilotToolsRouterOptions } from './core/router';
import { tools as memoryTools } from './memory-tools';
import { tools as readCrmTools } from './read-crm';
import { tools as readOpsTools } from './read-ops';

/** Todas as ferramentas do Copiloto, na ordem em que o modelo as vê. */
export const COPILOT_TOOLS: readonly CopilotToolDefinition[] = Object.freeze([
  ...readCrmTools,
  ...readOpsTools,
  ...actCrmTools,
  ...actExternalTools,
  ...memoryTools,
]);

/** Executores das capacidades de escrita (motor de propostas, F73-S05). */
export const COPILOT_EXECUTORS: readonly CapabilityExecutor[] = Object.freeze([
  ...actCrmExecutors,
  ...actExternalExecutors,
]);

/**
 * Descritores que o modelo vê neste turno (F73-S10 monta o `CopilotRunRequest.tools`).
 *
 * Carrega o contexto de oferta (papéis dos OUTROS membros ativos) sob o `tx` RLS do turno, para
 * que uma `propose_*` apareça também a quem só pode PEDIR aprovação (o motor grava `blocked`
 * com o "Pedir aprovação"; ADR-003 §5 e §7). Sem aprovador possível, a escrita não é oferecida.
 * `tools` é injetável só para testes; produção usa o registro completo.
 */
export async function copilotToolDescriptorsFor(
  tx: DbTx,
  principal: CopilotPrincipal,
  tools: readonly CopilotToolDefinition[] = COPILOT_TOOLS,
): Promise<CopilotToolDescriptor[]> {
  const offer = await loadToolOfferContext(tx, principal);
  return listToolDescriptorsFor(principal, tools, offer);
}

/** `POST /internal/copilot/tools/:key` com o registro completo. */
export function createCopilotInternalRouter(
  options: Omit<CopilotToolsRouterOptions, 'tools'> = {},
): Router {
  return createCopilotToolsRouter({ ...options, tools: COPILOT_TOOLS });
}

export {
  defineCopilotTool,
  listToolDescriptorsFor,
  type CopilotToolContext,
  type CopilotToolDefinition,
  type CopilotToolSpec,
  type EmittedResult,
  type ToolResultCardInput,
} from './core/registry';
export { COPILOT_MODEL_VIEWS, createCopilotToolsRouter } from './core/router';
export type { CapabilityExecutor } from './core/executor-types';
