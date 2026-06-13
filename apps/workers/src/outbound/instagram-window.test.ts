/**
 * Testes da janela 24h IG (F15-S04, INSTAGRAM.md 6). Funcao pura.
 */
import { describe, it, expect } from 'vitest';
import { evaluateInstagramWindow } from './instagram-window';

const NOW = 1_700_000_000_000;
const H = 3_600_000;

describe('evaluateInstagramWindow', () => {
  it('dentro de 24h: open, sem exigir tag', () => {
    const r = evaluateInstagramWindow({ lastInboundFromContactAt: NOW - 2 * H, now: NOW });
    expect(r).toMatchObject({ allowed: true, mode: 'open' });
  });

  it('24h-7d com HUMAN_AGENT: permitido com tag', () => {
    const r = evaluateInstagramWindow({
      lastInboundFromContactAt: NOW - 48 * H,
      messageTag: 'HUMAN_AGENT',
      now: NOW,
    });
    expect(r).toMatchObject({ allowed: true, mode: 'tag_required', tag: 'HUMAN_AGENT' });
  });

  it('24h-7d sem tag: bloqueado', () => {
    const r = evaluateInstagramWindow({ lastInboundFromContactAt: NOW - 48 * H, now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('24h_window_expired_ig');
  });

  it('>7d: bloqueado mesmo com tag', () => {
    const r = evaluateInstagramWindow({
      lastInboundFromContactAt: NOW - 8 * 24 * H,
      messageTag: 'HUMAN_AGENT',
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.mode).toBe('blocked');
  });

  it('sem timestamp: open (best-effort)', () => {
    expect(evaluateInstagramWindow({ now: NOW }).allowed).toBe(true);
  });
});
