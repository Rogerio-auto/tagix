import { describe, expect, it } from 'vitest';

import type { AdReferral } from './ad-referral';
import {
  CONVERSATION_ORIGIN_TAGS as T,
  classifyConversationOrigin,
  isAiEligibleOrigin,
  type ConversationOrigin,
} from './origin';

const AT = '2025-09-24T13:20:00.000Z';
const AD: AdReferral = {
  channel: 'meta_whatsapp',
  sourceType: 'ad',
  sourceId: 'AD1',
  referredAt: AT,
};
const MARKERS = {
  site: ['Vim pelo site da Arcada'],
  instagram: ['Vi o perfil no Instagram'],
};

describe('classifyConversationOrigin', () => {
  it('prospecção vence tudo (conversa iniciada pelo negócio)', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'business',
        adReferral: AD,
        firstInboundText: 'Vim pelo site da Arcada',
        prefillMarkers: MARKERS,
      }),
    ).toBe(T.prospeccao);
  });

  it('referral pago → origem:anuncio', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        adReferral: AD,
      }),
    ).toBe(T.anuncio);
  });

  it('referral não pago cai para as próximas regras', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        adReferral: {
          channel: 'meta_instagram',
          sourceType: 'shortlink',
          ref: 'bio',
          referredAt: AT,
        },
      }),
    ).toBe(T.semOrigem);
  });

  it('mensagem pré-preenchida do site, com acento/caixa/espaço diferentes', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        firstInboundText: 'Olá!   vim PELO SÍTE da arcada e quero um orçamento',
        prefillMarkers: { site: ['Vim pelo sitê da Arcada'] },
      }),
    ).toBe(T.site);
  });

  it('mensagem pré-preenchida do botão do Instagram', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        firstInboundText: 'Vi o perfil no Instagram e quero saber mais',
        prefillMarkers: MARKERS,
      }),
    ).toBe(T.instagram);
  });

  it('DM do Instagram prova a origem pelo próprio canal', () => {
    expect(classifyConversationOrigin({ provider: 'meta_instagram', initiatedBy: 'contact' })).toBe(
      T.instagram,
    );
  });

  it('mensagem comum no número pessoal → sem-origem', () => {
    expect(
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        firstInboundText: 'Oi filho, vem almoçar domingo?',
        prefillMarkers: MARKERS,
      }),
    ).toBe(T.semOrigem);
  });

  it('fail-closed: marcador vazio ou curto nunca abre a IA', () => {
    for (const marker of ['', '   ', 'oi', 'olá', 'bom dia']) {
      expect(
        classifyConversationOrigin({
          provider: 'meta_whatsapp',
          initiatedBy: 'contact',
          firstInboundText: 'oi, bom dia, olá',
          prefillMarkers: { site: [marker], instagram: [marker] },
        }),
      ).toBe(T.semOrigem);
    }
  });

  it('sem texto e sem referral → sem-origem (ex.: primeira mensagem é áudio)', () => {
    expect(
      classifyConversationOrigin({
        provider: 'waha',
        initiatedBy: 'contact',
        prefillMarkers: MARKERS,
      }),
    ).toBe(T.semOrigem);
  });
});

describe('isAiEligibleOrigin', () => {
  it.each<[ConversationOrigin, boolean]>([
    [T.anuncio, true],
    [T.site, true],
    [T.instagram, true],
    [T.prospeccao, false],
    [T.semOrigem, false],
  ])('%s → %s', (origin, expected) => {
    expect(isAiEligibleOrigin(origin)).toBe(expected);
  });
});
