/**
 * Testes da normalizacao inbound IG (F15-S03): variantes viram message events
 * com type correto; comments sao separados. Puro.
 */
import { describe, it, expect } from 'vitest';
import type { InboundEvent } from '@hm/channels';
import { normalizeIgEvents } from './instagram-inbound';

describe('normalizeIgEvents', () => {
  it('story_mention vira message type story_mention com mediaRef', () => {
    const events: InboundEvent[] = [
      {
        type: 'story_mention',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.SM',
        mediaRef: { refOrUrl: 'https://x/story.jpg' },
        storyId: 'STORY_1',
      },
    ];
    const { messageEvents, commentEvents } = normalizeIgEvents(events);
    expect(commentEvents).toHaveLength(0);
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]).toMatchObject({
      type: 'message',
      messageType: 'story_mention',
      mediaRef: { refOrUrl: 'https://x/story.jpg' },
    });
    expect(messageEvents[0]?.metadata).toMatchObject({ storyId: 'STORY_1' });
  });

  it('story_reply e share viram message com type correto', () => {
    const events: InboundEvent[] = [
      {
        type: 'story_reply',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.SR',
        storyId: 'STORY_2',
        content: 'lindo',
      },
      {
        type: 'share',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.SH',
        mediaRef: { refOrUrl: 'https://x/post' },
      },
    ];
    const { messageEvents } = normalizeIgEvents(events);
    expect(messageEvents.map((m) => m.messageType)).toEqual(['story_reply', 'share']);
  });

  it('postback e referral viram message', () => {
    const events: InboundEvent[] = [
      {
        type: 'postback',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.PB',
        payload: 'BUY',
        title: 'Comprar',
      },
      {
        type: 'referral',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        source: 'ADS',
        referralData: { ad_id: '1' },
      },
    ];
    const { messageEvents } = normalizeIgEvents(events);
    expect(messageEvents.map((m) => m.messageType)).toEqual(['ig_postback', 'referral']);
  });

  it('propaga o rawTimestamp real do provider para o message event (F52-S08)', () => {
    const PROVIDER_TS = '2024-01-02T03:04:05.000Z';
    const events: InboundEvent[] = [
      {
        type: 'story_mention',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.SM',
        mediaRef: { refOrUrl: 'https://x/story.jpg' },
        storyId: 'STORY_1',
        rawTimestamp: PROVIDER_TS,
      },
      {
        type: 'postback',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.PB',
        payload: 'BUY',
        rawTimestamp: PROVIDER_TS,
      },
    ];
    const { messageEvents } = normalizeIgEvents(events);
    expect(messageEvents.map((m) => m.rawTimestamp)).toEqual([PROVIDER_TS, PROVIDER_TS]);
  });

  it('usa fallback (now) so quando o provider nao envia timestamp (F52-S08)', () => {
    const before = Date.now();
    const events: InboundEvent[] = [
      {
        type: 'story_reply',
        provider: 'meta_instagram',
        contactRemoteId: 'IGSID',
        externalId: 'mid.SR',
        storyId: 'STORY_2',
        content: 'oi',
        // sem rawTimestamp
      },
    ];
    const { messageEvents } = normalizeIgEvents(events);
    const ts = messageEvents[0]?.rawTimestamp;
    expect(ts).toBeDefined();
    expect(new Date(ts ?? '').getTime()).toBeGreaterThanOrEqual(before);
  });

  it('comment vai para commentEvents (nao message)', () => {
    const events: InboundEvent[] = [
      {
        type: 'comment',
        provider: 'meta_instagram',
        mediaId: 'M1',
        commentId: 'C1',
        fromIgsId: 'IGSID',
        text: 'top',
      },
    ];
    const { messageEvents, commentEvents } = normalizeIgEvents(events);
    expect(messageEvents).toHaveLength(0);
    expect(commentEvents).toHaveLength(1);
    expect(commentEvents[0]).toMatchObject({ commentId: 'C1', mediaId: 'M1' });
  });

  it('reaction e status nao viram message nem comment', () => {
    const events: InboundEvent[] = [
      { type: 'reaction', provider: 'meta_instagram', contactRemoteId: 'IGSID', targetExternalId: 'm', emoji: 'x' },
    ];
    const { messageEvents, commentEvents } = normalizeIgEvents(events);
    expect(messageEvents).toHaveLength(0);
    expect(commentEvents).toHaveLength(0);
  });
});
