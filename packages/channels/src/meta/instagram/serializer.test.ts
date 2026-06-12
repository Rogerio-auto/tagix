import { describe, it, expect } from 'vitest';

import { serializeText, serializeMedia, serializeInteractive } from './serializer';
import { IgInteractiveSerializeError } from './errors';

describe('serializeText (IG)', () => {
  it('usa messaging_type RESPONSE sem tag', () => {
    const body = serializeText({ contactRemoteId: 'IGSID_1', text: 'oi' });
    expect(body).toMatchObject({
      recipient: { id: 'IGSID_1' },
      message: { text: 'oi' },
      messaging_type: 'RESPONSE',
    });
    expect(body['tag']).toBeUndefined();
  });

  it('usa MESSAGE_TAG quando messageTag presente', () => {
    const body = serializeText({ contactRemoteId: 'IGSID_1', text: 'oi', messageTag: 'HUMAN_AGENT' });
    expect(body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });
});

describe('serializeMedia (IG)', () => {
  it('mapeia voice/document para audio/file', () => {
    const audio = serializeMedia({
      contactRemoteId: 'IGSID_1',
      mediaKind: 'voice',
      publicMediaUrl: 'https://x/a.ogg',
      mime: 'audio/ogg',
    });
    expect(audio).toMatchObject({ message: { attachment: { type: 'audio' } } });
    const file = serializeMedia({
      contactRemoteId: 'IGSID_1',
      mediaKind: 'document',
      publicMediaUrl: 'https://x/d.pdf',
      mime: 'application/pdf',
    });
    expect(file).toMatchObject({ message: { attachment: { type: 'file' } } });
  });
});

describe('serializeInteractive (IG)', () => {
  it('serializa ig_quick_replies', () => {
    const body = serializeInteractive(
      {
        type: 'ig_quick_replies',
        text: 'Escolha',
        options: [{ title: 'A', payload: 'OPT_A' }],
      },
      'IGSID_1',
      undefined,
    );
    expect(body).toMatchObject({
      message: { text: 'Escolha', quick_replies: [{ content_type: 'text', title: 'A', payload: 'OPT_A' }] },
    });
  });

  it('serializa ig_generic_template', () => {
    const body = serializeInteractive(
      {
        type: 'ig_generic_template',
        elements: [
          { title: 'Produto', buttons: [{ type: 'postback', title: 'Ver', payload: 'P1' }] },
        ],
      },
      'IGSID_1',
      undefined,
    );
    expect(body).toMatchObject({
      message: { attachment: { type: 'template', payload: { template_type: 'generic' } } },
    });
  });

  it('rejeita tipo nao-IG (buttons WA)', () => {
    expect(() => serializeInteractive({ type: 'buttons', body: 'x' }, 'IGSID_1', undefined)).toThrow(
      IgInteractiveSerializeError,
    );
  });
});
