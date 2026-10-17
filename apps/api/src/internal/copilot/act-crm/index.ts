/**
 * Ferramentas do Copiloto · ações de CRM (propose_*: tags, contato, responsável, mover, nota, compromisso) — dono: F73-S08.
 *
 * Lugar reservado pelo F73-S03. Cada ferramenta nasce com `defineCopilotTool`
 * (`../core/registry`): `args` em `z.object({...}).strict()` sem campo de identidade,
 * capacidade do catálogo (`@hm/shared` `CAPABILITIES`) e escopo de
 * `services/copilot/identity/scope`. A composição fica em `../index.ts`.
 */
import type { CopilotToolDefinition } from '../core/registry';
import type { CapabilityExecutor } from '../core/executor-types';

export const tools: readonly CopilotToolDefinition[] = [];

/** Executores das capacidades de escrita desta área (contrato completado pelo F73-S05). */
export const executors: readonly CapabilityExecutor[] = [];
