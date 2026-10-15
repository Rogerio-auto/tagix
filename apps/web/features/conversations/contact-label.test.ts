import { describe, expect, it } from 'vitest';
import {
  AVATAR_TONES,
  avatarKeyOf,
  avatarTone,
  channelOf,
  contactLabel,
  formatPhoneIntl,
  initialsOf,
} from './contact-label';

describe('avatarKeyOf — mesma pessoa, mesma chave em toda tela', () => {
  it('contactId > contact.id > remoteId', () => {
    expect(avatarKeyOf({ contactId: 'k1', contact: { id: 'k2' }, remoteId: '55' })).toBe('k1');
    expect(avatarKeyOf({ contactId: null, contact: { id: 'k2' }, remoteId: '55' })).toBe('k2');
    expect(avatarKeyOf({ contactId: ' ', contact: null, remoteId: '55' })).toBe('55');
    expect(avatarKeyOf({})).toBe('');
  });
  it('lista (summary) e cabeçalho (detail) do mesmo contato dão a mesma cor', () => {
    const fromList = avatarKeyOf({ contactId: 'k-42', remoteId: '5569999670030' });
    const fromDetail = avatarKeyOf({ contactId: 'k-42', contact: { id: 'k-42' }, remoteId: '5569999670030' });
    expect(avatarTone(fromList)).toBe(avatarTone(fromDetail));
  });
});

describe('channelOf — selo de canal sem palpite', () => {
  it('provider decide', () => {
    expect(channelOf({ channelProvider: 'meta_whatsapp', kind: 'direct' })).toBe('whatsapp');
    expect(channelOf({ channelProvider: 'waha', kind: 'direct' })).toBe('whatsapp');
    expect(channelOf({ channelProvider: 'meta_instagram', kind: 'direct' })).toBe('instagram');
  });
  it('sem provider, só comentário/story denunciam o canal', () => {
    expect(channelOf({ kind: 'comment_thread' })).toBe('instagram');
    expect(channelOf({ kind: 'story_thread' })).toBe('instagram');
    expect(channelOf({ kind: 'direct' })).toBeNull();
    expect(channelOf({ kind: 'group', channelProvider: null })).toBeNull();
  });
});

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

describe('avatarTone — cor determinística (F72-S05)', () => {
  it('mesma chave, mesma cor; sempre de dentro do conjunto de tokens', () => {
    for (const key of ['k1', 'k2', '5569999670030', '@rogerio', '']) {
      expect(avatarTone(key)).toBe(avatarTone(key));
      expect(AVATAR_TONES).toContain(avatarTone(key));
    }
  });
  it('distribui chaves diferentes por mais de uma cor', () => {
    const tones = new Set(Array.from({ length: 60 }, (_, i) => avatarTone(`contato-${i}`)));
    expect(tones.size).toBe(AVATAR_TONES.length);
  });
  it('só tokens, nunca hex', () => {
    for (const t of AVATAR_TONES) expect(t).not.toMatch(/#|\[/);
  });
  it('nunca reusa tons de status (danger/warn/success)', () => {
    for (const t of AVATAR_TONES) expect(t).not.toMatch(/danger|warn|success/);
  });
  it('cor fixa por chave (estável entre versões)', () => {
    const snapshot = ['k1', 'k2', '5569999670030', '@rogerio', ''].map(avatarTone);
    expect(['k1', 'k2', '5569999670030', '@rogerio', ''].map(avatarTone)).toEqual(snapshot);
    expect(avatarTone('')).toBe(AVATAR_TONES[0x811c9dc5 % AVATAR_TONES.length]);
  });
});

describe('contactLabel.named', () => {
  it('true com nome (sistema ou perfil); false sem nome', () => {
    expect(contactLabel({ remoteId: '5569999670030', displayName: 'Ana' }).named).toBe(true);
    expect(contactLabel({ remoteId: '5569999670030', profileName: 'Ana' }).named).toBe(true);
    expect(contactLabel({ remoteId: '5569999670030' }).named).toBe(false);
    expect(contactLabel({ remoteId: '17841400008460056', channel: 'instagram' }).named).toBe(false);
  });
});
