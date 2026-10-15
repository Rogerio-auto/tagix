import { describe, expect, it } from 'vitest';
import { unreadSummary } from './liveSummary';

describe('unreadSummary — região viva da lista', () => {
  it('vazio quando nada novo', () => {
    expect(unreadSummary(0)).toBe('');
    expect(unreadSummary(-1)).toBe('');
    expect(unreadSummary(Number.NaN)).toBe('');
  });
  it('singular e plural em pt-BR', () => {
    expect(unreadSummary(1)).toBe('1 conversa com mensagens novas');
    expect(unreadSummary(4)).toBe('4 conversas com mensagens novas');
  });
  it('estável: mesma contagem, mesmo texto (sem re-anúncio)', () => {
    expect(unreadSummary(3)).toBe(unreadSummary(3));
  });
});
