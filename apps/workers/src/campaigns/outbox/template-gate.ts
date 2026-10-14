/**
 * Modelo de mensagem que a Meta não aceita mais PARA a campanha (F58-S12).
 *
 * Dois pontos de detecção, um só vocabulário de motivo:
 *  1. ANTES de enfileirar — o catálogo sincronizado (`channel_message_templates`) diz que
 *     o modelo está pausado, desativado, recusado ou indisponível: nenhum job sai.
 *  2. NO ENVIO — a Meta recusa com um código que vale para o modelo inteiro (pausado por
 *     qualidade, desativado, inexistente no idioma, variáveis que não batem): a delivery
 *     falha e a campanha PAUSA, em vez de queimar a lista inteira, um contato por vez.
 *
 * O motivo + a orientação vão para `audit_logs` (`campaign.paused`), que a API devolve
 * como `statusReason` no detalhe da campanha.
 */

/** Motivos de pausa por modelo de mensagem. */
export type TemplatePauseReason =
  | 'template_paused'
  | 'template_disabled'
  | 'template_rejected'
  | 'template_unavailable'
  | 'template_variables_mismatch'
  | 'template_components_invalid';

/** Orientação legível (o que aconteceu e o que fazer), em linguagem de produto. */
export const TEMPLATE_PAUSE_GUIDANCE: Readonly<Record<TemplatePauseReason, string>> = {
  template_paused:
    'A Meta pausou este modelo de mensagem por baixa qualidade. Paramos os envios para proteger o número. Escolha outro modelo aprovado, ou aguarde a Meta reativá-lo, e retome.',
  template_disabled:
    'A Meta desativou este modelo de mensagem. Escolha outro modelo aprovado e retome a campanha.',
  template_rejected:
    'A Meta recusou este modelo de mensagem. Escolha outro modelo aprovado e retome a campanha.',
  template_unavailable:
    'Este modelo de mensagem não está aprovado neste número (ou não existe mais neste idioma). Sincronize os modelos, escolha um aprovado e retome.',
  template_variables_mismatch:
    'As variáveis da mensagem não batem com o modelo aprovado na Meta (o modelo pode ter sido alterado). Revise as variáveis da campanha e retome.',
  template_components_invalid:
    'A mensagem desta campanha está com a configuração das variáveis inválida. Revise a etapa Mensagem e retome.',
};

/** Linha do catálogo relevante para o portão. */
export interface CatalogTemplateState {
  readonly status: string;
  readonly isAvailable: boolean;
}

/**
 * O catálogo libera o envio? `null` = pode enviar. Modelo fora do catálogo também é
 * `null`: campanhas antigas usam nome digitado sem catálogo sincronizado — a Meta decide
 * no envio, e a recusa dela cai no ponto 2.
 */
export function catalogBlockReason(row: CatalogTemplateState | null): TemplatePauseReason | null {
  if (row === null) return null;
  const status = row.status.toUpperCase();
  if (status === 'APPROVED') return row.isAvailable ? null : 'template_unavailable';
  if (status === 'PAUSED') return 'template_paused';
  if (status === 'DISABLED') return 'template_disabled';
  if (status === 'REJECTED') return 'template_rejected';
  return 'template_unavailable';
}

/**
 * Códigos da Meta (como o adapter WhatsApp os devolve: `WA_<code>`) que valem para o
 * MODELO, não para o contato. Qualquer outro código falha só aquela delivery.
 *
 * 132000/132012: número/formato de parâmetros — o mesmo passo falharia para todos.
 */
const TEMPLATE_ERROR_REASONS: Readonly<Record<string, TemplatePauseReason>> = {
  WA_132000: 'template_variables_mismatch',
  WA_132001: 'template_unavailable',
  WA_132007: 'template_rejected',
  WA_132012: 'template_variables_mismatch',
  WA_132015: 'template_paused',
  WA_132016: 'template_disabled',
};

/** Motivo de pausa para uma recusa da Meta no envio, ou `null` (falha só do contato). */
export function templateFailureReason(errorCode: string | undefined): TemplatePauseReason | null {
  if (errorCode === undefined) return null;
  return TEMPLATE_ERROR_REASONS[errorCode] ?? null;
}
