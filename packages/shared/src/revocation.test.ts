import { describe, expect, it } from 'vitest';
import { getOutboundPolicy } from './markets';
import {
  actionFor,
  detectRevocation,
  normalize,
  REVOCATION_AUTO_THRESHOLD,
  REVOCATION_REVIEW_THRESHOLD,
} from './revocation';

const KW = getOutboundPolicy('US', 'sms').optOutKeywords;
const detect = (t: string) => detectRevocation(t, KW);

describe('camada 1 — palavra-chave', () => {
  it.each(['STOP', 'stop', 'Stop.', ' PARE ', 'sair', 'CANCELAR', 'unsubscribe', 'descadastrar'])(
    'reconhece %s isolada com confiança máxima',
    (texto) => {
      const d = detect(texto);
      expect(d.detected).toBe(true);
      expect(d.layer).toBe('keyword');
      expect(d.confidence).toBe(1);
      expect(actionFor(d)).toBe('suppress');
    },
  );

  it('aceita cortesia junto ("stop please", "pare por favor" é frase)', () => {
    expect(detect('stop please').detected).toBe(true);
  });

  it('palavra-chave dentro de frase longa NÃO dispara a camada 1', () => {
    // "cancelar" aqui é sobre o agendamento, não sobre receber mensagem.
    const d = detect('preciso cancelar meu agendamento de amanha');
    expect(d.layer).not.toBe('keyword');
  });

  it('palavra-chave em português é reconhecida no mercado US e vice-versa', () => {
    // Brasileiro na Flórida escreve PARE; americano no Brasil escreve STOP.
    expect(detectRevocation('PARE', getOutboundPolicy('US', 'sms').optOutKeywords).detected).toBe(
      true,
    );
    expect(
      detectRevocation('STOP', getOutboundPolicy('BR', 'meta_whatsapp').optOutKeywords).detected,
    ).toBe(true);
  });
});

describe('camada 2 — qualquer meio razoável', () => {
  it.each([
    'para de me mandar mensagem',
    'nao me manda mais mensagem',
    'não quero mais receber essas mensagens',
    'me tira dessa lista',
    'me descadastra por favor',
    'chega de mensagens',
    'pare com essas mensagens',
    'stop texting me',
    'do not text me again',
    'no more texts',
    'remove me from your list',
    'take me off the list',
  ])('detecta "%s"', (texto) => {
    const d = detect(texto);
    expect(d.detected).toBe(true);
    expect(d.layer).toBe('phrase');
    expect(actionFor(d)).toBe('suppress');
  });

  it('fala genérica sobre a empresa revoga escopo de EMPRESA', () => {
    const d = detect('nao quero mais nada de voces');
    expect(d.scope).toBe('company');
  });

  it('pedido sobre as mensagens revoga escopo de CANAL', () => {
    const d = detect('para de me mandar mensagem');
    expect(d.scope).toBe('channel');
  });

  it('desinteresse fica na faixa de REVISÃO, não suprime sozinho', () => {
    // "não tenho interesse" pode ser sobre a oferta, não sobre receber mensagem.
    // Suprimir por isso apagaria um lead que só disse não a uma proposta.
    const d = detect('nao tenho interesse');
    expect(d.detected).toBe(true);
    expect(actionFor(d)).toBe('review');
    expect(d.confidence).toBeGreaterThanOrEqual(REVOCATION_REVIEW_THRESHOLD);
    expect(d.confidence).toBeLessThan(REVOCATION_AUTO_THRESHOLD);
  });

  it('texto longo não é comando — camada 2 nem roda', () => {
    const longo =
      'oi bom dia tudo bem entao eu queria entender melhor o orcamento que voces mandaram ' +
      'porque para de me mandar sentido nenhum aquele valor la do banheiro';
    expect(detect(longo).detected).toBe(false);
  });

  it('registra o trecho que disparou — evidência auditável', () => {
    const d = detect('por favor para de me mandar mensagem');
    expect(d.matched).toBeTruthy();
    expect(typeof d.matched).toBe('string');
  });
});

describe('falso positivo é o risco caro', () => {
  it.each([
    'nao para de chegar lead, que bom',
    'nao parou de chegar orcamento essa semana',
    'nao pare de mandar as novidades',
    'pode continuar mandando',
    'nao quero cancelar nada',
    'nao cancela meu horario por favor',
    'como faco para cancelar o meu plano',
    'preciso cancelar meu agendamento',
    'cancelar a visita de sexta',
    'cancel my appointment please',
    'dont stop sending me these',
    'keep sending updates',
    'quero saber quanto custa parar a obra',
    'o pedreiro parou de trabalhar ontem',
    'nao e para parar o servico',
  ])('NÃO suprime "%s"', (texto) => {
    const d = detect(texto);
    expect(actionFor(d)).not.toBe('suppress');
  });

  it('mensagem vazia ou só pontuação não detecta nada', () => {
    expect(detect('').detected).toBe(false);
    expect(detect('   ').detected).toBe(false);
    expect(detect('!!!???').detected).toBe(false);
  });

  it('conversa comum não dispara', () => {
    for (const t of [
      'bom dia',
      'quanto custa',
      'pode me ligar amanha',
      'obrigado pelo orcamento',
      'vou pensar e te falo',
      'thanks for the quote',
    ]) {
      expect(detect(t).detected).toBe(false);
    }
  });
});

describe('normalize', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalize('  NÃO, Quero MAIS!! ')).toBe('nao quero mais');
    expect(normalize('Pare.')).toBe('pare');
  });

  it('é idempotente', () => {
    const t = 'me tira dessa lista';
    expect(normalize(normalize(t))).toBe(normalize(t));
  });
});

describe('actionFor', () => {
  it('mapeia confiança em ação de forma monotônica', () => {
    expect(actionFor({ detected: false, confidence: 0, layer: 'none', scope: 'channel' })).toBe(
      'ignore',
    );
    expect(actionFor({ detected: true, confidence: 0.95, layer: 'phrase', scope: 'channel' })).toBe(
      'suppress',
    );
    expect(actionFor({ detected: true, confidence: 0.7, layer: 'phrase', scope: 'channel' })).toBe(
      'review',
    );
    expect(actionFor({ detected: true, confidence: 0.3, layer: 'phrase', scope: 'channel' })).toBe(
      'ignore',
    );
  });
});
