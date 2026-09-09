import { describe, expect, it } from 'vitest';
import {
  CHANNEL_KINDS,
  MARKET_CODES,
  MESSAGE_PURPOSES,
  getMarketPack,
  getOutboundPolicy,
  isChannelEnabled,
  isMarketCode,
  type ChannelKind,
  type MarketCode,
} from './markets';

describe('market packs', () => {
  it('expõe exatamente os dois mercados atendidos', () => {
    expect(MARKET_CODES).toEqual(['BR', 'US']);
  });

  it.each(MARKET_CODES)('%s tem pack completo e coerente', (code) => {
    const pack = getMarketPack(code);
    expect(pack.code).toBe(code);
    expect(pack.locales.length).toBeGreaterThan(0);
    expect(pack.locales).toContain(pack.defaultLocale);
    expect(pack.channels.length).toBeGreaterThan(0);
  });

  it('BR usa um fuso dominante e não calcula janela por contato', () => {
    const br = getMarketPack('BR');
    expect(br.currency).toBe('BRL');
    expect(br.defaultTimezone).toBe('America/Sao_Paulo');
    expect(br.timezonePerContact).toBe(false);
    expect(br.locales).toEqual(['pt-BR']);
  });

  it('BR não oferece SMS como canal de produto', () => {
    expect(isChannelEnabled('BR', 'sms')).toBe(false);
  });

  it('US é bilíngue e exige fuso por contato', () => {
    const us = getMarketPack('US');
    expect(us.currency).toBe('USD');
    expect(us.timezonePerContact).toBe(true);
    expect(us.locales).toEqual(['en-US', 'pt-BR']);
    expect(us.defaultLocale).toBe('en-US');
  });
});

describe('getOutboundPolicy', () => {
  it('é total: devolve política para todo canal em todo mercado', () => {
    for (const code of MARKET_CODES) {
      for (const channel of CHANNEL_KINDS) {
        const policy = getOutboundPolicy(code, channel);
        expect(policy).toBeDefined();
        expect(typeof policy.requiresPriorConsent).toBe('boolean');
        expect(policy.optOutKeywords.length).toBeGreaterThan(0);
      }
    }
  });

  it('cai no padrão seguro para canal desconhecido vindo de fora do tipo', () => {
    // Simula valor não confiável (banco antigo, payload externo) que furou o tipo.
    const unknownChannel = 'pigeon' as ChannelKind;
    const policy = getOutboundPolicy('US', unknownChannel);
    expect(policy.requiresPriorConsent).toBe(true);
    expect(policy.revocationByAnyReasonableMeans).toBe(true);
    expect(policy.quietHours).not.toBeNull();
  });

  it('cai no padrão seguro para mercado desconhecido vindo de fora do tipo', () => {
    const unknownMarket = 'XX' as MarketCode;
    expect(() => getOutboundPolicy(unknownMarket, 'sms')).not.toThrow();
    expect(getOutboundPolicy(unknownMarket, 'sms').requiresPriorConsent).toBe(true);
  });

  it('SMS nos EUA exige consentimento, registro 10DLC e janela 8h–21h', () => {
    const sms = getOutboundPolicy('US', 'sms');
    expect(sms.requiresPriorConsent).toBe(true);
    expect(sms.registrationRequired).toBe('10dlc');
    expect(sms.quietHours).toEqual({ startHour: 8, endHour: 21 });
    expect(sms.revocationByAnyReasonableMeans).toBe(true);
  });

  it('e-mail nos EUA não exige opt-in prévio (CAN-SPAM), mas honra revogação', () => {
    const email = getOutboundPolicy('US', 'email');
    expect(email.requiresPriorConsent).toBe(false);
    expect(email.revocationByAnyReasonableMeans).toBe(true);
  });

  it('nenhum canal dos EUA que exige registro deixa de exigir consentimento', () => {
    for (const channel of CHANNEL_KINDS) {
      const policy = getOutboundPolicy('US', channel);
      if (policy.registrationRequired !== 'none') {
        expect(policy.requiresPriorConsent).toBe(true);
      }
    }
  });

  it('todo canal com janela horária calcula no fuso do contato em mercado multifuso', () => {
    const us = getMarketPack('US');
    const temJanela = CHANNEL_KINDS.filter((c) => getOutboundPolicy('US', c).quietHours !== null);
    expect(temJanela.length).toBeGreaterThan(0);
    // Se há janela a respeitar, o mercado precisa resolver fuso por contato —
    // senão a janela é calculada no fuso errado e a regra vira decoração.
    expect(us.timezonePerContact).toBe(true);
  });

  it('janela horária é sempre um intervalo válido de horas do dia', () => {
    for (const code of MARKET_CODES) {
      for (const channel of CHANNEL_KINDS) {
        const { quietHours } = getOutboundPolicy(code, channel);
        if (quietHours === null) continue;
        expect(quietHours.startHour).toBeGreaterThanOrEqual(0);
        expect(quietHours.endHour).toBeLessThanOrEqual(24);
        expect(quietHours.startHour).toBeLessThan(quietHours.endHour);
      }
    }
  });

  it('palavras-chave de opt-out cobrem os dois idiomas em ambos os mercados', () => {
    // O público responde no idioma dele, não no do mercado: um brasileiro na
    // Flórida escreve "PARE" e isso precisa contar como revogação.
    for (const code of MARKET_CODES) {
      const { optOutKeywords } = getOutboundPolicy(code, 'sms');
      expect(optOutKeywords).toContain('stop');
      expect(optOutKeywords).toContain('pare');
      expect(optOutKeywords).toContain('cancelar');
      expect(optOutKeywords).toContain('unsubscribe');
    }
  });

  it('palavras-chave já vêm normalizadas para comparação direta', () => {
    for (const code of MARKET_CODES) {
      for (const kw of getOutboundPolicy(code, 'sms').optOutKeywords) {
        expect(kw).toBe(kw.toLowerCase());
        expect(kw).toBe(kw.normalize('NFD').replace(/\p{Diacritic}/gu, ''));
        expect(kw.trim()).toBe(kw);
      }
    }
  });
});

describe('isChannelEnabled', () => {
  it('reflete disponibilidade de produto, não autorização de envio', () => {
    // Instagram é oferecido no BR, mas isso não diz nada sobre poder enviar
    // marketing — quem decide é a política, e o teste documenta a fronteira.
    expect(isChannelEnabled('BR', 'meta_instagram')).toBe(true);
    expect(getOutboundPolicy('BR', 'meta_instagram').requiresPriorConsent).toBe(false);
    expect(isChannelEnabled('BR', 'sms')).toBe(false);
    // Canal desabilitado ainda tem política — e ela é restritiva.
    expect(getOutboundPolicy('BR', 'sms').requiresPriorConsent).toBe(true);
  });

  it('todo canal habilitado existe na lista de canais conhecidos', () => {
    for (const code of MARKET_CODES) {
      for (const channel of getMarketPack(code).channels) {
        expect(CHANNEL_KINDS).toContain(channel);
      }
    }
  });
});

describe('isMarketCode', () => {
  it('aceita só os códigos conhecidos', () => {
    expect(isMarketCode('BR')).toBe(true);
    expect(isMarketCode('US')).toBe(true);
    expect(isMarketCode('br')).toBe(false);
    expect(isMarketCode('XX')).toBe(false);
    expect(isMarketCode(null)).toBe(false);
    expect(isMarketCode(undefined)).toBe(false);
    expect(isMarketCode(42)).toBe(false);
  });
});

describe('finalidades de mensagem', () => {
  it('distingue transacional de marketing', () => {
    expect(MESSAGE_PURPOSES).toEqual(['transactional', 'marketing']);
  });
});
