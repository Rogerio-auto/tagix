import { describe, expect, it } from 'vitest';

import { parseInstagramWebhook } from '../instagram/webhook.parser';
import {
  isPaidAdReferral,
  parseInstagramReferral,
  parseWhatsAppReferral,
  readAdReferral,
  toAdAttributionColumns,
} from './ad-referral';
import {
  CTWA_POST_IMAGE_WEBHOOK,
  CTWA_TEXT_WEBHOOK,
  IG_AD_MESSAGE_WEBHOOK,
} from './ad-referral.fixtures';
import { adReferralFromInboundEvent, parseWhatsAppWebhook } from './webhook.parser';

const AT = '2025-09-24T13:20:00.000Z';

describe('Click-to-WhatsApp no parser WA (payload real)', () => {
  it('extrai o referral normalizado em metadata.adReferral, sem perder a mensagem', () => {
    const [ev] = parseWhatsAppWebhook(CTWA_TEXT_WEBHOOK);
    expect(ev).toMatchObject({
      type: 'message',
      provider: 'meta_whatsapp',
      contactRemoteId: '5521991234567',
      contactName: 'Marina Souza',
      messageType: 'text',
      content: 'Olá! Tenho interesse e queria mais informações, por favor.',
    });
    if (ev?.type !== 'message') throw new Error('esperava message');
    expect(ev.metadata?.['adReferral']).toEqual({
      channel: 'meta_whatsapp',
      sourceType: 'ad',
      sourceId: '120210000000000123',
      sourceUrl: 'https://fb.me/3cr4Wqqkv',
      headline: 'Site profissional para clínicas em 5 dias',
      body: 'Fale com a gente pelo WhatsApp e receba o portfólio.',
      mediaType: 'image',
      ctwaClid:
        'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a',
      imageUrl: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/ad_image.jpg',
      thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/ad_thumb.jpg',
      referredAt: '2025-09-24T13:20:00.000Z',
    });
  });

  it('referral chega em mensagem de mídia (post impulsionado) junto com a mídia', () => {
    const [ev] = parseWhatsAppWebhook(CTWA_POST_IMAGE_WEBHOOK);
    if (ev?.type !== 'message') throw new Error('esperava message');
    expect(ev.messageType).toBe('image');
    expect(ev.mediaRef?.refOrUrl).toBe('MEDIA_ID_1');
    const ref = adReferralFromInboundEvent(ev);
    expect(ref).toMatchObject({
      sourceType: 'post',
      sourceId: '17912345678901234',
      mediaType: 'video',
    });
    expect(ref?.ctwaClid).toBeUndefined();
    expect(isPaidAdReferral(ref)).toBe(true);
  });

  it('mensagem sem referral não ganha metadata.adReferral', () => {
    const [ev] = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: '5511',
                    id: 'wamid.X',
                    timestamp: '1',
                    type: 'text',
                    text: { body: 'oi' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    if (ev?.type !== 'message') throw new Error('esperava message');
    expect(ev.metadata).toBeUndefined();
    expect(adReferralFromInboundEvent(ev)).toBeUndefined();
  });

  it('referral malformado não derruba a mensagem', () => {
    const [ev] = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: '5511',
                    id: 'wamid.Y',
                    timestamp: '1',
                    type: 'text',
                    text: { body: 'oi' },
                    referral: 'nao-e-objeto',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(ev).toMatchObject({ type: 'message', content: 'oi' });
  });
});

describe('parseWhatsAppReferral (tolerância campo a campo)', () => {
  it('campos ausentes viram undefined; só ctwa_clid basta', () => {
    expect(parseWhatsAppReferral({ ctwa_clid: 'CLID' }, AT)).toEqual({
      channel: 'meta_whatsapp',
      sourceType: 'ad',
      ctwaClid: 'CLID',
      referredAt: AT,
    });
  });

  it('tipos errados são ignorados, source_id numérico vira string', () => {
    const r = parseWhatsAppReferral(
      { source_id: 1202100, source_type: 42, headline: ['x'], body: '   ', media_type: 'IMAGE' },
      AT,
    );
    expect(r).toEqual({
      channel: 'meta_whatsapp',
      sourceType: 'ad',
      sourceId: '1202100',
      mediaType: 'image',
      referredAt: AT,
    });
  });

  it('URL não-http é descartada (javascript:, lixo)', () => {
    const r = parseWhatsAppReferral(
      { source_id: 'A', source_url: 'javascript:alert(1)', image_url: 'not a url' },
      AT,
    );
    expect(r?.sourceUrl).toBeUndefined();
    expect(r?.imageUrl).toBeUndefined();
  });

  it('trunca campo gigante', () => {
    const r = parseWhatsAppReferral({ source_id: 'A', body: 'x'.repeat(10_000) }, AT);
    expect(r?.body).toHaveLength(2048);
  });

  it('sem nenhum dado identificador → undefined', () => {
    expect(parseWhatsAppReferral({}, AT)).toBeUndefined();
    expect(parseWhatsAppReferral({ source_type: 'ad', media_type: 'image' }, AT)).toBeUndefined();
    expect(parseWhatsAppReferral(null, AT)).toBeUndefined();
    expect(parseWhatsAppReferral([], AT)).toBeUndefined();
  });
});

describe('Instagram referral no mesmo formato', () => {
  it('primeira DM de anúncio: metadata.adReferral normalizado', () => {
    const [ev] = parseInstagramWebhook(IG_AD_MESSAGE_WEBHOOK);
    if (ev?.type !== 'message') throw new Error('esperava message');
    expect(ev.content).toBe('Quero saber o valor do site');
    expect(ev.metadata?.['adReferral']).toEqual({
      channel: 'meta_instagram',
      sourceType: 'ad',
      sourceId: '120210000000000456',
      headline: 'Seu consultório com site em 5 dias',
      ref: 'arcada_setembro',
      imageUrl: 'https://scontent.cdninstagram.com/v/ad_photo.jpg',
      mediaType: 'image',
      referredAt: new Date(1758720000000).toISOString(),
    });
    expect(isPaidAdReferral(adReferralFromInboundEvent(ev))).toBe(true);
  });

  it('evento referral avulso (messaging[].referral) normaliza via adReferralFromInboundEvent', () => {
    const [ev] = parseInstagramWebhook({
      object: 'instagram',
      entry: [
        {
          messaging: [
            {
              sender: { id: 'IGSID_1' },
              timestamp: 1758720000000,
              referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '999' },
            },
          ],
        },
      ],
    });
    expect(ev).toMatchObject({ type: 'referral', source: 'ADS' });
    if (ev === undefined) throw new Error('esperava evento');
    expect(adReferralFromInboundEvent(ev)).toMatchObject({
      channel: 'meta_instagram',
      sourceType: 'ad',
      sourceId: '999',
    });
  });

  it('link ig.me com ref (não pago) não conta como anúncio', () => {
    const r = parseInstagramReferral({ ref: 'bio', source: 'SHORTLINK' }, AT);
    expect(r).toMatchObject({ sourceType: 'shortlink', ref: 'bio' });
    expect(isPaidAdReferral(r)).toBe(false);
  });

  it('post orgânico no IG não é pago (só no WA post = impulsionado)', () => {
    expect(
      isPaidAdReferral({
        channel: 'meta_instagram',
        sourceType: 'post',
        sourceId: '1',
        referredAt: AT,
      }),
    ).toBe(false);
    expect(
      isPaidAdReferral({
        channel: 'meta_whatsapp',
        sourceType: 'post',
        sourceId: '1',
        referredAt: AT,
      }),
    ).toBe(true);
    expect(isPaidAdReferral(undefined)).toBe(false);
  });
});

describe('readAdReferral / toAdAttributionColumns', () => {
  it('round-trip JSON (metadata jsonb) preserva o referral', () => {
    const r = parseWhatsAppReferral(
      CTWA_TEXT_WEBHOOK.entry[0].changes[0].value.messages[0].referral,
      AT,
    );
    expect(readAdReferral(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('rejeita metadata adulterado', () => {
    expect(
      readAdReferral({ channel: 'waha', sourceType: 'ad', sourceId: '1', referredAt: AT }),
    ).toBeUndefined();
    expect(
      readAdReferral({ channel: 'meta_whatsapp', sourceId: '1', referredAt: AT }),
    ).toBeUndefined();
    expect(readAdReferral('x')).toBeUndefined();
  });

  it('colunas: sem URLs de mídia (expiram), nulls explícitos, Date', () => {
    const cols = toAdAttributionColumns({
      channel: 'meta_whatsapp',
      sourceType: 'ad',
      sourceId: 'AD1',
      ctwaClid: 'CLID',
      imageUrl: 'https://cdn/x.jpg',
      referredAt: AT,
    });
    expect(cols).toEqual({
      adChannel: 'meta_whatsapp',
      adSourceType: 'ad',
      adSourceId: 'AD1',
      adSourceUrl: null,
      adHeadline: null,
      adBody: null,
      adMediaType: null,
      adCtwaClid: 'CLID',
      adReferredAt: new Date(AT),
    });
  });
});
