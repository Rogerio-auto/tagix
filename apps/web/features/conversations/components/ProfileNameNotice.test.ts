import { describe, expect, it } from 'vitest';
import { shouldShowProfileName } from './ProfileNameNotice';
import type { ConversationContact } from '../types';

function contact(displayName: string | null, profileName: string | null): ConversationContact {
  return { id: 'c1', displayName, profileName } as ConversationContact;
}

describe('shouldShowProfileName', () => {
  it('oculta quando não há nome de perfil', () => {
    expect(shouldShowProfileName(contact('Ana', null))).toBe(false);
    expect(shouldShowProfileName(contact('Ana', '  '))).toBe(false);
    expect(shouldShowProfileName(null)).toBe(false);
  });
  it('mostra quando não há nome no sistema', () => {
    expect(shouldShowProfileName(contact(null, 'Ana'))).toBe(true);
  });
  it('ignora caixa, acentos e espaços repetidos ao comparar', () => {
    expect(shouldShowProfileName(contact('João  Silva', 'joao silva'))).toBe(false);
    expect(shouldShowProfileName(contact('Maria', 'MARIA '))).toBe(false);
  });
  it('mostra quando os nomes realmente diferem', () => {
    expect(shouldShowProfileName(contact('Maria Souza', 'Mari 🌸'))).toBe(true);
  });
});
