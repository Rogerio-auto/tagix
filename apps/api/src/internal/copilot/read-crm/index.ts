/**
 * Ferramentas do Copiloto · consultas de CRM (contatos, negócios, funil, agregações e
 * previsão de receita) sob o escopo do membro — F73-S06.
 *
 * Cada ferramenta nasce com `defineCopilotTool` (`../core/registry`): `args` em
 * `z.object({...}).strict()` sem campo de identidade, `capability: 'query'` e o escopo de
 * `services/copilot/identity/scope` (o escopo do Copiloto vive num só lugar). A composição
 * com as demais áreas fica em `../index.ts`.
 *
 * | key                    | permissão      | cartão                      | contamina o turno |
 * |------------------------|----------------|-----------------------------|-------------------|
 * | search_contacts        | contact.view   | table                       | sim               |
 * | get_contact            | contact.view   | contact_card                | sim               |
 * | list_deals             | pipeline.view  | deal_list                   | não               |
 * | get_deal               | pipeline.view  | deal_card                   | não               |
 * | aggregate_deals        | pipeline.view  | table · series (por mês)    | não               |
 * | get_pipeline_overview  | pipeline.view  | funnel                      | não               |
 * | forecast_revenue       | pipeline.view  | kpis                        | não               |
 * | list_members           | pipeline.view  | table                       | não               |
 */
import type { CopilotToolDefinition } from '../core/registry';
import { aggregateDeals } from './aggregate-deals';
import { forecastRevenue } from './forecast-revenue';
import { getContact } from './get-contact';
import { getDeal } from './get-deal';
import { listDeals } from './list-deals';
import { listMembers } from './list-members';
import { getPipelineOverview } from './pipeline-overview';
import { searchContacts } from './search-contacts';

export const tools: readonly CopilotToolDefinition[] = [
  searchContacts,
  getContact,
  listDeals,
  getDeal,
  aggregateDeals,
  getPipelineOverview,
  forecastRevenue,
  listMembers,
];
