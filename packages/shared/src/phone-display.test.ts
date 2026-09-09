/**
 * F61-S12 — telefone é identidade quando não há nome.
 *
 * O que este arquivo protege: que a tela nunca mais escreva "Contato sem nome"
 * para alguém de quem temos o número, e que um número que não sabemos formatar
 * apareça discável em vez de disfarçado.
 */
import { describe, expect, it } from 'vitest';
import { formatPhoneForDisplay } from './phone-display';

describe('Brasil', () => {
  it('celular com 9º dígito', () => {
    expect(formatPhoneForDisplay('+5566999342444')).toBe('(66) 99934-2444');
  });

  it('fixo de 8 dígitos', () => {
    expect(formatPhoneForDisplay('+556639342444')).toBe('(66) 3934-2444');
  });

  it('número local digitado à mão, sem DDI', () => {
    expect(formatPhoneForDisplay('66999342444')).toBe('(66) 99934-2444');
  });
});

describe('América do Norte', () => {
  it('formata no padrão que o cliente nos EUA reconhece', () => {
    expect(formatPhoneForDisplay('+13055550142')).toBe('(305) 555-0142');
  });
});

describe('o que não sabemos formatar', () => {
  it('devolve o E.164 como veio — número que parece errado não é discado', () => {
    expect(formatPhoneForDisplay('+351912345678')).toBe('+351912345678');
  });

  it('DDI conhecido com tamanho inesperado NÃO é forçado no formato', () => {
    // Melhor um E.164 correto que um "(55) 5-5" inventado.
    expect(formatPhoneForDisplay('+5512')).toBe('+5512');
  });

  it('nunca lança', () => {
    expect(formatPhoneForDisplay(null)).toBeNull();
    expect(formatPhoneForDisplay(undefined)).toBeNull();
    expect(formatPhoneForDisplay('')).toBeNull();
    expect(formatPhoneForDisplay('abc')).toBeNull();
  });
});
