/**
 * F61-S04 — a regra que impede o dono de desligar as notificações.
 *
 * O que este arquivo protege: que o mesmo evento nunca vire três avisos, que a
 * preferência do membro nunca seja revertida por uma regra "esperta", e que o
 * silêncio noturno não esconda o lead de quem está com o app aberto às 23h.
 *
 * Notificação demais não é incômodo: é a destruição do canal. Uma vez que o dono
 * desliga, ele não religa — e o tempo de resposta volta ao que era antes do
 * produto existir.
 */
import { describe, expect, it } from 'vitest';
import { channelsFor, inQuietHours, routeNotification } from './notifications';

const base = {
  evento: 'lead_novo' as const,
  prefs: {},
  horaLocal: 14,
  minutosDesdeUltimaVisita: null,
  jaAvisado: false,
  canaisDisponiveis: ['push', 'whatsapp', 'email'] as const,
};

describe('channelsFor — o interruptor geral restringe, nunca amplia', () => {
  it('sem preferência nenhuma, lead novo sai por push e WhatsApp', () => {
    // É o único evento que justifica interromper alguém.
    expect(channelsFor({}, 'lead_novo')).toEqual(['push', 'whatsapp']);
  });

  it('nenhum evento manda e-mail por padrão', () => {
    // E-mail de notificação vira filtro, e filtro é como um canal morre em
    // silêncio.
    for (const ev of ['lead_novo', 'mensagem_nova', 'no_show'] as const) {
      expect(channelsFor({}, ev)).not.toContain('email');
    }
  });

  it('push desligado no perfil tira o push mesmo do default', () => {
    expect(channelsFor({ push: false }, 'lead_novo')).toEqual(['whatsapp']);
  });

  it('escolha explícita por evento vence o default E o interruptor geral', () => {
    // O membro decidiu para ESTE evento; nada acima disso.
    expect(channelsFor({ push: false, byEvent: { lead_novo: ['push'] } }, 'lead_novo')).toEqual([
      'push',
    ]);
  });

  it('lista vazia por evento significa "não me avise disso"', () => {
    expect(channelsFor({ byEvent: { mensagem_nova: [] } }, 'mensagem_nova')).toEqual([]);
  });

  it('prefs nulo (linha antiga do banco) não quebra', () => {
    expect(channelsFor(null, 'lead_novo')).toEqual(['push', 'whatsapp']);
    expect(channelsFor(undefined, 'lead_novo')).toEqual(['push', 'whatsapp']);
  });
});

describe('inQuietHours', () => {
  it('janela normal dentro do mesmo dia', () => {
    expect(inQuietHours(13, { startHour: 12, endHour: 14 })).toBe(true);
    expect(inQuietHours(15, { startHour: 12, endHour: 14 })).toBe(false);
  });

  it('janela que cruza a meia-noite — o caso REAL (22h → 7h)', () => {
    const noite = { startHour: 22, endHour: 7 };
    expect(inQuietHours(23, noite)).toBe(true);
    expect(inQuietHours(2, noite)).toBe(true);
    expect(inQuietHours(6, noite)).toBe(true);
    expect(inQuietHours(7, noite)).toBe(false);
    expect(inQuietHours(14, noite)).toBe(false);
  });

  it('início igual ao fim é "sem silêncio", não "silêncio o dia todo"', () => {
    // Interpretar como 24h de silêncio desligaria as notificações de quem só
    // mexeu no formulário sem querer.
    expect(inQuietHours(3, { startHour: 8, endHour: 8 })).toBe(false);
  });

  it('sem janela configurada nunca silencia', () => {
    expect(inQuietHours(3, undefined)).toBe(false);
  });
});

describe('routeNotification', () => {
  it('caminho feliz: push e WhatsApp', () => {
    const d = routeNotification(base);
    expect(d.channels).toEqual(['push', 'whatsapp']);
    expect(d.suppressedBy).toBeNull();
  });

  it('evento já avisado NÃO sai de novo — é o que impede retry de fila virar spam', () => {
    const d = routeNotification({ ...base, jaAvisado: true });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('ja_avisado');
  });

  it('sem push disponível, o WhatsApp ainda sai', () => {
    // Se push indisponível cortasse a cascata, quem não instalou o app nunca
    // seria avisado.
    const d = routeNotification({ ...base, canaisDisponiveis: ['whatsapp', 'email'] });
    expect(d.channels).toEqual(['whatsapp']);
  });

  it('preferência que só cita canal indisponível é reportada como indisponível', () => {
    // Distinto de 'preferencia': o membro aceitaria, o produto é que não entrega.
    // Confundir os dois esconderia um canal quebrado atrás de "o usuário não quis".
    const d = routeNotification({
      ...base,
      prefs: { byEvent: { lead_novo: ['whatsapp'] } },
      canaisDisponiveis: ['push'],
    });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('indisponivel');
  });

  it('quem acabou de ver o app não recebe WhatsApp, mas recebe push', () => {
    // O push acende o badge sem interromper; o WhatsApp interrompe.
    const d = routeNotification({ ...base, minutosDesdeUltimaVisita: 2 });
    expect(d.channels).toEqual(['push']);
  });

  it('quem viu há 20 minutos recebe tudo de novo', () => {
    const d = routeNotification({ ...base, minutosDesdeUltimaVisita: 20 });
    expect(d.channels).toEqual(['push', 'whatsapp']);
  });

  it('acabou de ver E só tinha WhatsApp: não avisa', () => {
    const d = routeNotification({
      ...base,
      prefs: { byEvent: { lead_novo: ['whatsapp'] } },
      minutosDesdeUltimaVisita: 1,
    });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('ja_viu');
  });

  it('no silêncio, só e-mail passa — ele espera na caixa e não acorda ninguém', () => {
    const d = routeNotification({
      ...base,
      prefs: { quietHours: { startHour: 22, endHour: 7 }, byEvent: { lead_novo: ['push', 'email'] } },
      horaLocal: 23,
    });
    expect(d.channels).toEqual(['email']);
  });

  it('silêncio sem canal silencioso: não avisa', () => {
    const d = routeNotification({
      ...base,
      prefs: { quietHours: { startHour: 22, endHour: 7 } },
      horaLocal: 2,
    });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('silencio');
  });

  it('app aberto às 23h: o push SAI, o silêncio não esconde de quem está olhando', () => {
    // "Já viu" roda ANTES de "silêncio" justamente para isto: quem está com o app
    // aberto de madrugada está trabalhando, e silenciar seria esconder o lead de
    // quem está olhando a fila.
    const d = routeNotification({
      ...base,
      prefs: { quietHours: { startHour: 22, endHour: 7 } },
      horaLocal: 23,
      minutosDesdeUltimaVisita: 1,
    });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('silencio');
  });

  it('preferência vazia nunca vira aviso — a decisão do membro é final', () => {
    const d = routeNotification({ ...base, prefs: { byEvent: { lead_novo: [] } } });
    expect(d.channels).toEqual([]);
    expect(d.suppressedBy).toBe('preferencia');
  });

  it('"já avisado" vence tudo, inclusive preferência ampla', () => {
    const d = routeNotification({
      ...base,
      prefs: { byEvent: { lead_novo: ['push', 'whatsapp', 'email'] } },
      jaAvisado: true,
    });
    expect(d.channels).toEqual([]);
  });
});
