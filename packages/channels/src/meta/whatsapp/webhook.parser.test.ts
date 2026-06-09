import { describe, it, expect } from 'vitest';

import { parseWhatsAppWebhook } from './webhook.parser';

// --- Builders de payloads WA sintéticos (sem rede/Meta real) ---

function envelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }],
      },
    ],
  };
}

describe('parseWhatsAppWebhook', () => {
  it('parseia mensagem de texto', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '5511999999999',
            id: 'wamid.TEXT',
            timestamp: '1700000000',
            type: 'text',
            text: { body: 'Olá mundo' },
          },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev).toMatchObject({
      type: 'message',
      provider: 'meta_whatsapp',
      contactRemoteId: '5511999999999',
      externalId: 'wamid.TEXT',
      messageType: 'text',
      content: 'Olá mundo',
    });
    if (ev?.type === 'message') {
      expect(ev.rawTimestamp).toBe(new Date(1700000000 * 1000).toISOString());
    }
  });

  it('parseia imagem com media_ref e caption', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '5511888888888',
            id: 'wamid.IMG',
            timestamp: '1700000001',
            type: 'image',
            image: {
              id: 'MEDIA_123',
              mime_type: 'image/jpeg',
              sha256: 'abc123',
              caption: 'foto',
            },
          },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.type).toBe('message');
    if (ev?.type === 'message') {
      expect(ev.messageType).toBe('image');
      expect(ev.content).toBe('foto');
      expect(ev.mediaRef).toEqual({
        refOrUrl: 'MEDIA_123',
        mimeType: 'image/jpeg',
        sha256: 'abc123',
      });
    }
  });

  it('distingue voice (PTT) de audio comum', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '551100000000',
            id: 'wamid.PTT',
            timestamp: '1700000002',
            type: 'audio',
            audio: { id: 'AUD_1', mime_type: 'audio/ogg', voice: true },
          },
        ],
      }),
    );
    const ev = events[0];
    expect(ev?.type === 'message' && ev.messageType).toBe('voice');
  });

  it('parseia status de entrega', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        statuses: [
          {
            id: 'wamid.OUT',
            status: 'delivered',
            timestamp: '1700000003',
            recipient_id: '5511777777777',
          },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'status',
      provider: 'meta_whatsapp',
      externalId: 'wamid.OUT',
      status: 'delivered',
    });
  });

  it('parseia resposta interativa (button_reply) com metadata', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '5511666666666',
            id: 'wamid.INT',
            timestamp: '1700000004',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'btn_yes', title: 'Sim' },
            },
          },
        ],
      }),
    );

    const ev = events[0];
    expect(ev?.type).toBe('message');
    if (ev?.type === 'message') {
      expect(ev.messageType).toBe('interactive');
      expect(ev.metadata?.['interactive']).toMatchObject({ type: 'button_reply' });
    }
  });

  it('parseia reaction como evento dedicado', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '5511555555555',
            id: 'wamid.REACT',
            timestamp: '1700000005',
            type: 'reaction',
            reaction: { message_id: 'wamid.TARGET', emoji: '👍' },
          },
        ],
      }),
    );

    expect(events[0]).toEqual({
      type: 'reaction',
      provider: 'meta_whatsapp',
      contactRemoteId: '5511555555555',
      targetExternalId: 'wamid.TARGET',
      emoji: '👍',
    });
  });

  it('captura context.id (reply) em metadata', () => {
    const events = parseWhatsAppWebhook(
      envelope({
        messages: [
          {
            from: '551144',
            id: 'wamid.REPLY',
            timestamp: '1700000006',
            type: 'text',
            text: { body: 'respondendo' },
            context: { id: 'wamid.QUOTED' },
          },
        ],
      }),
    );
    const ev = events[0];
    if (ev?.type === 'message') {
      expect(ev.metadata?.['replyToExternalId']).toBe('wamid.QUOTED');
    }
  });

  it('ignora envelopes que não são whatsapp_business_account', () => {
    expect(parseWhatsAppWebhook({ object: 'instagram', entry: [] })).toEqual([]);
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook('garbage')).toEqual([]);
  });

  it('ignora mensagens sem id/from sem lançar', () => {
    const events = parseWhatsAppWebhook(
      envelope({ messages: [{ type: 'text', text: { body: 'sem from' } }] }),
    );
    expect(events).toEqual([]);
  });
});
