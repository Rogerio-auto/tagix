/**
 * Liberações de escrita das tools de contato por agente semeado (F70-S23).
 *
 * `add_contact_tag` e `update_contact` negam tudo por padrão: o catálogo global não
 * declara `allowed_tags` nem `custom_fields_write_keys` (`tools_agent.ts`). Um agente só
 * aplica etiqueta ou grava campo personalizado que o operador liberou em
 * `agent_tools.overrides` (regra em `apps/api/src/internal/tools/contact-handlers.ts`).
 *
 * Este módulo é a fonte dos `overrides` que um seed grava no vínculo agente ↔ tool.
 *
 * Arcada (F70-S06):
 *  - `add_contact_tag`: só `atendimento-humano` — o prompt manda o agente etiquetar quando
 *    uma pessoa da equipe precisa assumir, e a cadência para com ela.
 *    `ia-arcada` é a trava de reativação do flow de ativação e `esfriou` é da cadência:
 *    os dois são dos flows, não do modelo. Etiqueta de conversão NUNCA entra aqui: ela
 *    registraria conversão pelo trigger da 0027 sem passar por `register_conversion`
 *    (e o Node ainda recusa, sem `allow_agent_conversions`, qualquer etiqueta mapeada);
 *  - `update_contact`: nenhum campo personalizado (o agente da Arcada não grava nenhum).
 */
import { ARCADA_TAGS } from './agent_templates_arcada.content';

export type AgentToolOverrides = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export const ARCADA_AGENT_TOOL_OVERRIDES: AgentToolOverrides = {
  add_contact_tag: { allowed_tags: [ARCADA_TAGS.humanTakeover.name] },
  update_contact: { custom_fields_write_keys: [] },
};

/** `overrides` do vínculo agente ↔ tool `toolKey` (`{}` se o seed não libera nada). */
export function seededToolOverrides(
  grants: AgentToolOverrides,
  toolKey: string,
): Record<string, unknown> {
  const found = Object.hasOwn(grants, toolKey) ? grants[toolKey] : undefined;
  return found === undefined ? {} : structuredClone({ ...found });
}
