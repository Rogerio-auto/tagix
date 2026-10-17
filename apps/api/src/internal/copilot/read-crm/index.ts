/**
 * Ferramentas do Copiloto · consultas de CRM (pipeline, negócios, contatos, conversas) — dono: F73-S06.
 *
 * Lugar reservado pelo F73-S03. Cada ferramenta nasce com `defineCopilotTool`
 * (`../core/registry`): `args` em `z.object({...}).strict()` sem campo de identidade,
 * capacidade do catálogo (`@hm/shared` `CAPABILITIES`) e escopo de
 * `services/copilot/identity/scope`. A composição fica em `../index.ts`.
 */
import type { CopilotToolDefinition } from '../core/registry';

export const tools: readonly CopilotToolDefinition[] = [];
