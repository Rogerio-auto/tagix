/**
 * Mapa de error codes Meta para campanhas (CAMPAIGNS.md 10).
 *
 * Distinto do mapa de envio em meta/whatsapp/errors.ts: aqui cada codigo vira
 * uma ACAO tipada que o worker-campaigns (F6-S05) executa ao receber a falha de
 * delivery — pausar campanha, marcar recipient invalido, exigir re-engajamento,
 * contabilizar bloqueio (auto-pause se > 5%), etc. Sem any.
 */

/** Acoes possiveis em resposta a um error code Meta numa delivery de campanha. */
export type CampaignErrorAction =
  | { readonly kind: 'pause_campaign'; readonly reason: string; readonly resumeAfterMs?: number; readonly alertAdmin?: boolean }
  | { readonly kind: 'invalidate_recipient'; readonly reason: string }
  | { readonly kind: 'needs_reengagement'; readonly reason: string }
  | { readonly kind: 'count_block'; readonly reason: string; readonly pauseThresholdRatio: number }
  | { readonly kind: 'fail_delivery'; readonly reason: string };

/** Metadata estatica de um error code de campanha. */
export interface CampaignErrorInfo {
  readonly code: string;
  readonly meaning: string;
  readonly action: CampaignErrorAction;
}

/**
 * Os 6 codigos do CAMPAIGNS.md 10. `mapCampaignError` cai num default
 * (fail_delivery) para codigos nao listados.
 */
export const CAMPAIGN_ERROR_CODES: Readonly<Record<string, CampaignErrorInfo>> = {
  '130472': {
    code: '130472',
    meaning: 'Rate limit exceeded',
    action: { kind: 'pause_campaign', reason: 'rate_limit', resumeAfterMs: 5 * 60 * 1000 },
  },
  '131026': {
    code: '131026',
    meaning: 'Fora da janela 24h (so template MARKETING/UTILITY a partir dai)',
    action: { kind: 'invalidate_recipient', reason: 'outside_24h_window' },
  },
  '131047': {
    code: '131047',
    meaning: 'Re-engagement required',
    action: { kind: 'needs_reengagement', reason: 'reengagement_required' },
  },
  '131051': {
    code: '131051',
    meaning: 'Message undeliverable (destinatario bloqueado)',
    action: { kind: 'count_block', reason: 'recipient_blocked', pauseThresholdRatio: 0.05 },
  },
  '131008': {
    code: '131008',
    meaning: 'Required parameter missing',
    action: { kind: 'fail_delivery', reason: 'missing_required_parameter' },
  },
  '132001': {
    code: '132001',
    meaning: 'Template paused/disabled',
    action: { kind: 'pause_campaign', reason: 'template_disabled', alertAdmin: true },
  },
};

/** Default seguro para codigos fora do mapa: falha a delivery sem pausar a campanha. */
const DEFAULT_ACTION: CampaignErrorAction = {
  kind: 'fail_delivery',
  reason: 'unmapped_meta_error',
};

/**
 * Resolve a acao para um error code Meta (numero ou string). Codigos
 * desconhecidos retornam `fail_delivery` (nao pausa a campanha por engano).
 */
export function mapCampaignError(code: string | number | undefined | null): CampaignErrorInfo {
  const key = code === undefined || code === null ? '' : String(code);
  const hit = CAMPAIGN_ERROR_CODES[key];
  if (hit) return hit;
  return { code: key, meaning: 'Unmapped Meta error code', action: DEFAULT_ACTION };
}
