import { describe, expect, it } from 'vitest';
import { homonymIds } from './homonyms';

const row = (id: string, name: string | null, remoteId: string, kind = 'whatsapp') => ({
  id,
  contactDisplayName: name,
  contactProfileName: null,
  remoteId,
  kind,
});

describe('homonymIds — telefone como 2ª linha entre homônimos', () => {
  it('marca todos os contatos que dividem o mesmo nome (sem caixa/espaços)', () => {
    const ids = homonymIds([
      row('a', 'Maria Souza', '5569999670030'),
      row('b', ' maria souza ', '5511988887777'),
      row('c', 'Carla Reis', '5548991112222'),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
  it('nome único não ganha 2ª linha', () => {
    expect(homonymIds([row('a', 'Ana', '1'), row('b', 'Bia', '2')]).size).toBe(0);
  });
  it('contatos sem nome não contam como homônimos', () => {
    expect(homonymIds([row('a', null, '5569999670030'), row('b', null, '5569999670030')]).size).toBe(0);
  });
});
