import { describe, expect, it } from 'vitest';
import { deriveMediaState } from './useMediaResource';

/**
 * F52-S07 — máquina de estados pura da mídia (loading ≠ error; recuperação
 * acionável). Testada sem React/DOM (harness `node`).
 */

describe('deriveMediaState', () => {
  it('pending enquanto não há URL e não falhou', () => {
    expect(deriveMediaState({ url: null, status: 'live', failed: false })).toBe('pending');
  });

  it('ready quando há URL viva', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'live', failed: false })).toBe(
      'ready',
    );
  });

  it('pending durante a reidratação (refresh em voo), mesmo com URL antiga', () => {
    expect(
      deriveMediaState({ url: 'https://x/old.jpg', status: 'refreshing', failed: false }),
    ).toBe('pending');
  });

  it('error quando o refresh falhou (status error), independentemente de URL', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'error', failed: false })).toBe(
      'error',
    );
  });

  it('error quando o worker sinalizou falha e não há URL', () => {
    expect(deriveMediaState({ url: null, status: 'live', failed: true })).toBe('error');
  });

  it('failed com URL presente ainda renderiza (a URL servida prevalece)', () => {
    expect(deriveMediaState({ url: 'https://x/a.jpg', status: 'live', failed: true })).toBe(
      'ready',
    );
  });
});
