/**
 * F58-S08 — a prévia do público.
 *
 * O que este arquivo protege: que o número "vão receber" seja verdade. É o
 * número que o cliente olha antes de apertar enviar; se ele mentir para mais, a
 * campanha sai para gente que não deveria receber — e nos EUA isso vem com multa
 * por mensagem.
 */
import { describe, expect, it } from 'vitest';
import { classifyAudience, isE164, normalizePhone } from './classify';

describe('normalizePhone — conservador de propósito', () => {
  it('E.164 passa intacto', () => {
    expect(normalizePhone('+5566999342444', '55')).toBe('+5566999342444');
  });

  it('número brasileiro digitado por humano vira E.164', () => {
    expect(normalizePhone('(66) 99934-2444', '55')).toBe('+5566999342444');
    expect(normalizePhone('66 99934 2444', '55')).toBe('+5566999342444');
  });

  it('fixo de 8 dígitos com DDD também', () => {
    expect(normalizePhone('(66) 3934-2444', '55')).toBe('+556639342444');
  });

  it('DDI sem o + é reconhecido', () => {
    expect(normalizePhone('5566999342444', '55')).toBe('+5566999342444');
  });

  it('número americano no workspace americano', () => {
    expect(normalizePhone('(305) 555-0142', '1')).toBe('+13055550142');
  });

  it('NÃO chuta DDI para número curto demais', () => {
    // Chutar transformaria um erro visível num envio para o número errado — que
    // custa dinheiro e reputação de remetente.
    expect(normalizePhone('5551234', '55')).toBeNull();
    expect(normalizePhone('123', '55')).toBeNull();
  });

  it('texto que não é telefone devolve null', () => {
    expect(normalizePhone('sem numero', '55')).toBeNull();
    expect(normalizePhone('', '55')).toBeNull();
    expect(normalizePhone('   ', '55')).toBeNull();
  });

  it('mesma regra de E.164 do servidor', () => {
    expect(isE164('+5566999342444')).toBe(true);
    expect(isE164('5566999342444')).toBe(false);
    expect(isE164('+05566999342444')).toBe(false);
  });
});

describe('classifyAudience', () => {
  const base = { defaultCountry: '55' as const, requireConsent: false };

  it('conta quem vai receber de verdade', () => {
    const r = classifyAudience({
      ...base,
      rows: [{ phone: '+5566999342444' }, { phone: '+5566999342445' }],
    });
    expect(r.willReceive).toBe(2);
    expect(r.counts.valido).toBe(2);
  });

  it('separa as cinco categorias, porque são cinco decisões diferentes', () => {
    const r = classifyAudience({
      ...base,
      requireConsent: true,
      alreadyInCampaign: new Set(['+5566999342444']),
      rows: [
        { phone: '+5566999342444', consent: true }, // já na campanha
        { phone: '+5566999342445', consent: true }, // válido
        { phone: '+5566999342445', consent: true }, // repetido
        { phone: '+5566999342446' }, // sem consentimento
        { phone: 'nao e telefone' }, // inválido
      ],
    });
    expect(r.counts).toEqual({
      valido: 1,
      telefone_invalido: 1,
      repetido_no_arquivo: 1,
      ja_na_campanha: 1,
      sem_consentimento: 1,
    });
    expect(r.willReceive).toBe(1);
  });

  it('exigência de consentimento vem do mercado, não é fixa', () => {
    const rows = [{ phone: '+5566999342444' }];
    // Brasil, canal em uso: não exige consentimento prévio.
    expect(classifyAudience({ ...base, rows }).willReceive).toBe(1);
    // EUA: exige. Fixar qualquer um dos dois quebraria metade dos clientes.
    expect(classifyAudience({ ...base, requireConsent: true, rows }).willReceive).toBe(0);
  });

  it('repetido é contado UMA vez, e a repetição não vira "vai receber"', () => {
    const r = classifyAudience({
      ...base,
      rows: [{ phone: '+5566999342444' }, { phone: '+5566999342444' }, { phone: '+5566999342444' }],
    });
    expect(r.willReceive).toBe(1);
    expect(r.counts.repetido_no_arquivo).toBe(2);
  });

  it('repetido reconhece formatos DIFERENTES do mesmo número', () => {
    // A planilha do cliente mistura "(66) 99934-2444" e "+5566999342444". Sem
    // normalizar antes de comparar, a mesma pessoa receberia duas vezes.
    const r = classifyAudience({
      ...base,
      rows: [{ phone: '(66) 99934-2444' }, { phone: '+5566999342444' }],
    });
    expect(r.willReceive).toBe(1);
    expect(r.counts.repetido_no_arquivo).toBe(1);
  });

  it('preserva o telefone COMO VEIO — é o que o cliente procura na planilha', () => {
    const r = classifyAudience({ ...base, rows: [{ phone: ' (66) 99934-2444 ' }] });
    expect(r.rows[0]?.original).toBe('(66) 99934-2444');
    expect(r.rows[0]?.phone).toBe('+5566999342444');
  });

  it('nome vazio vira null, não string em branco', () => {
    const r = classifyAudience({ ...base, rows: [{ phone: '+5566999342444', name: '   ' }] });
    expect(r.rows[0]?.name).toBeNull();
  });

  it('arquivo vazio devolve zeros, não erro', () => {
    const r = classifyAudience({ ...base, rows: [] });
    expect(r.willReceive).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('inválido NÃO ocupa vaga de duplicata', () => {
    // Dois números ilegíveis diferentes são dois inválidos, não um inválido e
    // um repetido — senão o relatório esconderia metade dos erros do arquivo.
    const r = classifyAudience({ ...base, rows: [{ phone: 'abc' }, { phone: 'xyz' }] });
    expect(r.counts.telefone_invalido).toBe(2);
    expect(r.counts.repetido_no_arquivo).toBe(0);
  });
});
