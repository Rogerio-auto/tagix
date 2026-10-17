/**
 * Ferramentas do Copiloto · memória (lembrar fato) — dono: F73-S11.
 *
 * Lugar reservado pelo F73-S03. Cada ferramenta nasce com `defineCopilotTool`
 * (`../core/registry`): `args` em `z.object({...}).strict()` sem campo de identidade,
 * capacidade do catálogo (`@hm/shared` `CAPABILITIES`) e escopo de
 * `services/copilot/identity/scope`. A composição fica em `../index.ts`.
 */
import type { CopilotToolDefinition } from '../core/registry';

export const tools: readonly CopilotToolDefinition[] = [];
