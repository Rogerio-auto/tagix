import { describe, it, expect } from 'vitest';

import { parseWahaWebhook } from './webhook.parser';

// --- Builders de payloads WAHA sintéticos (sem rede / WAHA real) ---

function messageEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  return { event: 'message', session: 'default', payload };
}

function ackEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  return { event: 'message.ack', session: 'default', payload };
}

describe('parseWahaWebhook', () => {
  it('parseia mensagem de texto (type chat)', () => {
    const events = parseWahaWebhook(
      messageEnvelope({
        id: 'false_5511999@c.us_ABC',
        from: '5511999@c.us',
        fromMe: false,
        type: 'chat',
        body: 'Olá mundo',
        timestamp: 1700000000,
      }),
    );

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev).toMatchObject({
      type: 'message',
      provider: 'waha',
      contactRemoteId: '5511999@c.us',
      externalId: 'false_5511999@c.us_ABC',
      messageType: 'text',
      content: 'Olá mundo',
    });
    if (ev?.type === 'message') {
      expect(ev.rawTimestamp).toBe(new Date(1700000000 * 1000).toISOString());
    }
  });

  it('parseia imagem com media url, mime e caption', () => {
    const events = parseWahaWebhook(
      messageEnvelope({
        id: 'IMG_1',
        from: '5511888@c.us',
        type: 'image',
        body: 'foto',
        hasMedia: true,
        media: { url: 'http://waha/api/files/img.jpg', mimetype: 'image/jpeg' },
        timestamp: 1700000001,
      }),
    );

    const ev = events[0];
    expect(ev?.type).toBe('message');
    if (ev?.type === 'message') {
      expect(ev.messageType).toBe('image');
      expect(ev.content).toBe('foto');
      expect(ev.mediaRef).toEqual({
        refOrUrl: 'http://waha/api/files/img.jpg',
        mimeType: 'image/jpeg',
      });
    }
  });

  it('distingue voice (ptt) de audio comum', () => {
    const ptt = parseWahaWebhook(
      messageEnvelope({ id: 'PTT', from: 'x@c.us', type: 'ptt', timestamp: 1 }),
    )[0];
    const audio = parseWahaWebhook(
      messageEnvelope({ id: 'AUD', from: 'x@c.us', type: 'audio', timestamp: 1 }),
    )[0];
    expect(ptt?.type === 'message' && ptt.messageType).toBe('voice');
    expect(audio?.type === 'message' && audio.messageType).toBe('audio');
  });

  it('parseia video, document e sticker', () => {
    const video = parseWahaWebhook(
      messageEnvelope({ id: 'V', from: 'x@c.us', type: 'video', timestamp: 1 }),
    )[0];
    const doc = parseWahaWebhook(
      messageEnvelope({
        id: 'D',
        from: 'x@c.us',
        type: 'document',
        media: { url: 'http://w/f.pdf', mimetype: 'application/pdf', filename: 'f.pdf' },
        timestamp: 1,
      }),
    )[0];
    const sticker = parseWahaWebhook(
      messageEnvelope({ id: 'S', from: 'x@c.us', type: 'sticker', timestamp: 1 }),
    )[0];

    expect(video?.type === 'message' && video.messageType).toBe('video');
    expect(sticker?.type === 'message' && sticker.messageType).toBe('sticker');
    expect(doc?.type).toBe('message');
    if (doc?.type === 'message') {
      expect(doc.messageType).toBe('document');
      expect(doc.mediaRef?.fileName).toBe('f.pdf');
    }
  });

  it('parseia localização com lat/lng em metadata', () => {
    const events = parseWahaWebhook(
      messageEnvelope({
        id: 'LOC',
        from: '5511777@c.us',
        type: 'location',
        location: { latitude: -23.5, longitude: -46.6, name: 'SP' },
        timestamp: 1700000002,
      }),
    );
    const ev = events[0];
    expect(ev?.type).toBe('message');
    if (ev?.type === 'message') {
      expect(ev.messageType).toBe('location');
      expect(ev.metadata?.['location']).toMatchObject({
        latitude: -23.5,
        longitude: -46.6,
        name: 'SP',
      });
    }
  });

  it('resolve o tipo via _data.type quando type ausente', () => {
    const ev = parseWahaWebhook(
      messageEnvelope({ id: 'X', from: 'x@c.us', _data: { type: 'image' }, timestamp: 1 }),
    )[0];
    expect(ev?.type === 'message' && ev.messageType).toBe('image');
  });

  it('captura replyTo e notifyName em metadata', () => {
    const ev = parseWahaWebhook(
      messageEnvelope({
        id: 'R',
        from: 'x@c.us',
        type: 'chat',
        body: 'oi',
        replyTo: 'QUOTED_ID',
        notifyName: 'Fulano',
        timestamp: 1,
      }),
    )[0];
    if (ev?.type === 'message') {
      expect(ev.metadata?.['replyToExternalId']).toBe('QUOTED_ID');
      expect(ev.metadata?.['contactName']).toBe('Fulano');
    }
  });

  it('parseia ack de entrega (DEVICE) e leitura (READ)', () => {
    const delivered = parseWahaWebhook(
      ackEnvelope({ id: 'OUT', ack: 2, ackName: 'DEVICE', timestamp: 1 }),
    )[0];
    const read = parseWahaWebhook(
      ackEnvelope({ id: 'OUT', ack: 3, ackName: 'READ', timestamp: 1 }),
    )[0];

    expect(delivered).toMatchObject({ type: 'status', provider: 'waha', status: 'delivered' });
    expect(read).toMatchObject({ type: 'status', status: 'read' });
  });

  it('ignora mensagens fromMe (eco do próprio número)', () => {
    const events = parseWahaWebhook(
      messageEnvelope({ id: 'ME', from: 'x@c.us', fromMe: true, type: 'chat', body: 'eco', timestamp: 1 }),
    );
    expect(events).toEqual([]);
  });

  it('ignora mensagens sem id/from sem lançar', () => {
    expect(parseWahaWebhook(messageEnvelope({ type: 'chat', body: 'sem from' }))).toEqual([]);
  });

  it('ignora envelopes inválidos e eventos não suportados', () => {
    expect(parseWahaWebhook(null)).toEqual([]);
    expect(parseWahaWebhook('garbage')).toEqual([]);
    expect(parseWahaWebhook({ event: 'message' })).toEqual([]);
    expect(parseWahaWebhook({ event: 'session.status', payload: { name: 'default' } })).toEqual([]);
  });
});
