import { describe, it, expect, vi } from 'vitest';

import type { GraphClient } from '../shared/graphClient';
import { fetchChannelQuality, fetchMetaTemplate } from './quality';

/**
 * GraphClient mockado: a Meta NAO tem WABA real no ambiente de dev, entao o
 * caminho ponta-a-ponta (token+phone+waba reais) NAO e exercitado aqui — apenas
 * a logica de parsing/normalizacao do shape do Graph. Ver nota no quality.ts.
 */
function mockGraph(getImpl: (path: string, token: string) => unknown): GraphClient {
  return { get: vi.fn(getImpl) } as unknown as GraphClient;
}

describe('fetchChannelQuality', () => {
  it('normaliza GREEN + resolve tier limit (TIER_1K -> 1000)', async () => {
    const graph = mockGraph(() => ({ quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K' }));
    const h = await fetchChannelQuality(graph, { phoneNumberId: 'pnid', accessToken: 'tok' });
    expect(h.qualityRating).toBe('GREEN');
    expect(h.tierLimit).toBe(1000);
    expect(h.messagingTier).toBe('TIER_1K');
  });

  it('normaliza YELLOW e RED', async () => {
    const y = await fetchChannelQuality(mockGraph(() => ({ quality_rating: 'yellow' })), {
      phoneNumberId: 'p',
      accessToken: 't',
    });
    expect(y.qualityRating).toBe('YELLOW');
    const r = await fetchChannelQuality(mockGraph(() => ({ quality_rating: 'RED' })), {
      phoneNumberId: 'p',
      accessToken: 't',
    });
    expect(r.qualityRating).toBe('RED');
  });

  it('rating ausente -> UNKNOWN + limite conservador 250', async () => {
    const h = await fetchChannelQuality(mockGraph(() => ({})), {
      phoneNumberId: 'p',
      accessToken: 't',
    });
    expect(h.qualityRating).toBe('UNKNOWN');
    expect(h.tierLimit).toBe(250);
  });

  it('resposta nao-objeto -> fallback seguro', async () => {
    const h = await fetchChannelQuality(mockGraph(() => null), {
      phoneNumberId: 'p',
      accessToken: 't',
    });
    expect(h.qualityRating).toBe('UNKNOWN');
    expect(h.tierLimit).toBe(250);
  });

  it('chama o path GET correto com fields', async () => {
    const getSpy = vi.fn(() => ({ quality_rating: 'GREEN' }));
    await fetchChannelQuality(mockGraph(getSpy), { phoneNumberId: '123', accessToken: 'tok' });
    expect(getSpy).toHaveBeenCalledWith(
      '/123?fields=quality_rating,messaging_limit_tier',
      'tok',
    );
  });
});

describe('fetchMetaTemplate', () => {
  it('retorna APPROVED + MARKETING quando match existe', async () => {
    const graph = mockGraph(() => ({
      data: [{ name: 'promo', status: 'APPROVED', category: 'MARKETING', language: 'pt_BR' }],
    }));
    const t = await fetchMetaTemplate(graph, {
      wabaId: 'waba',
      accessToken: 'tok',
      templateName: 'promo',
    });
    expect(t.status).toBe('APPROVED');
    expect(t.category).toBe('MARKETING');
    expect(t.language).toBe('pt_BR');
  });

  it('filtra por idioma quando informado', async () => {
    const graph = mockGraph(() => ({
      data: [
        { name: 'promo', status: 'PENDING', category: 'UTILITY', language: 'en_US' },
        { name: 'promo', status: 'APPROVED', category: 'MARKETING', language: 'pt_BR' },
      ],
    }));
    const t = await fetchMetaTemplate(graph, {
      wabaId: 'waba',
      accessToken: 'tok',
      templateName: 'promo',
      languageCode: 'pt_BR',
    });
    expect(t.status).toBe('APPROVED');
    expect(t.language).toBe('pt_BR');
  });

  it('sem match -> NOT_FOUND + UNKNOWN', async () => {
    const t = await fetchMetaTemplate(mockGraph(() => ({ data: [] })), {
      wabaId: 'waba',
      accessToken: 'tok',
      templateName: 'nao_existe',
    });
    expect(t.status).toBe('NOT_FOUND');
    expect(t.category).toBe('UNKNOWN');
  });

  it('normaliza REJECTED/PAUSED/DISABLED', async () => {
    const mk = (status: string) =>
      mockGraph(() => ({ data: [{ name: 't', status, category: 'UTILITY' }] }));
    expect((await fetchMetaTemplate(mk('REJECTED'), { wabaId: 'w', accessToken: 't', templateName: 't' })).status).toBe('REJECTED');
    expect((await fetchMetaTemplate(mk('PAUSED'), { wabaId: 'w', accessToken: 't', templateName: 't' })).status).toBe('PAUSED');
    expect((await fetchMetaTemplate(mk('DISABLED'), { wabaId: 'w', accessToken: 't', templateName: 't' })).status).toBe('DISABLED');
  });

  it('resposta sem data -> NOT_FOUND', async () => {
    const t = await fetchMetaTemplate(mockGraph(() => ({})), {
      wabaId: 'w',
      accessToken: 't',
      templateName: 'x',
    });
    expect(t.status).toBe('NOT_FOUND');
  });
});
