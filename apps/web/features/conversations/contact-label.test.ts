import { describe, expect, it } from 'vitest';
import { contactLabel, formatPhoneIntl, initialsOf } from './contact-label';

const wa = { remoteId: '5569999670030', channel: 'whatsapp' };

describe('contactLabel — hierarquia sistema > perfil > telefone', () => {
  it('nome do sistema vence o do perfil', () => {
    const r = contactLabel({ ...wa, displayName: 'Maria Souza', profileName: 'Mari 🌸' });
    expect(r).toMatchObject({ label: 'Maria Souza', source: 'system', initials: 'MS' });
    expect(r.secondary).toBe('+55 (69) 99967-0030');
  });

  it('sem nome no sistema, usa o do perfil', () => {
    const r = contactLabel({ ...wa, displayName: null, profileName: 'João' });
    expect(r).toMatchObject({ label: 'João', source: 'profile', initials: 'J' });
  });

  it('sem nome nenhum, telefone formatado (nunca o id cru)', () => {
    const r = contactLabel({ ...wa, displayName: null, profileName: null });
    expect(r.label).toBe('+55 (69) 99967-0030');
    expect(r.source).toBe('phone');
    expect(r.label).not.toBe(wa.remoteId);
  });

  it('vazio e só espaços contam como ausente', () => {
    expect(contactLabel({ ...wa, displayName: '   ', profileName: ' \t ' }).source).toBe('phone');
    expect(contactLabel({ ...wa, displayName: '', profileName: 'Ana' }).source).toBe('profile');
    expect(contactLabel({ ...wa, displayName: '  Ana  Lima ' }).label).toBe('Ana Lima');
  });

  it('iniciais: primeira + última palavra significativa, ignorando partículas', () => {
    expect(initialsOf('ana beatriz de souza')).toBe('AS');
    expect(initialsOf('João do Perfil')).toBe('JP');
    expect(initialsOf('Édson')).toBe('É');
    expect(initialsOf('🌸 !!!')).toBe('?');
  });
});

describe('formatPhoneIntl', () => {
  it('BR celular e fixo', () => {
    expect(formatPhoneIntl('5569999670030')).toBe('+55 (69) 99967-0030');
    expect(formatPhoneIntl('+55 66 3934-2444')).toBe('+55 (66) 3934-2444');
  });
  it('internacional', () => {
    expect(formatPhoneIntl('13055550142')).toBe('+1 (305) 555-0142');
    expect(formatPhoneIntl('351912345678')).toBe('+351912345678');
  });
  it('vazio → null', () => {
    expect(formatPhoneIntl('  ')).toBeNull();
    expect(formatPhoneIntl(null)).toBeNull();
  });
});

describe('contactLabel — Instagram', () => {
  const ig = { remoteId: '17841400008460056', channel: 'instagram' };
  it('sem nome e sem @usuario → "Contato do Instagram", nunca o IGSID', () => {
    const r = contactLabel(ig);
    expect(r.label).toBe('Contato do Instagram');
    expect(r.secondary).toBeNull();
  });
  it('@usuario quando houver', () => {
    expect(contactLabel({ remoteId: '@rogerio', channel: 'meta_instagram' }).label).toBe('@rogerio');
  });
  it('nome de perfil vence', () => {
    expect(contactLabel({ ...ig, profileName: 'Bia' })).toMatchObject({ label: 'Bia', source: 'profile' });
  });
});
