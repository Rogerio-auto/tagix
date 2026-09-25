/**
 * F70-S05 — atribuição de anúncio na API v1. Unitário (sem DB): presenter e spec.
 * O round-trip HTTP com Postgres fica em `routes.test.ts` (integração).
 */
import { describe, expect, it } from 'vitest';
import { toAdAttributionDto, withAdAttribution, type AdAttributionRow } from './ad-attribution';
import { buildOpenApiDocument } from './openapi';
import { contactGetResponse, dealGetResponse, listContactsQuery, listDealsQuery } from './schemas';

const EMPTY: AdAttributionRow = {
  adChannel: null,
  adSourceType: null,
  adSourceId: null,
  adSourceUrl: null,
  adHeadline: null,
  adBody: null,
  adMediaType: null,
  adCtwaClid: null,
  adReferredAt: null,
};

const FROM_AD: AdAttributionRow = {
  adChannel: 'meta_whatsapp',
  adSourceType: 'ad',
  adSourceId: '120210000000000123',
  adSourceUrl: 'https://fb.me/3cr4Wqqkv',
  adHeadline: 'Site profissional para clínicas em 5 dias',
  adBody: null,
  adMediaType: 'image',
  adCtwaClid: 'ARAkLkA8rml',
  adReferredAt: new Date('2025-09-24T13:20:00.000Z'),
};

describe('withAdAttribution', () => {
  it('sem anúncio → adAttribution null e nenhuma coluna ad* na raiz', () => {
    const out = withAdAttribution({ id: 'c1', displayName: 'Ana', ...EMPTY });
    expect(out).toEqual({ id: 'c1', displayName: 'Ana', adAttribution: null });
  });

  it('com anúncio → objeto aninhado, data ISO', () => {
    const out = withAdAttribution({ id: 'd1', title: 'Site', ...FROM_AD });
    expect(out).toEqual({
      id: 'd1',
      title: 'Site',
      adAttribution: {
        channel: 'meta_whatsapp',
        sourceType: 'ad',
        sourceId: '120210000000000123',
        sourceUrl: 'https://fb.me/3cr4Wqqkv',
        headline: 'Site profissional para clínicas em 5 dias',
        body: null,
        mediaType: 'image',
        ctwaClid: 'ARAkLkA8rml',
        referredAt: '2025-09-24T13:20:00.000Z',
      },
    });
  });

  it('atribuição pela metade (sem referredAt) não é exposta', () => {
    expect(toAdAttributionDto({ ...FROM_AD, adReferredAt: null })).toBeNull();
  });

  it('a resposta serializada valida contra o schema público', () => {
    const contact = {
      id: '8d1c1f7e-3b8a-4c63-9d3e-2f1a7b6c5d4e',
      displayName: 'Ana',
      phone: '+5521991234567',
      email: null,
      source: 'whatsapp',
      language: 'pt-BR',
      createdAt: '2025-09-24T13:20:00.000Z',
      ...FROM_AD,
    };
    const body = JSON.parse(JSON.stringify({ contact: withAdAttribution(contact) }));
    expect(contactGetResponse.safeParse(body).success).toBe(true);

    const deal = {
      id: '8d1c1f7e-3b8a-4c63-9d3e-2f1a7b6c5d4f',
      pipelineId: '8d1c1f7e-3b8a-4c63-9d3e-2f1a7b6c5d40',
      stageId: '8d1c1f7e-3b8a-4c63-9d3e-2f1a7b6c5d41',
      contactId: contact.id,
      title: 'Site',
      valueCents: 250000,
      currency: 'BRL',
      source: null,
      closedAt: null,
      closedWon: null,
      createdAt: '2025-09-24T13:20:00.000Z',
      ...EMPTY,
    };
    const dealBody = JSON.parse(JSON.stringify({ deal: withAdAttribution(deal) }));
    expect(dealGetResponse.safeParse(dealBody).success).toBe(true);
  });
});

describe('filtro adSourceId', () => {
  it('aceita id de anúncio e rejeita lixo', () => {
    expect(listContactsQuery.safeParse({ adSourceId: '120210000000000123' }).success).toBe(true);
    expect(listDealsQuery.safeParse({ adSourceId: '120210000000000123' }).success).toBe(true);
    expect(listDealsQuery.safeParse({ adSourceId: "1' or 1=1" }).success).toBe(false);
    expect(listContactsQuery.safeParse({ adSourceId: 'x'.repeat(65) }).success).toBe(false);
  });
});

describe('OpenAPI', () => {
  it('publica o componente AdAttribution e o filtro nas listas', () => {
    const doc = buildOpenApiDocument();
    expect(doc.components?.schemas?.['AdAttribution']).toBeDefined();
    const json = JSON.stringify(doc);
    expect(json).toContain('#/components/schemas/AdAttribution');
    const contactsParams = doc.paths?.['/api/v1/contacts']?.get?.parameters ?? [];
    const dealsParams = doc.paths?.['/api/v1/deals']?.get?.parameters ?? [];
    const names = (ps: readonly unknown[]): string[] =>
      ps.flatMap((p) =>
        typeof p === 'object' && p !== null && 'name' in p && typeof p.name === 'string'
          ? [p.name]
          : [],
      );
    expect(names(contactsParams)).toContain('adSourceId');
    expect(names(dealsParams)).toContain('adSourceId');
  });
});
