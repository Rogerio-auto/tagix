import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_ORIGINS,
  normalizeConversationOrigin,
  originPrefillMarkersFromSettings,
} from './conversation-origin';

describe('normalizeConversationOrigin (fail-closed)', () => {
  it('mantém os 5 valores do domínio', () => {
    for (const o of CONVERSATION_ORIGINS) expect(normalizeConversationOrigin(o)).toBe(o);
  });

  it.each([null, undefined, '', 'origem:ANUNCIO', 'anuncio', 42, {}])('%j → sem-origem', (raw) => {
    expect(normalizeConversationOrigin(raw)).toBe('sem-origem');
  });
});

describe('originPrefillMarkersFromSettings', () => {
  it('sem configuração → listas vazias', () => {
    expect(originPrefillMarkersFromSettings({})).toEqual({ site: [], instagram: [] });
    expect(originPrefillMarkersFromSettings(null)).toEqual({ site: [], instagram: [] });
    expect(originPrefillMarkersFromSettings([])).toEqual({ site: [], instagram: [] });
  });

  it('lê site/instagram, com trim', () => {
    expect(
      originPrefillMarkersFromSettings({
        originPrefillMarkers: { site: ['  Vim pelo site  '], instagram: ['Vim pelo Instagram'] },
      }),
    ).toEqual({ site: ['Vim pelo site'], instagram: ['Vim pelo Instagram'] });
  });

  it('só um lado configurado → o outro vazio', () => {
    expect(
      originPrefillMarkersFromSettings({ originPrefillMarkers: { site: ['Vim pelo site'] } }),
    ).toEqual({
      site: ['Vim pelo site'],
      instagram: [],
    });
  });

  it('configuração inválida → vazio (não abre a IA para ninguém)', () => {
    expect(
      originPrefillMarkersFromSettings({ originPrefillMarkers: { site: 'Vim pelo site' } }),
    ).toEqual({
      site: [],
      instagram: [],
    });
    expect(
      originPrefillMarkersFromSettings({
        originPrefillMarkers: { site: Array(21).fill('Vim pelo site') },
      }),
    ).toEqual({ site: [], instagram: [] });
  });
});
