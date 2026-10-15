import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from './rovingNav';

describe('nextFocusIndex — setas na lista de conversas', () => {
  it('↓ avança e trava no fim', () => {
    expect(nextFocusIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextFocusIndex('ArrowDown', 2, 3)).toBe(2);
  });
  it('↑ recua e trava no início', () => {
    expect(nextFocusIndex('ArrowUp', 2, 3)).toBe(1);
    expect(nextFocusIndex('ArrowUp', 0, 3)).toBe(0);
  });
  it('sem foco lógico, qualquer seta cai no primeiro item', () => {
    expect(nextFocusIndex('ArrowDown', -1, 3)).toBe(0);
    expect(nextFocusIndex('ArrowUp', -1, 3)).toBe(0);
  });
  it('Home e End', () => {
    expect(nextFocusIndex('Home', 2, 5)).toBe(0);
    expect(nextFocusIndex('End', 0, 5)).toBe(4);
  });
  it('outras teclas e lista vazia não navegam', () => {
    expect(nextFocusIndex('Enter', 1, 3)).toBeNull();
    expect(nextFocusIndex('a', 1, 3)).toBeNull();
    expect(nextFocusIndex('ArrowDown', -1, 0)).toBeNull();
  });
});
