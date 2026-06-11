/**
 * Campaigns-inbound (F6-S07): conecta mensagens inbound as campanhas.
 * Opt-out por keyword (match exato) + reply handling (janela 7d) + AI handoff +
 * followup on_reply. O hook do pipeline inbound (gap-fill do orchestrator) chama
 * resolveInboundMessage + processCampaignInbound apos a persistencia.
 */
export { isOptOutKeyword, OPT_OUT_KEYWORDS } from './optout';
export {
  processCampaignInbound,
  type CampaignInboundPorts,
  type CampaignInboundDeps,
  type CampaignInboundOutcome,
  type InboundMessage,
  type RecentDelivery,
} from './processor';
export {
  createCampaignInboundPorts,
  resolveInboundMessage,
  CAMPAIGN_FOLLOWUP_TYPE,
  type CampaignInboundDbDeps,
} from './db-ports';
