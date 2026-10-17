import { describe, expect, it } from 'vitest';
import { summarizeDecision, summaryFamily, type DecideItem } from './summary';

const skipped = (reason: DecideItem['reason'], by?: string): DecideItem => ({
  id: `s-${Math.random()}`,
  status: 'skipped',
  ...(reason ? { reason } : {}),
  ...(by ? { edited_by: by } : {}),
});

describe('summarizeDecision', () => {
  it('o exemplo da spec: aprovadas 7, puladas 1 (editada por Paula)', () => {
    expect(
      summarizeDecision({
        family: 'pt',
        decision: 'approve',
        done: 7,
        skipped: [skipped('edited', 'Paula')],
        notFound: 0,
        awaiting: 0,
      }),
    ).toBe('Aprovadas 7, puladas 1 (editada por Paula)');
  });

  it('vários motivos, contagens e nomes', () => {
    expect(
      summarizeDecision({
        family: 'pt',
        decision: 'approve',
        done: 3,
        skipped: [
          skipped('edited', 'Paula'),
          skipped('edited', 'Bruno'),
          skipped('already_decided'),
          skipped('already_decided'),
          skipped('no_longer_in_stage'),
        ],
        notFound: 2,
        awaiting: 1,
      }),
    ).toBe(
      'Aprovadas 3, aguardando confirmação 1, puladas 5 (2 editadas por Paula e Bruno; 2 já decididas; saiu do estágio), não encontradas 2',
    );
  });

  it('editada sem saber por quem; recusar; inglês', () => {
    expect(
      summarizeDecision({
        family: 'pt',
        decision: 'reject',
        done: 2,
        skipped: [skipped('edited')],
        notFound: 0,
        awaiting: 0,
      }),
    ).toBe('Recusadas 2, puladas 1 (editada depois da sugestão)');
    expect(
      summarizeDecision({
        family: 'en',
        decision: 'approve',
        done: 7,
        skipped: [skipped('edited', 'Paula')],
        notFound: 0,
        awaiting: 0,
      }),
    ).toBe('Approved 7, skipped 1 (edited by Paula)');
  });

  it('família pelo locale do workspace', () => {
    expect(summaryFamily('pt-BR')).toBe('pt');
    expect(summaryFamily('en-US')).toBe('en');
  });
});
