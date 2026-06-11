import { describe, it, expect } from 'vitest';

import {
  CAMPAIGN_ERROR_CODES,
  mapCampaignError,
  type CampaignErrorAction,
} from './errors';

describe('CAMPAIGN_ERROR_CODES', () => {
  it('cobre os 6 codigos do CAMPAIGNS.md 10', () => {
    const expected = ['130472', '131026', '131047', '131051', '131008', '132001'];
    for (const code of expected) {
      expect(CAMPAIGN_ERROR_CODES[code]).toBeDefined();
      expect(CAMPAIGN_ERROR_CODES[code]?.code).toBe(code);
    }
    expect(Object.keys(CAMPAIGN_ERROR_CODES)).toHaveLength(6);
  });
});

describe('mapCampaignError', () => {
  it('130472 (rate limit) -> pause_campaign com resumeAfterMs de 5min', () => {
    const a = mapCampaignError(130472).action;
    expect(a.kind).toBe('pause_campaign');
    if (a.kind === 'pause_campaign') {
      expect(a.resumeAfterMs).toBe(5 * 60 * 1000);
    }
  });

  it('131026 (fora da janela 24h) -> invalidate_recipient', () => {
    expect(mapCampaignError('131026').action.kind).toBe('invalidate_recipient');
  });

  it('131047 (re-engagement) -> needs_reengagement', () => {
    expect(mapCampaignError(131047).action.kind).toBe('needs_reengagement');
  });

  it('131051 (bloqueado) -> count_block com threshold 5%', () => {
    const a = mapCampaignError(131051).action;
    expect(a.kind).toBe('count_block');
    if (a.kind === 'count_block') {
      expect(a.pauseThresholdRatio).toBe(0.05);
    }
  });

  it('131008 (param faltando) -> fail_delivery', () => {
    expect(mapCampaignError(131008).action.kind).toBe('fail_delivery');
  });

  it('132001 (template disabled) -> pause_campaign + alertAdmin', () => {
    const a = mapCampaignError(132001).action;
    expect(a.kind).toBe('pause_campaign');
    if (a.kind === 'pause_campaign') {
      expect(a.alertAdmin).toBe(true);
    }
  });

  it('codigo desconhecido -> fail_delivery (nao pausa por engano)', () => {
    const info = mapCampaignError(999999);
    expect(info.action.kind).toBe('fail_delivery');
    const action: CampaignErrorAction = info.action;
    expect(action.kind).not.toBe('pause_campaign');
  });

  it('code null/undefined -> default seguro', () => {
    expect(mapCampaignError(null).action.kind).toBe('fail_delivery');
    expect(mapCampaignError(undefined).action.kind).toBe('fail_delivery');
  });
});
