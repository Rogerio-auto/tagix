import { describe, expect, it } from 'vitest';
import { dotColorStyle, safeHexColor } from './color';

describe('safeHexColor', () => {
  it('aceita #RRGGBB em qualquer caixa', () => {
    expect(safeHexColor('#22c55e')).toBe('#22c55e');
    expect(safeHexColor('#22C55E')).toBe('#22C55E');
  });

  it.each([
    null,
    undefined,
    '',
    'red',
    '#fff',
    '#22c55e80',
    ' #22c55e',
    '#22c55e ',
    '#22c55e;background:url(https://x.test/a.png)',
    'url(https://x.test/a.png)',
    'var(--brand)',
    'expression(alert(1))',
    '#22c55e\n',
  ])('recusa %j', (value) => {
    expect(safeHexColor(value)).toBeNull();
  });
});

describe('dotColorStyle', () => {
  it('monta o style só com hex válido', () => {
    expect(dotColorStyle('#0ea5e9')).toEqual({ backgroundColor: '#0ea5e9' });
  });

  it('sem cor válida não há style (fica o token da classe)', () => {
    expect(dotColorStyle('url(javascript:alert(1))')).toBeUndefined();
    expect(dotColorStyle(null)).toBeUndefined();
  });
});
