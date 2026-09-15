/**
 * F69-S03 — a regra de normalização de telefone do lado do servidor.
 *
 * Mesmos casos da importação de público (F58-S08): o lead do anúncio chega com o
 * telefone como a pessoa digitou.
 */
import { describe, expect, it } from 'vitest';
import { countryCodeForMarket, normalizeE164 } from './phone-normalize';

describe('normalizeE164', () => {
  it('E.164 explícito passa, inclusive de outro país', () => {
    expect(normalizeE164('+13055550142', '55')).toBe('+13055550142');
  });

  it('número brasileiro digitado por humano', () => {
    expect(normalizeE164('(66) 99934-2444', '55')).toBe('+5566999342444');
    expect(normalizeE164('5566999342444', '55')).toBe('+5566999342444');
  });

  it('número americano no mercado americano', () => {
    expect(normalizeE164('(305) 555-0142', '1')).toBe('+13055550142');
    expect(normalizeE164('13055550142', '1')).toBe('+13055550142');
  });

  it('NÃO chuta DDI para número curto — o bug que a F58-S08 pegou', () => {
    expect(normalizeE164('5551234', '55')).toBeNull();
    expect(normalizeE164('123', '1')).toBeNull();
  });

  it('texto não é telefone', () => {
    expect(normalizeE164('', '55')).toBeNull();
    expect(normalizeE164('sem numero', '55')).toBeNull();
  });
});

describe('countryCodeForMarket', () => {
  it('mapeia o mercado', () => {
    expect(countryCodeForMarket('US')).toBe('1');
    expect(countryCodeForMarket('BR')).toBe('55');
  });
});
