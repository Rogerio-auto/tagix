/**
 * F61-S04 — a parte do roteador que depende de relógio e fuso.
 *
 * A decisão em si é testada em `@hm/shared/notifications` (22 casos, sem IO).
 * Aqui ficam os dois pontos onde a execução pode errar sozinha: converter a hora
 * para o fuso do membro e medir há quanto tempo ele esteve no app.
 */
import { describe, expect, it } from 'vitest';
import { horaLocalDe, minutosDesde } from './index';

describe('horaLocalDe — a janela de silêncio é no relógio de QUEM RECEBE', () => {
  // 2026-09-09T23:30:00Z = 20h30 em São Paulo (UTC-3) e 19h30 em Nova York (UTC-4, horário de verão).
  const instante = new Date('2026-09-09T23:30:00Z');

  it('converte para o fuso do membro, não o do servidor', () => {
    expect(horaLocalDe(instante, 'America/Sao_Paulo')).toBe(20);
    expect(horaLocalDe(instante, 'America/New_York')).toBe(19);
  });

  it('respeita horário de verão — é por isso que usa Intl, não offset fixo', () => {
    // Em janeiro Nova York está em UTC-5; em setembro, UTC-4. Aritmética com
    // offset fixo erraria metade do ano, e erraria em meses diferentes no Brasil.
    const janeiro = new Date('2026-01-15T23:30:00Z');
    expect(horaLocalDe(janeiro, 'America/New_York')).toBe(18);
    expect(horaLocalDe(instante, 'America/New_York')).toBe(19);
  });

  it('sem fuso cai no relógio do servidor', () => {
    expect(horaLocalDe(instante, null)).toBe(23);
    expect(horaLocalDe(instante, '')).toBe(23);
  });

  it('fuso inválido NÃO lança — deixa de avisar seria pior que errar a janela', () => {
    expect(horaLocalDe(instante, 'Nao/Existe')).toBe(23);
  });

  it('meia-noite vira 0, não 24', () => {
    // `Intl` com hour12:false devolve "24" em algumas plataformas para meia-noite.
    // Se isso vazasse, a comparação de janela quebraria exatamente no horário em
    // que o silêncio importa.
    const meiaNoite = new Date('2026-09-10T03:00:00Z'); // 00h em São Paulo
    expect(horaLocalDe(meiaNoite, 'America/Sao_Paulo')).toBe(0);
  });
});

describe('minutosDesde', () => {
  const agora = new Date('2026-09-09T12:00:00Z');

  it('mede a distância em minutos', () => {
    expect(minutosDesde(agora, new Date('2026-09-09T11:58:00Z'))).toBe(2);
    expect(minutosDesde(agora, new Date('2026-09-09T11:00:00Z'))).toBe(60);
  });

  it('quem nunca esteve no app devolve null, não zero', () => {
    // Zero significaria "acabou de ver" e cortaria o WhatsApp de quem nunca
    // abriu o app — exatamente quem mais precisa do WhatsApp.
    expect(minutosDesde(agora, null)).toBeNull();
  });

  it('relógio adiantado no cliente não vira número negativo', () => {
    expect(minutosDesde(agora, new Date('2026-09-09T12:05:00Z'))).toBe(0);
  });
});
