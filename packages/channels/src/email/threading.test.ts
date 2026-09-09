import { describe, expect, it } from 'vitest';
import {
  buildReferences,
  normalizeMessageId,
  normalizeSubject,
  parseReferences,
  replySubject,
  threadKeyFrom,
} from './threading';

describe('assunto serve para exibir, não para identificar', () => {
  it.each([
    ['Re: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['RE: RE: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['Fwd: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['Re: Fwd: Re: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['ENC: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['Res: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['AW: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['Re[2]: Orçamento da cozinha', 'Orçamento da cozinha'],
    ['Orçamento da cozinha', 'Orçamento da cozinha'],
  ])('limpa "%s"', (entrada, esperado) => {
    expect(normalizeSubject(entrada)).toBe(esperado);
  });

  it('não empilha Re: ao responder', () => {
    expect(replySubject('Re: Re: Obra')).toBe('Re: Obra');
    expect(replySubject('Obra')).toBe('Re: Obra');
  });

  it('assunto vazio não quebra', () => {
    expect(normalizeSubject('   ')).toBe('');
    expect(replySubject('Re:')).toBe('Re:');
  });
});

describe('Message-ID', () => {
  it('normaliza tirando os sinais e o espaço', () => {
    expect(normalizeMessageId(' <abc@dominio.com> ')).toBe('abc@dominio.com');
    expect(normalizeMessageId('abc@dominio.com')).toBe('abc@dominio.com');
  });

  it('parseReferences separa e normaliza', () => {
    expect(parseReferences('<a@x>  <b@x>\n<c@x>')).toEqual(['a@x', 'b@x', 'c@x']);
    expect(parseReferences(null)).toEqual([]);
    expect(parseReferences('')).toEqual([]);
  });
});

describe('cadeia de References', () => {
  it('repete o recebido e acrescenta o respondido (RFC 5322)', () => {
    expect(buildReferences(['<a@x>', '<b@x>'], '<c@x>')).toEqual(['a@x', 'b@x', 'c@x']);
  });

  it('não duplica quando o respondido já está na cadeia', () => {
    expect(buildReferences(['<a@x>', '<c@x>'], '<c@x>')).toEqual(['a@x', 'c@x']);
  });

  it('primeira mensagem da thread começa só com ela', () => {
    expect(buildReferences([], '<raiz@x>')).toEqual(['raiz@x']);
    expect(buildReferences([], null)).toEqual([]);
  });

  it('thread longa preserva a raiz e as pontas mais recentes', () => {
    // Cabeçalho grande demais faz provedor recusar; a raiz é o que agrupa.
    const muitas = Array.from({ length: 60 }, (_, i) => `<m${i}@x>`);
    const r = buildReferences(muitas, '<novo@x>', 10);
    expect(r).toHaveLength(10);
    expect(r[0]).toBe('m0@x');
    expect(r[r.length - 1]).toBe('novo@x');
  });
});

describe('chave da thread', () => {
  it('a raiz da cadeia é a mesma para toda a conversa', () => {
    const primeira = threadKeyFrom({ messageId: '<raiz@x>', inReplyTo: null, references: [] });
    const resposta = threadKeyFrom({
      messageId: '<r1@x>',
      inReplyTo: '<raiz@x>',
      references: ['<raiz@x>'],
    });
    const treplica = threadKeyFrom({
      messageId: '<r2@x>',
      inReplyTo: '<r1@x>',
      references: ['<raiz@x>', '<r1@x>'],
    });
    expect(primeira).toBe('raiz@x');
    expect(resposta).toBe('raiz@x');
    expect(treplica).toBe('raiz@x');
  });

  it('resposta SEM References cai no In-Reply-To', () => {
    // Cliente de e-mail antigo que só manda In-Reply-To.
    expect(threadKeyFrom({ messageId: '<r@x>', inReplyTo: '<raiz@x>', references: [] })).toBe(
      'raiz@x',
    );
  });

  it('mensagem isolada é a própria raiz', () => {
    expect(threadKeyFrom({ messageId: '<solo@x>', inReplyTo: null, references: [] })).toBe('solo@x');
  });

  it('assunto alterado NÃO parte a thread — é o ponto do módulo', () => {
    // O cliente responde mudando o assunto por completo. Se identificássemos por
    // assunto, isto viraria conversa nova e o atendente perderia o contexto.
    const original = threadKeyFrom({ messageId: '<raiz@x>', inReplyTo: null, references: [] });
    const comOutroAssunto = threadKeyFrom({
      messageId: '<r9@x>',
      inReplyTo: '<raiz@x>',
      references: ['<raiz@x>'],
    });
    expect(comOutroAssunto).toBe(original);
  });
});
