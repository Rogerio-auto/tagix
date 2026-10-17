import { describe, expect, it } from 'vitest';
import { computeConfidence, CONFIDENCE_MIN_WINS, type StageDwell } from './confidence';
import {
  buildReason,
  composeReasonText,
  confidenceSentence,
  formatShortDate,
  REASON_TEXT_MAX,
} from './reason';

// 07/10/2026 15:00 UTC = 12:00 em São Paulo; 08/10/2026 02:30 UTC = 07/10 23:30 em São Paulo.
const OCT_7_NOON_BRT = new Date('2026-10-07T15:00:00Z');
const LATE_NIGHT_UTC = new Date('2026-10-08T02:30:00Z');

describe('buildReason (modelo de texto, nunca score)', () => {
  it('última mensagem nossa: o exemplo da spec', () => {
    const r = buildReason({
      idleDays: 9,
      lastDirection: 'outbound',
      lastMessageAt: OCT_7_NOON_BRT,
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
    });
    expect(r.code).toBe('idle_last_outbound');
    expect(r.text).toBe('Sem resposta há 9 dias; a última mensagem foi nossa, em 07/10.');
  });

  it('singular, e a data respeita o fuso do workspace (23:30 de 07/10 em São Paulo)', () => {
    const r = buildReason({
      idleDays: 1,
      lastDirection: 'outbound',
      lastMessageAt: LATE_NIGHT_UTC,
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
    });
    expect(r.text).toBe('Sem resposta há 1 dia; a última mensagem foi nossa, em 07/10.');
    expect(formatShortDate(LATE_NIGHT_UTC, 'pt-BR', 'UTC')).toBe('08/10');
  });

  it('última mensagem do cliente', () => {
    const r = buildReason({
      idleDays: 6,
      lastDirection: 'inbound',
      lastMessageAt: OCT_7_NOON_BRT,
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
    });
    expect(r.code).toBe('idle_last_inbound');
    expect(r.text).toBe('Sem retorno nosso há 6 dias; a última mensagem foi do cliente, em 07/10.');
  });

  it('sem conversa ou sem mensagem: só a parada', () => {
    const r = buildReason({
      idleDays: 5,
      lastDirection: null,
      lastMessageAt: null,
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
    });
    expect(r.code).toBe('idle_no_messages');
    expect(r.text).toBe('Sem movimentação há 5 dias.');
  });

  it('inglês e fuso inválido (cai para UTC, nunca lança)', () => {
    const r = buildReason({
      idleDays: 9,
      lastDirection: 'outbound',
      lastMessageAt: OCT_7_NOON_BRT,
      locale: 'en-US',
      timeZone: 'Nao/Existe',
    });
    expect(r.text).toBe('No reply for 9 days; the last message was ours, on 10/07.');
  });

  it('nenhum texto traz score ou número decimal', () => {
    for (const level of ['high', 'medium', 'low'] as const) {
      for (const basis of ['history', 'thin_history'] as const) {
        const s = confidenceSentence('pt-BR', level, basis);
        expect(s).not.toMatch(/\d/);
        expect(s.toLowerCase()).not.toContain('score');
      }
    }
  });

  it('composeReasonText respeita o limite do banco', () => {
    const reason = { code: 'idle_no_messages', text: 'x'.repeat(100) } as const;
    expect(composeReasonText(reason, 'y'.repeat(300)).length).toBeLessThanOrEqual(REASON_TEXT_MAX);
    expect(composeReasonText(reason, 'ok')).toBe(`${'x'.repeat(100)} ok`);
  });
});

describe('computeConfidence (p50/p90 dos negócios ganhos)', () => {
  const dwell: StageDwell = { wins: 10, p50Days: 5.5, p90Days: 9.1 };

  it('acima do p90 = high; entre p50 e p90 = medium; abaixo do p50 = low', () => {
    expect(computeConfidence(10, dwell)).toEqual({ level: 'high', basis: 'history' });
    expect(computeConfidence(7, dwell)).toEqual({ level: 'medium', basis: 'history' });
    expect(computeConfidence(5, dwell)).toEqual({ level: 'low', basis: 'history' });
  });

  it('as bordas: exatamente p90 ainda é medium; exatamente p50 é medium', () => {
    expect(computeConfidence(9, { wins: 12, p50Days: 4, p90Days: 9 }).level).toBe('medium');
    expect(computeConfidence(4, { wins: 12, p50Days: 4, p90Days: 9 }).level).toBe('medium');
    expect(computeConfidence(3, { wins: 12, p50Days: 4, p90Days: 9 }).level).toBe('low');
  });

  it(`menos de ${CONFIDENCE_MIN_WINS} ganhos (ou nenhum): medium fixo, pouco histórico`, () => {
    expect(computeConfidence(60, { wins: 9, p50Days: 1, p90Days: 2 })).toEqual({
      level: 'medium',
      basis: 'thin_history',
    });
    expect(computeConfidence(1, null)).toEqual({ level: 'medium', basis: 'thin_history' });
    expect(confidenceSentence('pt-BR', 'medium', 'thin_history')).toContain('pouco histórico');
  });
});
