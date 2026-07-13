/**
 * F56-S05 / UX-06 — o badge "Canais" mentia ("0 ativos" com canal no ar) porque
 * filtrava um `status` inexistente. Estes testes travam o contrato do contador em
 * cima do `Channel` real (`isActive`), incluindo os sinais que merecem alerta.
 */
import { describe, expect, it } from 'vitest';
import { summarizeChannels, type ChannelCounterRow } from './counters';

const wa = (isActive: boolean): ChannelCounterRow => ({
  provider: 'meta_whatsapp',
  isActive,
  wahaSessionId: null,
});

const waha = (isActive: boolean, sessionId: string | null): ChannelCounterRow => ({
  provider: 'waha',
  isActive,
  wahaSessionId: sessionId,
});

describe('summarizeChannels', () => {
  it('sem canais → sem badge (o empty state da seção já conta a história)', () => {
    expect(summarizeChannels([])).toBeNull();
  });

  it('conta pelo isActive — o bug do UX-06 era ler um campo que a API nunca mandou', () => {
    expect(summarizeChannels([wa(true)])).toEqual({ label: '1 ativo', alert: false });
    expect(summarizeChannels([wa(true), wa(true)])).toEqual({ label: '2 ativos', alert: false });
  });

  it('mostra os inativos e não alerta enquanto houver canal recebendo', () => {
    expect(summarizeChannels([wa(true), wa(false)])).toEqual({
      label: '1 ativo · 1 inativo',
      alert: false,
    });
  });

  it('nenhum canal ativo = nada entra no inbox → alerta', () => {
    expect(summarizeChannels([wa(false), wa(false)])).toEqual({
      label: '0 ativos · 2 inativos',
      alert: true,
    });
  });

  it('WAHA ativo sem sessão = desautorizado → alerta (mesma regra do badge da lista)', () => {
    expect(summarizeChannels([wa(true), waha(true, null)])).toEqual({
      label: '2 ativos · 1 desautorizado',
      alert: true,
    });
  });

  it('WAHA desativado não conta como desautorizado (o usuário desligou de propósito)', () => {
    expect(summarizeChannels([wa(true), waha(false, null)])).toEqual({
      label: '1 ativo · 1 inativo',
      alert: false,
    });
  });

  it('WAHA com sessão viva é apenas um canal ativo', () => {
    expect(summarizeChannels([waha(true, 'sess_1')])).toEqual({ label: '1 ativo', alert: false });
  });
});
