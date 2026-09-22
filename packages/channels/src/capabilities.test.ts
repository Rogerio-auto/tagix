import { describe, expect, it } from 'vitest';
import {
  CHANNEL_CAPABILITIES,
  NO_LIMITS,
  capabilitiesFromLegacy,
  declareCapabilities,
} from './capabilities';
import type { AdapterCapabilities } from './types';

const whatsapp: AdapterCapabilities = {
  templatesHSM: true,
  storyMentions: false,
  storyReplies: false,
  publicComments: false,
  messageTags: false,
  voicePtt: true,
  sticker: true,
  location: true,
};

const instagram: AdapterCapabilities = {
  templatesHSM: false,
  storyMentions: true,
  storyReplies: true,
  publicComments: true,
  messageTags: true,
  voicePtt: false,
  sticker: false,
  location: false,
};

describe('declareCapabilities', () => {
  it('responde o que suporta e o que não', () => {
    const caps = declareCapabilities(['subject', 'html_body', 'threading']);
    expect(caps.supports('subject')).toBe(true);
    expect(caps.supports('threading')).toBe(true);
    expect(caps.supports('sticker')).toBe(false);
  });

  it('lista na ordem canônica, não na de declaração', () => {
    const caps = declareCapabilities(['threading', 'subject', 'media']);
    const lista = caps.list();
    const posicoes = lista.map((c) => CHANNEL_CAPABILITIES.indexOf(c));
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('sem limites por padrão', () => {
    const caps = declareCapabilities(['media']);
    expect(caps.limits).toEqual(NO_LIMITS);
  });

  it('carrega limites numéricos quando o canal tem', () => {
    // SMS: o composer precisa disso para não deixar compor o impossível.
    const sms = declareCapabilities(['segmented_text'], {
      charactersPerSegment: 160,
      maxSegments: 10,
      maxAttachmentBytes: null,
    });
    expect(sms.limits.charactersPerSegment).toBe(160);
    expect(sms.limits.maxAttachmentBytes).toBeNull();
  });
});

describe('ponte a partir do contrato antigo', () => {
  it('WhatsApp: exige modelo aprovado, tem voz, figurinha e localização', () => {
    const caps = capabilitiesFromLegacy(whatsapp);
    expect(caps.supports('approved_template_required')).toBe(true);
    expect(caps.supports('voice_note')).toBe(true);
    expect(caps.supports('sticker')).toBe(true);
    expect(caps.supports('location')).toBe(true);
  });

  it('Instagram: comentários públicos e tags, sem modelo aprovado', () => {
    const caps = capabilitiesFromLegacy(instagram);
    expect(caps.supports('public_comments')).toBe(true);
    expect(caps.supports('message_tags')).toBe(true);
    // É o ponto que o wizard de campanha precisa: IG não tem HSM.
    expect(caps.supports('approved_template_required')).toBe(false);
  });

  it('nenhum canal legado declara capacidade de e-mail', () => {
    // A ponte não inventa: e-mail entra quando existir adapter de e-mail.
    for (const legacy of [whatsapp, instagram]) {
      const caps = capabilitiesFromLegacy(legacy);
      expect(caps.supports('subject')).toBe(false);
      expect(caps.supports('html_body')).toBe(false);
      expect(caps.supports('attachments')).toBe(false);
      expect(caps.supports('threading')).toBe(false);
      expect(caps.supports('segmented_text')).toBe(false);
    }
  });

  it('todo canal legado suporta o básico de mensageria', () => {
    for (const legacy of [whatsapp, instagram]) {
      const caps = capabilitiesFromLegacy(legacy);
      expect(caps.supports('media')).toBe(true);
      expect(caps.supports('interactive')).toBe(true);
      expect(caps.supports('presence')).toBe(true);
    }
  });
});

describe('o catálogo não vira despejo', () => {
  it('não há capacidade duplicada', () => {
    expect(new Set(CHANNEL_CAPABILITIES).size).toBe(CHANNEL_CAPABILITIES.length);
  });

  it('toda capacidade é nomeada por habilidade de composição, não por provider', () => {
    // Guarda contra o vício que este módulo existe para evitar: `templatesHSM`,
    // `storyMentions` e afins são nomes de recurso da Meta. Aqui o nome descreve
    // o que a mensagem PODE TER, e serve a qualquer canal que tenha aquilo.
    for (const c of CHANNEL_CAPABILITIES) {
      expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c).not.toMatch(/meta|whatsapp|instagram|waha|hsm|story/i);
    }
  });
});
