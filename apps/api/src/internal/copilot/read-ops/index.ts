/**
 * Ferramentas do Copiloto · consultas de operação (conversas, agenda, campanhas e base de
 * conhecimento) sob o escopo do membro — F73-S07.
 *
 * Cada ferramenta nasce com `defineCopilotTool` (`../core/registry`): `args` em
 * `z.object({...}).strict()` sem campo de identidade, `capability: 'query'` e o escopo de
 * `services/copilot/identity/scope` (conversas) ou da agenda (`calendarRepo`, por import).
 * Texto de terceiro vai em `model_view.untrusted` no formato de `./untrusted`. A composição
 * com as demais áreas fica em `../index.ts`.
 *
 * | key                      | permissão             | cartão            | contamina o turno |
 * |--------------------------|-----------------------|-------------------|-------------------|
 * | list_conversations       | conversation.view     | conversation_list | não               |
 * | get_conversation_digest  | conversation.view     | (sem cartão)      | sim               |
 * | list_events              | calendar.view         | event_list        | sim               |
 * | list_campaigns           | campaign.list         | table             | não               |
 * | get_campaign             | campaign.view_metrics | campaign_card     | não               |
 * | search_knowledge         | agent.list            | table             | sim               |
 */
import type { CopilotToolDefinition } from '../core/registry';
import { getCampaign, listCampaigns } from './campaigns';
import { getConversationDigest } from './conversation-digest';
import { listConversations } from './list-conversations';
import { listEvents } from './list-events';
import { searchKnowledge } from './search-knowledge';

export const tools: readonly CopilotToolDefinition[] = [
  listConversations,
  getConversationDigest,
  listEvents,
  listCampaigns,
  getCampaign,
  searchKnowledge,
];
