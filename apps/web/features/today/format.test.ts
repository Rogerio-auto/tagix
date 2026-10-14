import { describe, expect, it } from 'vitest';
import { esperaCurta, esperaEmTexto } from './format';

describe('esperaEmTexto', () => {
  it.each([
    [0, 'agora'],
    [12, 'há 12\u00a0min'],
    [59, 'há 59\u00a0min'],
    [60, 'há 1h'],
    [185, 'há 3h'],
    [1440, 'há 1\u00a0dia'],
    [4000, 'há 2\u00a0dias'],
  ])('%i min -> %s', (min, texto) => {
    expect(esperaEmTexto(min)).toBe(texto);
  });
});

describe('esperaCurta', () => {
  it.each([
    [0, 'agora'],
    [7, '7\u00a0min'],
    [120, '2\u00a0h'],
    [2880, '2\u00a0d'],
  ])('%i min -> %s', (min, texto) => {
    expect(esperaCurta(min)).toBe(texto);
  });

  it('número e unidade nunca se separam numa quebra de linha', () => {
    for (const min of [7, 120, 2880]) {
      expect(esperaCurta(min)).not.toMatch(/\d /);
      expect(esperaEmTexto(min)).not.toMatch(/\d /);
    }
  });
});
