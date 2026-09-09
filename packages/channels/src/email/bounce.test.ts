import { describe, expect, it } from 'vitest';
import { SOFT_BOUNCE_LIMIT, decideOnEmailEvent, resetsSoftBounces } from './bounce';
import type { EmailEvent, EmailEventKind } from './provider';

function evento(kind: EmailEventKind, recipient = 'lead@exemplo.com'): EmailEvent {
  return { kind, messageId: 'm1@x', recipient, occurredAt: new Date() };
}

describe('bounce duro suprime — insistir queima o domínio', () => {
  it('suprime de imediato', () => {
    const d = decideOnEmailEvent(evento('hard_bounce'));
    expect(d.action).toBe('suppress');
    expect(d.reason).toBe('hard_bounce');
    expect(d.message).toContain('lead@exemplo.com');
  });
});

describe('reclamação de spam suprime — é o sinal mais caro que existe', () => {
  it('suprime de imediato', () => {
    const d = decideOnEmailEvent(evento('complaint'));
    expect(d.action).toBe('suppress');
    expect(d.reason).toBe('complaint');
  });
});

describe('bounce leve NÃO suprime — a pessoa pode estar de férias', () => {
  it('primeira falha só registra', () => {
    const d = decideOnEmailEvent(evento('soft_bounce'), 0);
    expect(d.action).toBe('record');
    expect(d.message).toContain('segue ativo');
  });

  it('registra até um antes do limite', () => {
    for (let n = 0; n < SOFT_BOUNCE_LIMIT - 1; n += 1) {
      expect(decideOnEmailEvent(evento('soft_bounce'), n).action).toBe('record');
    }
  });

  it('no limite, para de tratar como transitório', () => {
    // Caixa cheia há duas semanas não vai esvaziar.
    const d = decideOnEmailEvent(evento('soft_bounce'), SOFT_BOUNCE_LIMIT - 1);
    expect(d.action).toBe('suppress');
    expect(d.reason).toBe('soft_bounce_exhausted');
  });

  it('a mensagem diz em que ponto da contagem está', () => {
    const d = decideOnEmailEvent(evento('soft_bounce'), 2);
    expect(d.message).toContain('3');
    expect(d.message).toContain(String(SOFT_BOUNCE_LIMIT));
  });
});

describe('eventos que não mexem no endereço', () => {
  it.each(['delivered', 'opened', 'clicked'] as const)('%s não suprime nem registra falha', (k) => {
    expect(decideOnEmailEvent(evento(k)).action).toBe('none');
  });
});

describe('contagem de falhas transitórias', () => {
  it('entrega zera a contagem', () => {
    expect(resetsSoftBounces('delivered')).toBe(true);
  });

  it('nenhum outro evento zera', () => {
    for (const k of ['opened', 'clicked', 'soft_bounce', 'hard_bounce', 'complaint'] as const) {
      expect(resetsSoftBounces(k)).toBe(false);
    }
  });
});

describe('as duas decisões erradas', () => {
  it('nenhum evento transitório suprime na primeira ocorrência', () => {
    // Perder um cliente que só estava com a caixa cheia é irreversível na
    // prática: ele volta e nunca mais recebe nada.
    expect(decideOnEmailEvent(evento('soft_bounce'), 0).action).not.toBe('suppress');
  });

  it('todo evento permanente suprime na primeira ocorrência', () => {
    // Insistir em endereço morto é o que derruba a reputação do domínio, e
    // quando ela cai a confirmação de agendamento de quem existe para de chegar.
    for (const k of ['hard_bounce', 'complaint'] as const) {
      expect(decideOnEmailEvent(evento(k), 0).action).toBe('suppress');
    }
  });
});
