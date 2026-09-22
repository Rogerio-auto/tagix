import { describe, expect, it } from 'vitest';
import {
  decideOutbound,
  localHourIn,
  type ConsentSnapshot,
  type OutboundDecisionInput,
} from './consent';

const SEM_CONSENTIMENTO: ConsentSnapshot = {
  suppressedGlobally: false,
  suppressedOnChannel: false,
  marketingStatus: 'never',
  grantedAt: null,
};

const CONSENTIDO: ConsentSnapshot = {
  suppressedGlobally: false,
  suppressedOnChannel: false,
  marketingStatus: 'granted',
  grantedAt: new Date('2026-01-10T12:00:00Z'),
};

/** 15h em Nova York (19:00Z no horário de verão) — dentro de qualquer janela. */
const MEIO_DIA_NY = new Date('2026-07-15T19:00:00Z');

function entrada(over: Partial<OutboundDecisionInput> = {}): OutboundDecisionInput {
  return {
    market: 'US',
    channel: 'sms',
    purpose: 'marketing',
    consent: CONSENTIDO,
    contactTimezone: 'America/New_York',
    channelRegistration: 'approved',
    now: MEIO_DIA_NY,
    ...over,
  };
}

describe('ordem de avaliação', () => {
  it('supressão global vence tudo, inclusive transacional', () => {
    const d = decideOutbound(
      entrada({
        purpose: 'transactional',
        consent: { ...CONSENTIDO, suppressedGlobally: true },
      }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('suppressed');
  });

  it('supressão vence mesmo com canal desabilitado e registro pendente', () => {
    // Garante a ORDEM: se outra checagem viesse antes, o motivo seria outro e a
    // métrica contaria a causa errada.
    const d = decideOutbound(
      entrada({
        channel: 'sms',
        market: 'BR', // sms não habilitado no BR
        channelRegistration: 'pending',
        consent: { ...SEM_CONSENTIMENTO, suppressedGlobally: true },
      }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('suppressed');
  });

  it('supressão só do canal bloqueia aquele canal', () => {
    const d = decideOutbound(
      entrada({ consent: { ...CONSENTIDO, suppressedOnChannel: true } }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('suppressed');
  });

  it('canal fora do mercado é recusado com motivo próprio', () => {
    const d = decideOutbound(entrada({ market: 'BR', channel: 'sms' }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('channel_disabled');
  });

  it('registro 10DLC pendente bloqueia SMS nos EUA', () => {
    const d = decideOutbound(entrada({ channelRegistration: 'pending' }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('registration_pending');
      expect(d.message).toContain('10DLC');
    }
  });
});

describe('consentimento', () => {
  it('marketing sem consentimento é bloqueado onde o mercado exige', () => {
    const d = decideOutbound(entrada({ consent: SEM_CONSENTIMENTO }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('no_consent');
  });

  it('marketing revogado é bloqueado', () => {
    const d = decideOutbound(
      entrada({ consent: { ...SEM_CONSENTIMENTO, marketingStatus: 'revoked' } }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('no_consent');
  });

  it('TRANSACIONAL nunca é bloqueado por falta de consentimento', () => {
    // Regressão crítica: travar isto derruba confirmação e lembrete de
    // agendamento, que é a operação do cliente.
    const d = decideOutbound(entrada({ purpose: 'transactional', consent: SEM_CONSENTIMENTO }));
    expect(d.allowed).toBe(true);
  });

  it('e-mail nos EUA dispensa opt-in prévio (CAN-SPAM)', () => {
    const d = decideOutbound(entrada({ channel: 'email', consent: SEM_CONSENTIMENTO }));
    expect(d.allowed).toBe(true);
  });

  it('WhatsApp no BR segue exigindo consentimento para marketing', () => {
    const d = decideOutbound(
      entrada({ market: 'BR', channel: 'meta_whatsapp', consent: SEM_CONSENTIMENTO }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('no_consent');
  });
});

describe('janela horária no fuso do contato', () => {
  it('permite às 20h59 locais e bloqueia às 21h00 — o limite é exclusivo no fim', () => {
    // 20:59 em Nova York, horário de verão (UTC-4) = 00:59Z do dia seguinte.
    const antes = decideOutbound(
      entrada({ now: new Date('2026-07-16T00:59:00Z'), contactTimezone: 'America/New_York' }),
    );
    const depois = decideOutbound(
      entrada({ now: new Date('2026-07-16T01:00:00Z'), contactTimezone: 'America/New_York' }),
    );
    expect(antes.allowed).toBe(true);
    expect(depois.allowed).toBe(false);
    if (!depois.allowed) expect(depois.reason).toBe('quiet_hours');
  });

  it('bloqueia às 7h59 e permite às 8h00 locais', () => {
    // 07:59 NY (UTC-4) = 11:59Z.
    const antes = decideOutbound(entrada({ now: new Date('2026-07-16T11:59:00Z') }));
    const depois = decideOutbound(entrada({ now: new Date('2026-07-16T12:00:00Z') }));
    expect(antes.allowed).toBe(false);
    expect(depois.allowed).toBe(true);
  });

  it('dois contatos no mesmo instante têm decisões diferentes por fuso', () => {
    // 22:30 em NY é 19:30 em Los Angeles: um está fora da janela, o outro dentro.
    const instante = new Date('2026-07-16T02:30:00Z');
    const ny = decideOutbound(entrada({ now: instante, contactTimezone: 'America/New_York' }));
    const la = decideOutbound(entrada({ now: instante, contactTimezone: 'America/Los_Angeles' }));
    expect(ny.allowed).toBe(false);
    expect(la.allowed).toBe(true);
  });

  it('retryAt cai dentro da janela do dia seguinte, no fuso do contato', () => {
    const d = decideOutbound(entrada({ now: new Date('2026-07-16T02:30:00Z') }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.retryAt).toBeInstanceOf(Date);
      const hora = localHourIn('America/New_York', d.retryAt as Date);
      expect(hora).toBe(8);
      expect((d.retryAt as Date).getTime()).toBeGreaterThan(
        new Date('2026-07-16T02:30:00Z').getTime(),
      );
    }
  });

  it('retryAt de madrugada é no MESMO dia, não no seguinte', () => {
    // 03:00 NY: a janela ainda vai abrir hoje às 08:00.
    const agora = new Date('2026-07-16T07:00:00Z');
    const d = decideOutbound(entrada({ now: agora }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      const espera = (d.retryAt as Date).getTime() - agora.getTime();
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThan(12 * 3600 * 1000);
      expect(localHourIn('America/New_York', d.retryAt as Date)).toBe(8);
    }
  });

  it('atravessa a virada do horário de verão sem errar a hora local', () => {
    // 01/11/2026: EUA saem do horário de verão (UTC-4 → UTC-5) de madrugada.
    const antesDaVirada = new Date('2026-11-01T04:30:00Z'); // 00:30 EDT
    const d = decideOutbound(entrada({ now: antesDaVirada }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      // A janela abre às 8h locais JÁ no horário padrão (EST).
      expect(localHourIn('America/New_York', d.retryAt as Date)).toBe(8);
    }
  });

  it('canal sem janela legal não é bloqueado por horário', () => {
    const madrugada = new Date('2026-07-16T06:00:00Z'); // 02:00 NY
    const email = decideOutbound(entrada({ channel: 'email', now: madrugada }));
    expect(email.allowed).toBe(true);
  });
});

describe('fuso ausente', () => {
  it('cai no padrão do mercado e sinaliza que caiu', () => {
    const d = decideOutbound(entrada({ contactTimezone: null }));
    expect(d.usedFallbackTimezone).toBe(true);
    expect(d.timezone).toBe('America/New_York');
  });

  it('no BR o padrão é São Paulo', () => {
    const d = decideOutbound(
      entrada({ market: 'BR', channel: 'meta_whatsapp', contactTimezone: null }),
    );
    expect(d.timezone).toBe('America/Sao_Paulo');
  });
});

describe('recusa nunca é silenciosa', () => {
  it('toda recusa carrega motivo enum e mensagem exibível', () => {
    const recusas = [
      entrada({ consent: { ...CONSENTIDO, suppressedGlobally: true } }),
      entrada({ market: 'BR', channel: 'sms' }),
      entrada({ channelRegistration: 'pending' }),
      entrada({ consent: SEM_CONSENTIMENTO }),
      entrada({ now: new Date('2026-07-16T02:30:00Z') }),
    ].map(decideOutbound);

    expect(recusas.every((d) => !d.allowed)).toBe(true);
    for (const d of recusas) {
      if (d.allowed) continue;
      expect(d.message.length).toBeGreaterThan(10);
      expect(d.reason).toBeTruthy();
      expect(d.timezone).toBeTruthy();
    }
    // Cada cenário produz um motivo distinto — nenhum colapsa em "genérico".
    const motivos = new Set(recusas.map((d) => (d.allowed ? '' : d.reason)));
    expect(motivos.size).toBe(5);
  });

  it('só quiet_hours traz retryAt — as outras recusas não se resolvem com o tempo', () => {
    const semRetry = decideOutbound(entrada({ consent: SEM_CONSENTIMENTO }));
    if (!semRetry.allowed) expect(semRetry.retryAt).toBeUndefined();

    const comRetry = decideOutbound(entrada({ now: new Date('2026-07-16T02:30:00Z') }));
    if (!comRetry.allowed) expect(comRetry.retryAt).toBeInstanceOf(Date);
  });
});

describe('localHourIn', () => {
  it('converte para a hora local do fuso, não do servidor', () => {
    const meiaNoiteUtc = new Date('2026-07-16T00:00:00Z');
    expect(localHourIn('UTC', meiaNoiteUtc)).toBe(0);
    expect(localHourIn('America/New_York', meiaNoiteUtc)).toBe(20);
    expect(localHourIn('America/Sao_Paulo', meiaNoiteUtc)).toBe(21);
  });
});

describe('janela horária vale para marketing, não para transacional', () => {
  it('transacional passa fora da janela — o atendente responde quem escreveu', () => {
    // 22:30 em Nova York. Quem escreveu às 22:29 merece resposta; bloquear aqui
    // quebraria o uso central do produto sem ganho de conformidade. A restrição
    // do TCPA é sobre solicitação comercial.
    const d = decideOutbound(
      entrada({ purpose: 'transactional', now: new Date('2026-07-16T02:30:00Z') }),
    );
    expect(d.allowed).toBe(true);
  });

  it('marketing continua bloqueado no mesmo instante', () => {
    const d = decideOutbound(
      entrada({ purpose: 'marketing', now: new Date('2026-07-16T02:30:00Z') }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('quiet_hours');
  });

  it('supressão bloqueia transacional mesmo fora da janela — supressão vence sempre', () => {
    const d = decideOutbound(
      entrada({
        purpose: 'transactional',
        now: new Date('2026-07-16T02:30:00Z'),
        consent: { ...CONSENTIDO, suppressedGlobally: true },
      }),
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('suppressed');
  });
});
