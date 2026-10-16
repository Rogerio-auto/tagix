import { describe, expect, it } from 'vitest';
import { agentStatus, capTone, initials, memberRole, subscriptionStatus, usd, SUBSCRIPTION_STATUSES } from './labels';

describe('labels do painel de plataforma', () => {
  it('todo status de assinatura conhecido tem rótulo em português e tom', () => {
    for (const code of SUBSCRIPTION_STATUSES) {
      const s = subscriptionStatus(code);
      expect(s.label).not.toBe(code);
      expect(s.tone).toBeTruthy();
    }
    expect(subscriptionStatus('past_due')).toEqual({ label: 'Inadimplente', tone: 'warning' });
    expect(subscriptionStatus('expired').tone).toBe('danger');
  });

  it('código desconhecido aparece como veio, em tom neutro (nunca some)', () => {
    expect(subscriptionStatus('paused')).toEqual({ label: 'paused', tone: 'neutral' });
    expect(agentStatus('weird')).toEqual({ label: 'weird', tone: 'neutral' });
    expect(memberRole('GUEST')).toBe('GUEST');
  });

  it('papéis e status de agente', () => {
    expect(memberRole('OWNER')).toBe('Proprietário');
    expect(agentStatus('active')).toEqual({ label: 'Ativo', tone: 'success' });
  });

  it('custo em dólar: casas fixas e vazio vira traço', () => {
    expect(usd(12.5)).toMatch(/12[.,]50/);
    expect(usd(0.000123, 5)).toMatch(/0[.,]00012/);
    expect(usd(null)).toBe('—');
    expect(usd(Number.NaN)).toBe('—');
  });

  it('faixa do teto de custo', () => {
    expect(capTone(null)).toBeNull();
    expect(capTone(0.42)).toBe('ok');
    expect(capTone(0.8)).toBe('warn');
    expect(capTone(1)).toBe('over');
    expect(capTone(1.7)).toBe('over');
  });

  it('iniciais do workspace', () => {
    expect(initials('Clínica Aurora')).toBe('CA');
    expect(initials('aurora')).toBe('AU');
    expect(initials('  Loja  do  Zé ')).toBe('LZ');
    expect(initials('')).toBe('?');
  });
});
