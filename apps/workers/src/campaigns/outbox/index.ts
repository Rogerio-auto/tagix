/**
 * Entrega confiável da campanha (F58-S12).
 *
 * - `bindings`: variáveis resolvidas por destinatário antes do job existir;
 * - `template-gate`: modelo que a Meta não aceita mais pausa a campanha com orientação;
 * - `outcome`: o desfecho do worker outbound volta direto para a delivery/campanha.
 *
 * A outbox em si é a transacional da F70-S16 (`@hm/db` `enqueueOutbox` + relay dos
 * workers); a retenção na pausa/cancelamento é o trigger `campaign_outbox_gate` (0095).
 */
export {
  BINDING_CONTRACT_TYPE,
  BINDING_CONTRACT_VERSION,
  decodeBindingContract,
  normalizeParameter,
  renderRecipientComponents,
  resolveBinding,
  type RecipientContact,
  type RenderComponentsOutcome,
  type RenderFailureReason,
  type TemplateBinding,
} from './bindings';
export {
  TEMPLATE_PAUSE_GUIDANCE,
  catalogBlockReason,
  templateFailureReason,
  type CatalogTemplateState,
  type TemplatePauseReason,
} from './template-gate';
export { applyCampaignDeliveryOutcome, type CampaignDeliveryOutcomeInput } from './outcome';
