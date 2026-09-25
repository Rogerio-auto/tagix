import { describe, expect, it } from 'vitest';

import type { AdReferral } from './ad-referral';
import {
  CONVERSATION_ORIGIN_TAGS as T,
  MIN_PREFILL_MARKER_LENGTH,
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
        firstInboundText: '  vim   PELO SÍTE da arcada e quero um orçamento',
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

  describe('F70-S18 — marcador casa só como prefixo', () => {
    const wa = (firstInboundText: string, site: readonly string[] = MARKERS.site) =>
      classifyConversationOrigin({
        provider: 'meta_whatsapp',
        initiatedBy: 'contact',
        firstInboundText,
        prefillMarkers: { site, instagram: MARKERS.instagram },
      });

    it('marcador no meio da mensagem NÃO classifica', () => {
      expect(wa('Olá! Vim pelo site da Arcada, quero um orçamento')).toBe(T.semOrigem);
      expect(wa('Minha tia falou: "vim pelo site da Arcada" kkk')).toBe(T.semOrigem);
      expect(wa('oi\nVi o perfil no Instagram')).toBe(T.semOrigem);
    });

    it('marcador no início classifica (a mensagem pode continuar)', () => {
      expect(wa('Vim pelo site da Arcada')).toBe(T.site);
      expect(wa('Vim pelo site da Arcada, quero um orçamento')).toBe(T.site);
      expect(wa('Vi o perfil no Instagram e quero saber mais')).toBe(T.instagram);
    });

    it('normaliza espaço, caixa, acento e invisíveis antes de comparar', () => {
      expect(wa('\u200B\uFEFF  \n VIM  pelo\tSÍTE da arcada')).toBe(T.site);
    });

    it('o marcador precisa terminar numa fronteira de palavra', () => {
      expect(wa('Vim pelo site da Arcadaria')).toBe(T.semOrigem);
      expect(wa('Vim pelo site da Arcada2')).toBe(T.semOrigem);
    });

    it('token não natural funciona como prefixo, em qualquer caixa', () => {
      const TOKEN = ['[ref:site-7f3a]'];
      expect(wa('[ref:site-7f3a] Olá, vim pelo site', TOKEN)).toBe(T.site);
      expect(wa('[REF:SITE-7F3A]Olá', TOKEN)).toBe(T.site);
      expect(wa('[ref:site-7f3a]', TOKEN)).toBe(T.site);
      // Colchetes de largura total (teclados asiáticos / copia-e-cola) dobram para ASCII.
      expect(wa('\uFF3Bref:site-7f3a\uFF3D oi', TOKEN)).toBe(T.site);
    });

    it('token fora do início, ou diferente, NÃO classifica', () => {
      const TOKEN = ['[ref:site-7f3a]'];
      expect(wa('oi [ref:site-7f3a]', TOKEN)).toBe(T.semOrigem);
      expect(wa('[ref:site-7f3b] oi', TOKEN)).toBe(T.semOrigem);
      expect(wa('[ref:site-7f3] oi', TOKEN)).toBe(T.semOrigem);
    });

    it('mínimo de 8 caracteres continua valendo (depois de normalizar)', () => {
      expect(MIN_PREFILL_MARKER_LENGTH).toBe(8);
      // 7 caracteres normalizados: ignorado mesmo casando como prefixo.
      expect(wa('[ref:7] oi', ['[ref:7]'])).toBe(T.semOrigem);
      expect(wa('  Olá  Olá  tudo', ['  OLÁ  OLÁ '])).toBe(T.semOrigem);
      // 8 caracteres: vale.
      expect(wa('[ref:77] oi', ['[ref:77]'])).toBe(T.site);
    });
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
