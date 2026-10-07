/**
 * F60-S02 — restrição de envio genérica.
 *
 * A composição entre janela do provider e portão de consentimento é pura e está
 * testada aqui sem banco. O endpoint que a usa tem cobertura em `routes.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { OutboundDecision } from '@hm/shared';
import { computeWindow, toRestriction, type WindowState } from './window';

const permitido: OutboundDecision = {
  allowed: true,
  usedFallbackTimezone: false,
  timezone: 'America/Sao_Paulo',
};

function janela(over: Partial<WindowState> = {}): WindowState {
  return {
    provider: 'meta_whatsapp',
    isOpen: true,
    expiresAt: null,
    requiresTemplate: false,
    messageTag: null,
    ...over,
  };
}

describe('o portão vence a janela', () => {
  it('contato suprimido não recebe nem DENTRO da janela de 24h', () => {
    // A janela diz o que a Meta permite; o portão diz o que a pessoa consentiu.
    // Consentimento é o mais forte dos dois.
    const r = toRestriction(janela({ isOpen: true }), {
      allowed: false,
      reason: 'suppressed',
      message: 'Contato pediu para não receber mais mensagens.',
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    });
    expect(r.canSend).toBe(false);
    expect(r.reason).toBe('suppressed');
    expect(r.message).toContain('não receber');
  });

  it('recusa que se resolve com o tempo carrega retryAt em ISO', () => {
    const quando = new Date('2026-07-16T12:00:00Z');
    const r = toRestriction(janela(), {
      allowed: false,
      reason: 'quiet_hours',
      message: 'Fora da janela permitida.',
      retryAt: quando,
      usedFallbackTimezone: false,
      timezone: 'America/New_York',
    });
    expect(r.retryAt).toBe(quando.toISOString());
  });

  it('recusa que NÃO se resolve com o tempo vem sem retryAt', () => {
    const r = toRestriction(janela(), {
      allowed: false,
      reason: 'no_consent',
      message: 'Sem consentimento.',
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    });
    expect(r.retryAt).toBeNull();
  });
});

describe('janela do provider', () => {
  it('dentro da janela e sem recusa: pode enviar', () => {
    const r = toRestriction(janela({ isOpen: true }), permitido);
    expect(r.canSend).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('WhatsApp fora da janela NÃO bloqueia o composer — muda de modo', () => {
    // `canSend: true` com motivo declarado: a UI oferece o modelo aprovado em
    // vez de exibir um campo morto.
    const r = toRestriction(
      janela({ isOpen: false, requiresTemplate: true, expiresAt: '2026-07-15T00:00:00Z' }),
      permitido,
    );
    expect(r.canSend).toBe(true);
    expect(r.reason).toBe('provider_window');
    expect(r.message).toContain('modelo aprovado');
  });

  it('Instagram fora da janela avisa que usará a tag de atendimento humano', () => {
    const r = toRestriction(
      janela({ provider: 'meta_instagram', isOpen: false, messageTag: 'HUMAN_AGENT' }),
      permitido,
    );
    expect(r.canSend).toBe(true);
    expect(r.reason).toBe('provider_window');
    expect(r.message).toContain('atendimento humano');
  });

  it('WAHA não tem janela: sempre ok', () => {
    const r = toRestriction(janela({ provider: 'waha', isOpen: true }), permitido);
    expect(r.canSend).toBe(true);
    expect(r.reason).toBe('ok');
  });
});

describe('conversa sem contato', () => {
  it('não consulta consentimento e cai na janela do provider', () => {
    // Grupo ou thread de comentário órfã: não há a quem consultar consentimento.
    const dentro = toRestriction(janela({ isOpen: true }), null);
    expect(dentro.canSend).toBe(true);

    const fora = toRestriction(janela({ isOpen: false, requiresTemplate: true }), null);
    expect(fora.reason).toBe('provider_window');
  });
});

describe('toda recusa é exibível', () => {
  it('mensagem nunca é vazia quando bloqueia', () => {
    for (const reason of [
      'suppressed',
      'no_consent',
      'quiet_hours',
      'registration_pending',
      'channel_disabled',
    ] as const) {
      const r = toRestriction(janela(), {
        allowed: false,
        reason,
        message: `motivo: ${reason}`,
        usedFallbackTimezone: false,
        timezone: 'UTC',
      });
      expect(r.canSend).toBe(false);
      expect(r.message.length).toBeGreaterThan(0);
      expect(r.reason).toBe(reason);
    }
  });
});

describe('F60-S11 — texto pronto para o atendente', () => {
  const recusa = (message: string): OutboundDecision => ({
    allowed: false,
    reason: 'suppressed',
    message,
    usedFallbackTimezone: false,
    timezone: 'America/Sao_Paulo',
  });

  it('troca o identificador técnico do canal pelo nome que o atendente conhece', () => {
    const r = toRestriction(
      janela({ provider: 'meta_whatsapp' }),
      recusa('Contato pediu para não receber mensagens por meta_whatsapp.'),
    );
    expect(r.message).toBe('Contato pediu para não receber mensagens por WhatsApp.');
    expect(r.reason).toBe('suppressed');
  });

  it('e-mail e Instagram também saem legíveis', () => {
    const email = toRestriction(
      janela({ provider: 'email' }),
      recusa('Contato pediu para não receber mensagens por email.'),
    );
    expect(email.message).toBe('Contato pediu para não receber mensagens por e-mail.');

    const ig = toRestriction(
      janela({ provider: 'meta_instagram' }),
      recusa('Contato pediu para não receber mensagens por meta_instagram.'),
    );
    expect(ig.message).toContain('por Instagram');
  });

  it('frase sem o identificador do canal passa intacta', () => {
    const r = toRestriction(
      janela(),
      recusa('Contato pediu para não receber mais mensagens desta empresa.'),
    );
    expect(r.message).toBe('Contato pediu para não receber mais mensagens desta empresa.');
  });
});

describe('computeWindow — regressão da janela de 24h do WhatsApp', () => {
  const agora = new Date('2026-10-07T12:00:00Z');
  const horasAtras = (h: number) => new Date(agora.getTime() - h * 60 * 60 * 1000);

  it('inbound há 23h: janela aberta, expira 24h depois do inbound', () => {
    const w = computeWindow('meta_whatsapp', horasAtras(23), agora);
    expect(w.isOpen).toBe(true);
    expect(w.requiresTemplate).toBe(false);
    expect(w.expiresAt).toBe(new Date(horasAtras(23).getTime() + 24 * 3_600_000).toISOString());
  });

  it('inbound há exatamente 24h: janela fechada, só modelo aprovado', () => {
    const w = computeWindow('meta_whatsapp', horasAtras(24), agora);
    expect(w.isOpen).toBe(false);
    expect(w.requiresTemplate).toBe(true);
    expect(toRestriction(w, null).reason).toBe('provider_window');
  });

  it('sem inbound nenhum: exige modelo aprovado', () => {
    const w = computeWindow('meta_whatsapp', null, agora);
    expect(w).toMatchObject({ isOpen: false, requiresTemplate: true, expiresAt: null });
  });

  it('Instagram fora da janela usa a tag, não modelo', () => {
    const w = computeWindow('meta_instagram', horasAtras(30), agora);
    expect(w).toMatchObject({ isOpen: false, requiresTemplate: false, messageTag: 'HUMAN_AGENT' });
  });

  it('WAHA e e-mail não têm janela', () => {
    for (const provider of ['waha', 'email'] as const) {
      const w = computeWindow(provider, null, agora);
      expect(w).toMatchObject({ isOpen: true, requiresTemplate: false, messageTag: null });
    }
  });
});
