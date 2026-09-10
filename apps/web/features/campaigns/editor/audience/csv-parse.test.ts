/**
 * F58-S08 — o leitor de CSV do público.
 *
 * O que este arquivo protege: que nenhum arquivo real do cliente seja corrompido
 * em silêncio. O parser anterior quebrava a linha em vírgulas, então
 * `+5566999342444,"Silva, João"` virava um nome cortado e uma coluna deslocada —
 * e ninguém percebia até a mensagem sair errada para mil pessoas.
 */
import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  guessColumns,
  looksLikeHeader,
  normalizeHeader,
  parseCsvFile,
  parseCsvGrid,
} from './csv-parse';

describe('parseCsvGrid — aspas', () => {
  it('vírgula DENTRO de aspas não divide a coluna', () => {
    expect(parseCsvGrid('phone,name\n+5566999342444,"Silva, João"')).toEqual([
      ['phone', 'name'],
      ['+5566999342444', 'Silva, João'],
    ]);
  });

  it('aspas escapadas viram uma aspa literal (é como o Excel grava)', () => {
    expect(parseCsvGrid('a\n"diz ""oi"" sempre"')).toEqual([['a'], ['diz "oi" sempre']]);
  });

  it('quebra de linha dentro de aspas não parte a linha', () => {
    // Uma divisão por linhas antes das colunas já teria destruído este caso.
    expect(parseCsvGrid('phone,obs\n+551,"linha 1\nlinha 2"')).toEqual([
      ['phone', 'obs'],
      ['+551', 'linha 1\nlinha 2'],
    ]);
  });
});

describe('parseCsvGrid — o arquivo vem do Windows e do Excel', () => {
  it('CRLF', () => {
    expect(parseCsvGrid('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('BOM do UTF-8 (U+FEFF) não vira parte do cabeçalho', () => {
    // Sem remover, a coluna se chamaria "<BOM>phone" e o cabeçalho não seria
    // reconhecido — o arquivo certo falharia inteiro.
    const g = parseCsvGrid('\uFEFFphone,name\n+551,Ana');
    expect(g[0]).toEqual(['phone', 'name']);
  });

  it('ponto e vírgula: o padrão do Excel em português', () => {
    expect(parseCsvGrid('phone;name\n+551;Ana')).toEqual([
      ['phone', 'name'],
      ['+551', 'Ana'],
    ]);
  });

  it('linha vazia final não vira linha de dado', () => {
    expect(parseCsvGrid('phone\n+551\n')).toHaveLength(2);
  });

  it('campo vazio é preservado, não some', () => {
    // Sumir com a coluna deslocaria todas as seguintes.
    expect(parseCsvGrid('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('detectDelimiter', () => {
  it('vírgula é o padrão', () => {
    expect(detectDelimiter('a,b,c')).toBe(',');
  });

  it('ponto e vírgula quando ele domina', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
  });

  it('ponto e vírgula DENTRO de aspas não conta como separador', () => {
    expect(detectDelimiter('a,"x;y;z",b')).toBe(',');
  });

  it('empate vai para a vírgula — o padrão internacional', () => {
    expect(detectDelimiter('a,b;c')).toBe(',');
  });
});

describe('guessColumns — o cliente anexa a planilha DELE', () => {
  it('reconhece português e inglês', () => {
    expect(guessColumns(['telefone', 'nome'])).toEqual(['phone', 'name']);
    expect(guessColumns(['phone', 'name'])).toEqual(['phone', 'name']);
    expect(guessColumns(['Celular', 'Cliente'])).toEqual(['phone', 'name']);
  });

  it('reconhece consentimento', () => {
    expect(guessColumns(['opt_in'])).toEqual(['consent']);
    expect(guessColumns(['consentimento'])).toEqual(['consent']);
  });

  it('coluna desconhecida é ignorada, não adivinhada', () => {
    expect(guessColumns(['cpf', 'endereco'])).toEqual(['ignore', 'ignore']);
  });

  it('acento e espaço não impedem o reconhecimento', () => {
    expect(normalizeHeader(' Número ')).toBe('numero');
    expect(guessColumns([' Número '])).toEqual(['phone']);
  });
});

describe('looksLikeHeader — não descartar um contato por engano', () => {
  it('linha com nomes de coluna é cabeçalho', () => {
    expect(looksLikeHeader(['phone', 'name'])).toBe(true);
  });

  it('linha que já é dado NÃO é cabeçalho', () => {
    // Tratá-la como cabeçalho descartaria um contato — e o cliente jamais
    // notaria que faltou um.
    expect(looksLikeHeader(['+5566999342444', 'Ana'])).toBe(false);
  });
});

describe('parseCsvFile', () => {
  it('com cabeçalho: mapeia papéis e não devolve o cabeçalho como dado', () => {
    const r = parseCsvFile('telefone,nome\n+551,Ana\n+552,Bruno');
    expect(r.header).toEqual(['telefone', 'nome']);
    expect(r.roles).toEqual(['phone', 'name']);
    expect(r.rows).toHaveLength(2);
  });

  it('sem cabeçalho: assume 1ª coluna telefone, 2ª nome, e preserva TODAS as linhas', () => {
    const r = parseCsvFile('+551,Ana\n+552,Bruno');
    expect(r.header).toBeNull();
    expect(r.roles).toEqual(['phone', 'name']);
    expect(r.rows).toHaveLength(2);
  });

  it('arquivo vazio não quebra', () => {
    const r = parseCsvFile('');
    expect(r.rows).toEqual([]);
    expect(r.header).toBeNull();
  });
});
