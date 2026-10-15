import { describe, expect, it } from 'vitest';
import { EVENT_TONE_LEGEND, eventTone } from './eventTone';

describe('eventTone', () => {
  it('mapeia o tipo para um tom de token', () => {
    expect(eventTone('meeting').name).toBe('brand');
    expect(eventTone('call').name).toBe('brand');
    expect(eventTone('demo').name).toBe('violet');
    expect(eventTone('follow_up').name).toBe('info');
    expect(eventTone('billing').name).toBe('warn');
    expect(eventTone('proposal').name).toBe('warn');
  });

  it('tipo desconhecido cai em neutro, sem quebrar', () => {
    expect(eventTone('algo_novo').name).toBe('neutral');
    expect(eventTone('').name).toBe('neutral');
  });

  it('a legenda cobre cada tom uma vez', () => {
    const names = EVENT_TONE_LEGEND.map((l) => l.tone.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(['brand', 'info', 'neutral', 'violet', 'warn']);
  });

  it('usa só classes de token: nenhuma cor literal', () => {
    for (const type of ['meeting', 'demo', 'follow_up', 'billing', 'other']) {
      const tone = eventTone(type);
      for (const cls of [tone.chip, tone.bar, tone.text]) {
        expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}|\[(?:#|rgb|hsl)/);
      }
    }
  });
});
