/**
 * Ferramentas do Copiloto · memória (lembrar fato) — dono: F73-S11.
 *
 * `propose_memory_remember` é escrita: nasce de `makeProposeTool` sobre o executor completo
 * (`remember-fact.ts`); `defineCopilotTool` recusa escrita. O executor precisa também estar em
 * `COPILOT_EXECUTORS` (`../index.ts`) para o confirmar do nível 3 achar a capacidade:
 * `import { executors as memoryExecutors } from './memory-tools'`.
 */
import type { CapabilityExecutor } from '../core/executor-types';
import type { CopilotToolDefinition } from '../core/registry';
import { makeProposeTool } from '../../../services/copilot/proposals';
import { REMEMBER_FACT_TOOL_DESCRIPTION, rememberFactExecutor } from './remember-fact';

export const tools: readonly CopilotToolDefinition[] = [
  makeProposeTool(rememberFactExecutor, { description: REMEMBER_FACT_TOOL_DESCRIPTION }),
];

/** Executores das capacidades de escrita desta área (motor de propostas, F73-S05). */
export const executors: readonly CapabilityExecutor[] = [rememberFactExecutor];

export {
  MEMORY_TARGET_TYPE,
  REMEMBER_FACT_TOOL_DESCRIPTION,
  RememberFactArgsSchema,
  rememberFactExecutor,
  type RememberFactArgs,
} from './remember-fact';
