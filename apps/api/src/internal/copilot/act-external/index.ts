/**
 * Ferramentas do Copiloto · ações externas (nível 4) — dono: F73-S09.
 *
 * | ferramenta               | capacidade(s)                                  | desfazer                      |
 * |--------------------------|------------------------------------------------|-------------------------------|
 * | propose_send_messages    | message.send                                   | não (mensagem não volta)      |
 * | propose_campaign_status  | campaign.pause · campaign.resume · campaign.cancel | pausar ↔ retomar; cancelar não |
 * | propose_trigger_flow     | flow.trigger                                   | cancela execuções pendentes   |
 *
 * Toda escrita nasce do motor de propostas (`makeProposeTool`/`defineEngineTool`): o nível é do
 * sistema (`classifyRisk`, sempre 4 aqui: externo), a política é recalculada no confirmar e nada
 * sai sem a caixa "Revisei". Os executores também ficam em `executors` (composição em
 * `../index.ts`, `COPILOT_EXECUTORS`) para o confirmar, a varredura e o desfazer acharem a
 * capacidade.
 */
import type { CopilotToolDefinition } from '../core/registry';
import type { CapabilityExecutor } from '../core/executor-types';
import { CAMPAIGN_EXECUTORS, campaignStatusTool } from './campaign-status';
import { sendMessagesExecutor, sendMessagesTool } from './send-messages';
import { triggerFlowExecutor, triggerFlowTool } from './trigger-flow';

export const tools: readonly CopilotToolDefinition[] = [
  sendMessagesTool,
  campaignStatusTool,
  triggerFlowTool,
];

/** Executores das capacidades de escrita desta área (contrato completado pelo F73-S05). */
export const executors: readonly CapabilityExecutor[] = [
  sendMessagesExecutor,
  ...CAMPAIGN_EXECUTORS,
  triggerFlowExecutor,
];

export {
  CAMPAIGN_STATUS_TOOL_KEY,
  CampaignStatusArgsSchema,
  campaignCancelExecutor,
  campaignPauseExecutor,
  campaignResumeExecutor,
  makeCampaignStatusTool,
} from './campaign-status';
export { SEND_MESSAGES_TOOL_KEY, sendMessagesExecutor } from './send-messages';
export { SendMessagesArgsSchema, type SendMessagesArgs } from './message-args';
export { TRIGGER_FLOW_TOOL_KEY, TriggerFlowArgsSchema, triggerFlowExecutor } from './trigger-flow';
