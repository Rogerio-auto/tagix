import { describe, expect, it } from 'vitest';
import { parseInstagramEchoes } from './echo.parser';
import { parseInstagramWebhook } from './webhook.parser';

function envelope(messaging: unknown[], entryId: unknown = 'IG_ACCOUNT'): unknown {
  return { object: 'instagram', entry: [{ id: entryId, time: 1, messaging }] };
}

describe('parseInstagramEchoes', () => {
  it('eco de texto → evento com conta, contato (recipient), mid e horário', () => {
    const events = parseInstagramEchoes(
      envelope([
        {
          sender: { id: 'IG_ACCOUNT' },
          recipient: { id: 'IGSID_CONTACT' },
          timestamp: 1_700_000_000_000,
          message: { mid: 'mid.echo.1', text: 'oi, vi seu story', is_echo: true },
        },
      ]),
    );
    expect(events).toEqual([
      {
        provider: 'meta_instagram',
        igUserId: 'IG_ACCOUNT',
        contactRemoteId: 'IGSID_CONTACT',
        externalId: 'mid.echo.1',
        messageType: 'text',
        content: 'oi, vi seu story',
        rawTimestamp: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
  });

  it('expõe app_id numérico como string (o consumidor filtra o próprio app)', () => {
    const [ev] = parseInstagramEchoes(
      envelope([
        {
          sender: { id: 'IG_ACCOUNT' },
          recipient: { id: 'C' },
          timestamp: 1,
          message: { mid: 'm', text: 'x', is_echo: true, app_id: 1234567890 },
        },
      ]),
    );
    expect(ev?.appId).toBe('1234567890');
  });

  it('eco com anexo → tipo de mídia + mediaRef pela URL', () => {
    const [ev] = parseInstagramEchoes(
      envelope([
        {
          sender: { id: 'IG_ACCOUNT' },
          recipient: { id: 'C' },
          timestamp: 1,
          message: {
            mid: 'm.img',
            is_echo: true,
            attachments: [{ type: 'image', payload: { url: 'https://cdn.example/img.jpg' } }],
          },
        },
      ]),
    );
    expect(ev).toMatchObject({
      messageType: 'image',
      mediaRef: { refOrUrl: 'https://cdn.example/img.jpg' },
    });
    expect(ev?.content).toBeUndefined();
  });

  it('usa sender.id quando entry.id falta', () => {
    const [ev] = parseInstagramEchoes({
      entry: [
        {
          messaging: [
            {
              sender: { id: 'FROM_SENDER' },
              recipient: { id: 'C' },
              timestamp: 1,
              message: { mid: 'm', text: 'x', is_echo: true },
            },
          ],
        },
      ],
    });
    expect(ev?.igUserId).toBe('FROM_SENDER');
  });

  it('ignora não-eco, eco de exclusão, eco sem mid/recipient e eco sem conteúdo', () => {
    const events = parseInstagramEchoes(
      envelope([
        {
          sender: { id: 'C' },
          recipient: { id: 'IG' },
          timestamp: 1,
          message: { mid: 'in', text: 'oi' },
        },
        {
          sender: { id: 'IG' },
          recipient: { id: 'C' },
          timestamp: 1,
          message: { mid: 'del', is_echo: true, is_deleted: true },
        },
        {
          sender: { id: 'IG' },
          recipient: { id: 'C' },
          timestamp: 1,
          message: { text: 'sem mid', is_echo: true },
        },
        {
          sender: { id: 'IG' },
          timestamp: 1,
          message: { mid: 'sem-recipient', text: 'x', is_echo: true },
        },
        {
          sender: { id: 'IG' },
          recipient: { id: 'C' },
          timestamp: 1,
          message: { mid: 'share', is_echo: true, attachments: [{ type: 'share', payload: {} }] },
        },
        { sender: { id: 'IG' }, recipient: { id: 'C' }, timestamp: 1, read: { mid: 'r' } },
      ]),
    );
    expect(events).toEqual([]);
  });

  it('shape inválido não lança', () => {
    expect(parseInstagramEchoes(null)).toEqual([]);
    expect(parseInstagramEchoes({ entry: 'x' })).toEqual([]);
    expect(parseInstagramEchoes({ entry: [null, { messaging: [1, null] }] })).toEqual([]);
  });

  it('é o complemento do parser inbound: o mesmo payload não gera evento inbound', () => {
    const body = envelope([
      {
        sender: { id: 'IG_ACCOUNT' },
        recipient: { id: 'C' },
        timestamp: 1,
        message: { mid: 'm', text: 'eco', is_echo: true },
      },
    ]);
    expect(parseInstagramWebhook(body)).toEqual([]);
    expect(parseInstagramEchoes(body)).toHaveLength(1);
  });
});
