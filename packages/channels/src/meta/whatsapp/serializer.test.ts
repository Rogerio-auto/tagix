import { describe, it, expect } from 'vitest';

import {
  InteractiveSerializeError,
  serializeContacts,
  serializeInteractive,
  serializeLocation,
  serializeMedia,
  serializeReaction,
  serializeTemplate,
  serializeText,
} from './serializer';

const TO = '5511999999999';

describe('serializeText', () => {
  it('monta payload de texto', () => {
    expect(serializeText({ contactRemoteId: TO, text: 'Oi' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TO,
      type: 'text',
      text: { preview_url: true, body: 'Oi' },
    });
  });

  it('anexa context quando há replyToExternalId', () => {
    const body = serializeText({ contactRemoteId: TO, text: 'Oi', replyToExternalId: 'wamid.X' });
    expect(body['context']).toEqual({ message_id: 'wamid.X' });
  });
});

describe('serializeMedia', () => {
  it('imagem com caption usa link + caption', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'image',
      publicMediaUrl: 'https://cdn/x.jpg',
      mime: 'image/jpeg',
      caption: 'foto',
    });
    expect(body['type']).toBe('image');
    expect(body['image']).toEqual({ link: 'https://cdn/x.jpg', caption: 'foto' });
  });

  it('voice mapeia para objeto audio com voice:true (PTT) e sem caption', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'voice',
      publicMediaUrl: 'https://cdn/x.ogg',
      mime: 'audio/ogg',
      caption: 'ignorado',
    });
    expect(body['type']).toBe('audio');
    expect(body['audio']).toEqual({ link: 'https://cdn/x.ogg', voice: true });
  });

  it('audio (audio_file) vai como áudio comum, SEM voice:true', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'audio',
      publicMediaUrl: 'https://cdn/x.ogg',
      mime: 'audio/ogg',
    });
    expect(body['type']).toBe('audio');
    expect(body['audio']).toEqual({ link: 'https://cdn/x.ogg' });
  });

  it('voice com mime NÃO ogg/opus degrada para áudio comum (sem voice:true)', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'voice',
      publicMediaUrl: 'https://cdn/x.m4a',
      mime: 'audio/mp4',
    });
    expect(body['type']).toBe('audio');
    expect(body['audio']).toEqual({ link: 'https://cdn/x.m4a' });
  });

  it('voice com codec opus explícito (audio/ogg; codecs=opus) leva voice:true', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'voice',
      publicMediaUrl: 'https://cdn/x.ogg',
      mime: 'audio/ogg; codecs=opus',
    });
    expect(body['audio']).toEqual({ link: 'https://cdn/x.ogg', voice: true });
  });
});

describe('serializeLocation', () => {
  it('monta location com longitude/latitude e name/address opcionais', () => {
    const body = serializeLocation({
      contactRemoteId: TO,
      latitude: -23.5,
      longitude: -46.6,
      name: 'Escritório',
      address: 'Av. Paulista, 1000',
    });
    expect(body['type']).toBe('location');
    expect(body['location']).toEqual({
      longitude: -46.6,
      latitude: -23.5,
      name: 'Escritório',
      address: 'Av. Paulista, 1000',
    });
  });

  it('omite name/address quando ausentes e anexa context no reply', () => {
    const body = serializeLocation({
      contactRemoteId: TO,
      latitude: 0,
      longitude: 0,
      replyToExternalId: 'wamid.L',
    });
    expect(body['location']).toEqual({ longitude: 0, latitude: 0 });
    expect(body['context']).toEqual({ message_id: 'wamid.L' });
  });
});

describe('serializeContacts', () => {
  it('mapeia cartões para name.formatted_name + phones/emails', () => {
    const body = serializeContacts({
      contactRemoteId: TO,
      contacts: [
        { name: 'Maria', phones: ['+5511988887777'], emails: ['maria@ex.com'] },
        { name: 'João', phones: ['+5511911112222'] },
      ],
    });
    expect(body['type']).toBe('contacts');
    expect(body['contacts']).toEqual([
      {
        name: { formatted_name: 'Maria', first_name: 'Maria' },
        phones: [{ phone: '+5511988887777' }],
        emails: [{ email: 'maria@ex.com' }],
      },
      {
        name: { formatted_name: 'João', first_name: 'João' },
        phones: [{ phone: '+5511911112222' }],
      },
    ]);
  });
});

describe('serializeReaction', () => {
  it('monta reaction com message_id + emoji', () => {
    const body = serializeReaction({
      contactRemoteId: TO,
      targetExternalId: 'wamid.R',
      emoji: '👍',
    });
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: TO,
      type: 'reaction',
      reaction: { message_id: 'wamid.R', emoji: '👍' },
    });
  });

  it('emoji vazio remove a reação', () => {
    const body = serializeReaction({
      contactRemoteId: TO,
      targetExternalId: 'wamid.R',
      emoji: '',
    });
    expect(body['reaction']).toEqual({ message_id: 'wamid.R', emoji: '' });
  });

  it('sticker não aceita caption', () => {
    const body = serializeMedia({
      contactRemoteId: TO,
      mediaKind: 'sticker',
      publicMediaUrl: 'https://cdn/x.webp',
      mime: 'image/webp',
      caption: 'ignorado',
    });
    expect(body['sticker']).toEqual({ link: 'https://cdn/x.webp' });
  });
});

describe('serializeTemplate', () => {
  it('monta template com language e components', () => {
    const body = serializeTemplate({
      contactRemoteId: TO,
      templateName: 'boas_vindas',
      languageCode: 'pt_BR',
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }] }],
    });
    expect(body['type']).toBe('template');
    expect(body['template']).toEqual({
      name: 'boas_vindas',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }] }],
    });
  });

  it('omite components vazios', () => {
    const body = serializeTemplate({
      contactRemoteId: TO,
      templateName: 'ping',
      languageCode: 'pt_BR',
      components: [],
    });
    expect((body['template'] as Record<string, unknown>)['components']).toBeUndefined();
  });
});

describe('serializeInteractive', () => {
  it('serializa botões (reply buttons)', () => {
    const body = serializeInteractive(
      {
        type: 'buttons',
        body: 'Escolha:',
        header: 'Título',
        footer: 'rodapé',
        buttons: [
          { id: 'a', text: 'Opção A' },
          { id: 'b', text: 'Opção B' },
        ],
      },
      TO,
    );
    expect(body['type']).toBe('interactive');
    expect(body['interactive']).toEqual({
      type: 'button',
      body: { text: 'Escolha:' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'a', title: 'Opção A' } },
          { type: 'reply', reply: { id: 'b', title: 'Opção B' } },
        ],
      },
      header: { type: 'text', text: 'Título' },
      footer: { text: 'rodapé' },
    });
  });

  it('serializa lista com sections/rows', () => {
    const body = serializeInteractive(
      {
        type: 'list',
        body: 'Menu',
        button: 'Ver',
        sections: [
          {
            title: 'Seção 1',
            rows: [{ id: 'r1', title: 'Linha 1', description: 'desc' }],
          },
        ],
      },
      TO,
    );
    expect(body['interactive']).toEqual({
      type: 'list',
      body: { text: 'Menu' },
      action: {
        button: 'Ver',
        sections: [
          { title: 'Seção 1', rows: [{ id: 'r1', title: 'Linha 1', description: 'desc' }] },
        ],
      },
    });
  });

  it('lança em payload inválido', () => {
    expect(() => serializeInteractive({ type: 'buttons', body: 'x', buttons: [] }, TO)).toThrow(
      InteractiveSerializeError,
    );
    expect(() => serializeInteractive({ type: 'unknown' }, TO)).toThrow(InteractiveSerializeError);
    expect(() => serializeInteractive(null, TO)).toThrow(InteractiveSerializeError);
  });
});
