/**
 * F58-S07 — a primeira pergunta do criador de campanha.
 *
 * O que este arquivo protege: que "posso avançar?" nunca minta. Liberar cedo leva
 * o usuário a um passo que vai falhar depois; travar sem motivo faz ele desistir
 * no primeiro campo — e quem desiste no primeiro campo não volta.
 */
import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  channelLabel,
  sortChannels,
  validateBasics,
  warnBasics,
  NAME_MAX,
  type ChannelChoice,
} from './model';

const canal = (over: Partial<ChannelChoice> = {}): ChannelChoice => ({
  id: 'ch-1',
  name: 'WhatsApp Principal',
  displayHandle: '+55 66 99934-2444',
  provider: 'meta_whatsapp',
  eligible: true,
  ineligibleMessage: null,
  approvedTemplateCount: 3,
  ...over,
});

const ok = { name: 'Promoção de março', mode: 'single' as const, channelId: 'ch-1' };

describe('validateBasics', () => {
  it('estado completo e canal elegível libera o avanço', () => {
    expect(validateBasics(ok, [canal()])).toEqual({});
    expect(canAdvance(ok, [canal()])).toBe(true);
  });

  it('cobra nome, modo e canal em linguagem de dono, não de sistema', () => {
    const e = validateBasics({ name: '  ', mode: null, channelId: null }, []);
    expect(e.name).toBeDefined();
    expect(e.mode).toBeDefined();
    expect(e.channelId).toBeDefined();
    for (const msg of Object.values(e)) {
      expect(msg).not.toMatch(/broadcast|drip|triggered|channelId|null/i);
    }
  });

  it('nome acima do teto é recusado', () => {
    expect(validateBasics({ ...ok, name: 'a'.repeat(NAME_MAX + 1) }, [canal()]).name).toBeDefined();
  });

  it('canal inelegível usa a mensagem que a API traduziu', () => {
    // A API sabe o provider; a UI não pode inventar "reconecte o WhatsApp"
    // quando o problema é o remetente de e-mail.
    const e = validateBasics(ok, [
      canal({ eligible: false, ineligibleMessage: 'Reconecte o remetente de e-mail deste canal.' }),
    ]);
    expect(e.channelId).toBe('Reconecte o remetente de e-mail deste canal.');
  });

  it('canal que sumiu da lista vira erro acionável, não silêncio', () => {
    // Desconectado noutra aba ou removido por outro membro. Silenciar deixaria o
    // usuário travado num erro que só apareceria no fim do wizard.
    const e = validateBasics(ok, [canal({ id: 'outro' })]);
    expect(e.channelId).toMatch(/não está mais disponível/i);
  });
});

describe('warnBasics — avisa sem travar', () => {
  it('canal sem modelo aprovado avisa, mas deixa continuar', () => {
    // Travar aqui obrigaria o usuário a abandonar o rascunho para aprovar um
    // modelo — e rascunho abandonado não vira campanha.
    const canais = [canal({ approvedTemplateCount: 0 })];
    expect(warnBasics(ok, canais).channelId).toBeDefined();
    expect(canAdvance(ok, canais)).toBe(true);
  });

  it('canal com modelo aprovado não gera aviso', () => {
    expect(warnBasics(ok, [canal()])).toEqual({});
  });

  it('canal inelegível não gera aviso — já é erro', () => {
    expect(warnBasics(ok, [canal({ eligible: false, approvedTemplateCount: 0 })])).toEqual({});
  });
});

describe('sortChannels', () => {
  it('elegível primeiro, e entre eles o que já consegue enviar hoje', () => {
    const lista = [
      canal({ id: 'c', name: 'Sem modelo', approvedTemplateCount: 0 }),
      canal({ id: 'd', name: 'Inelegível', eligible: false }),
      canal({ id: 'a', name: 'Pronto', approvedTemplateCount: 5 }),
    ];
    expect(sortChannels(lista).map((c) => c.id)).toEqual(['a', 'c', 'd']);
  });

  it('NÃO esconde canal inelegível', () => {
    // Sumir com o número do cliente produz a pior pergunta de suporte:
    // "cadê meu número?".
    const lista = [canal({ id: 'x', eligible: false })];
    expect(sortChannels(lista)).toHaveLength(1);
  });

  it('não muta a lista recebida', () => {
    const lista = [canal({ id: 'b', name: 'B' }), canal({ id: 'a', name: 'A' })];
    const copia = [...lista];
    sortChannels(lista);
    expect(lista).toEqual(copia);
  });
});

describe('channelLabel', () => {
  it('mostra apelido e número quando há', () => {
    expect(channelLabel(canal())).toBe('WhatsApp Principal · +55 66 99934-2444');
  });

  it('sem número, só o apelido — nunca um separador solto', () => {
    expect(channelLabel(canal({ displayHandle: null }))).toBe('WhatsApp Principal');
    expect(channelLabel(canal({ displayHandle: '' }))).toBe('WhatsApp Principal');
  });
});
