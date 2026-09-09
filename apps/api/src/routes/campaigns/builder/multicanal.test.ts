/**
 * F60-S07 — campanha nos outros canais.
 *
 * O que este arquivo protege é a fronteira: e-mail entra no criador guiado, o
 * fluxo do WhatsApp não muda, e nenhuma mensagem fala de "número do WhatsApp"
 * quando o canal é outro.
 */
import { describe, expect, it } from 'vitest';
import { ineligibleMessageFor } from './service';

describe('mensagem de inelegibilidade fala do canal certo', () => {
  it('Instagram explica a regra da Meta, não manda reconectar WhatsApp', () => {
    const m = ineligibleMessageFor('provider_unsupported', 'meta_instagram');
    expect(m).toMatch(/instagram/i);
    expect(m).not.toMatch(/whatsapp/i);
  });

  it('WAHA explica o risco de derrubar a conta', () => {
    const m = ineligibleMessageFor('provider_unsupported', 'waha');
    expect(m).toMatch(/derruba|oficial/i);
  });

  it('e-mail com credencial faltando fala de remetente, não de número', () => {
    const m = ineligibleMessageFor('missing_credentials', 'email');
    expect(m).toMatch(/remetente|e-mail/i);
    expect(m).not.toMatch(/número|numero/i);
  });

  it('WhatsApp mantém exatamente a mensagem que já existia', () => {
    // Regressão: o texto em produção hoje é este, e mudá-lo sem motivo
    // confundiria quem já conhece o produto.
    expect(ineligibleMessageFor('missing_credentials', 'meta_whatsapp')).toBe(
      'Reconecte este número do WhatsApp para voltar a enviar campanhas por ele.',
    );
    expect(ineligibleMessageFor('incomplete_setup', 'meta_whatsapp')).toBe(
      'Conclua a conexão deste número do WhatsApp para usá-lo em campanhas.',
    );
  });

  it('provider desconhecido cai num texto genérico, nunca em undefined', () => {
    for (const reason of ['provider_unsupported', 'missing_credentials', 'incomplete_setup'] as const) {
      const m = ineligibleMessageFor(reason, 'canal_do_futuro');
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(10);
      // Genérico não pode mentir dizendo WhatsApp.
      expect(m).not.toMatch(/whatsapp/i);
    }
  });
});
