import { describe, expect, it } from 'vitest';
import { COPILOT_SESSION_TITLE_LETTERS, sessionTitleFrom } from './title';

describe('sessionTitleFrom', () => {
  it('pergunta curta vira o título, com espaços normalizados', () => {
    expect(sessionTitleFrom('  Como está   o pipeline?\n')).toBe('Como está o pipeline?');
  });

  it('pergunta longa: até 60 letras, sem cortar palavra, com reticência', () => {
    const q =
      'Quais negócios de alinhadores estão parados há mais de sete dias no estágio de proposta?';
    const t = sessionTitleFrom(q);
    expect(t.endsWith('…')).toBe(true);
    expect(Array.from(t).length).toBeLessThanOrEqual(COPILOT_SESSION_TITLE_LETTERS + 1);
    expect(q.startsWith(t.slice(0, -1))).toBe(true);
    expect(t).toBe('Quais negócios de alinhadores estão parados há mais de sete…');
  });

  it('texto sem espaço corta seco em 60 letras (code points, não bytes)', () => {
    const t = sessionTitleFrom('😀'.repeat(100));
    expect(Array.from(t)).toHaveLength(61);
  });

  it('controles viram espaço', () => {
    expect(sessionTitleFrom('a\u0000b\u0007c')).toBe('a b c');
  });
});
