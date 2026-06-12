import { describe, it, expect } from 'vitest';

import { parseInstagramWebhook } from './webhook.parser';

function envelope(...messaging: Record<string, unknown>[]): Record<string, unknown> {
  return {
    object: 'instagram',
    entry: [{ id: 'IG_USER_ID', time: 1718000000, messaging }],
  };
}

function changesEnvelope(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'instagram',
    entry: [{ id: 'IG_USER_ID', time: 1718000000, changes: [{ field, value }] }],
  };
}

describe('parseInstagramWebhook', () => {
  it('parseia DM de texto', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        recipient: { id: 'IG_USER_ID' },
        timestamp: 1718000000000,
        message: { mid: 'mid.DM1', text: 'ola' },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      provider: 'meta_instagram',
      contactRemoteId: 'IGSID_1',
      externalId: 'mid.DM1',
      messageType: 'text',
      content: 'ola',
    });
  });

  it('parseia DM com midia (imagem)', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        message: {
          mid: 'mid.IMG',
          attachments: [{ type: 'image', payload: { url: 'https://lookaside/img.jpg' } }],
        },
      }),
    );
    expect(events[0]).toMatchObject({
      type: 'message',
      messageType: 'image',
      mediaRef: { refOrUrl: 'https://lookaside/img.jpg' },
    });
  });

  it('parseia story_mention com URL temporaria', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        recipient: { id: 'IG_USER_ID' },
        timestamp: 1718000000000,
        message: {
          mid: 'mid.SM',
          attachments: [
            { type: 'story_mention', payload: { url: 'https://lookaside/story.jpg', id: 'STORY_9' } },
          ],
        },
      }),
    );
    expect(events[0]).toMatchObject({
      type: 'story_mention',
      provider: 'meta_instagram',
      storyId: 'STORY_9',
      mediaRef: { refOrUrl: 'https://lookaside/story.jpg' },
    });
  });

  it('parseia story_reply (reply_to.story)', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        message: {
          mid: 'mid.SR',
          text: 'Lindo!',
          reply_to: { story: { url: 'https://x/s.jpg', id: 'STORY_5' } },
        },
      }),
    );
    expect(events[0]).toMatchObject({
      type: 'story_reply',
      storyId: 'STORY_5',
      content: 'Lindo!',
    });
  });

  it('parseia share', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        message: { mid: 'mid.SH', attachments: [{ type: 'share', payload: { url: 'https://x/post' } }] },
      }),
    );
    expect(events[0]).toMatchObject({ type: 'share', mediaRef: { refOrUrl: 'https://x/post' } });
  });

  it('parseia postback', () => {
    const events = parseInstagramWebhook(
      envelope({
        sender: { id: 'IGSID_1' },
        postback: { mid: 'mid.PB', payload: 'BUY_NOW', title: 'Comprar' },
      }),
    );
    expect(events[0]).toMatchObject({ type: 'postback', payload: 'BUY_NOW', title: 'Comprar' });
  });

  it('parseia reaction', () => {
    const events = parseInstagramWebhook(
      envelope({ sender: { id: 'IGSID_1' }, reaction: { mid: 'mid.X', emoji: '❤' } }),
    );
    expect(events[0]).toMatchObject({ type: 'reaction', emoji: '❤', targetExternalId: 'mid.X' });
  });

  it('parseia seen (read) como status read', () => {
    const events = parseInstagramWebhook(
      envelope({ sender: { id: 'IGSID_1' }, read: { mid: 'mid.SEEN' } }),
    );
    expect(events[0]).toMatchObject({ type: 'status', status: 'read', externalId: 'mid.SEEN' });
  });

  it('parseia referral', () => {
    const events = parseInstagramWebhook(
      envelope({ sender: { id: 'IGSID_1' }, referral: { source: 'ADS', ad_id: '123' } }),
    );
    expect(events[0]).toMatchObject({ type: 'referral', source: 'ADS' });
  });

  it('ignora echoes e deletes', () => {
    const events = parseInstagramWebhook(
      envelope(
        { sender: { id: 'IG_USER_ID' }, message: { mid: 'e1', text: 'eco', is_echo: true } },
        { sender: { id: 'IGSID_1' }, message: { mid: 'd1', is_deleted: true } },
      ),
    );
    expect(events).toHaveLength(0);
  });

  it('parseia comment via changes', () => {
    const events = parseInstagramWebhook(
      changesEnvelope('comments', {
        id: 'COMMENT_1',
        text: 'top!',
        from: { id: 'IGSID_2', username: 'fan' },
        media: { id: 'MEDIA_9', media_product_type: 'REELS' },
      }),
    );
    expect(events[0]).toMatchObject({
      type: 'comment',
      commentId: 'COMMENT_1',
      mediaId: 'MEDIA_9',
      mediaKind: 'reel',
      fromIgsId: 'IGSID_2',
      fromUsername: 'fan',
      text: 'top!',
    });
  });

  it('tolera envelope vazio/invalido', () => {
    expect(parseInstagramWebhook(null)).toEqual([]);
    expect(parseInstagramWebhook({})).toEqual([]);
    expect(parseInstagramWebhook({ object: 'instagram', entry: [] })).toEqual([]);
  });
});
