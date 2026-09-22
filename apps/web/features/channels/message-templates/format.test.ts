/**
 * F58-S05 — a lógica pura da Central de Modelos.
 *
 * O que este arquivo protege:
 *
 * 1. **A tradução dos status da Meta em decisão.** A tela promete dizer se o modelo *pode ser usado*;
 *    um status novo ou um modelo removido no provider não podem virar "aprovado" por omissão.
 * 2. **A validação antes de enviar à Meta.** Nome e idioma não mudam depois do envio, e cada rodada
 *    recusada custa tempo de aprovação — então o erro tem que aparecer no formulário, não lá.
 * 3. **O formato enviado.** `draftToInput` monta o que a Meta espera (componentes e exemplos); um
 *    exemplo faltando ou fora de ordem é recusa garantida.
 * 4. **A leitura do que vem de fora.** `safeComponents` recebe `unknown[]` do provider: item
 *    malformado não pode derrubar a prévia.
 */
import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  displayTemplateName,
  draftToInput,
  formatDateTime,
  languageLabel,
  previewText,
  safeComponents,
  templateStatus,
  validateDraft,
  variableNumbers,
} from './format';
import { EMPTY_DRAFT, type CreateTemplateDraft } from './types';

const rascunho = (patch: Partial<CreateTemplateDraft> = {}): CreateTemplateDraft => ({
  ...EMPTY_DRAFT,
  name: 'lembrete_consulta',
  body: 'Olá, {{1}}. Sua consulta é {{2}}.',
  bodyExamples: ['Marina', 'amanhã às 14h'],
  ...patch,
});

describe('templateStatus', () => {
  it('só aprovado pode ser usado em campanha', () => {
    expect(templateStatus({ status: 'APPROVED', isAvailable: true }).canUse).toBe(true);
    for (const status of ['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION']) {
      expect(templateStatus({ status, isAvailable: true }).canUse).toBe(false);
    }
  });

  it('removido no provider não pode ser usado, mesmo marcado como aprovado', () => {
    const s = templateStatus({ status: 'APPROVED', isAvailable: false });
    expect(s.canUse).toBe(false);
    expect(s.label).toBe('Não disponível');
  });

  it('status desconhecido não vira aprovado por omissão', () => {
    const s = templateStatus({ status: 'ALGO_NOVO_DA_META', isAvailable: true });
    expect(s.canUse).toBe(false);
    expect(s.guidance).not.toBe('');
  });

  it('todo status tem rótulo e próxima ação', () => {
    for (const status of ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'QUALQUER']) {
      const s = templateStatus({ status, isAvailable: true });
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.guidance.length).toBeGreaterThan(0);
    }
  });
});

describe('rótulos', () => {
  it('categoria e idioma conhecidos viram nome de gente', () => {
    expect(categoryLabel('UTILITY')).toBe('Serviço');
    expect(languageLabel('pt_BR')).toBe('Português (Brasil)');
  });

  it('valor desconhecido não quebra nem mostra vazio', () => {
    expect(categoryLabel('OUTRA_COISA')).toBe('Outra categoria');
    expect(languageLabel('fr_CA')).toBe('fr-CA');
  });

  it('nome técnico do modelo vira nome legível', () => {
    expect(displayTemplateName('lembrete_consulta')).toBe('Lembrete consulta');
    expect(displayTemplateName('')).toBe('Modelo sem nome');
  });

  it('data inválida ou ausente é dita, não escondida', () => {
    expect(formatDateTime(null)).toBe('Ainda não sincronizado');
    expect(formatDateTime('nao-e-data')).toBe('Horário indisponível');
    expect(formatDateTime('2026-09-22T12:00:00Z')).not.toBe('Horário indisponível');
  });
});

describe('variableNumbers', () => {
  it('lê em ordem, sem repetir', () => {
    expect(variableNumbers('Oi {{2}}, {{1}} e {{2}}')).toEqual([1, 2]);
    expect(variableNumbers('sem variáveis')).toEqual([]);
  });
});

describe('validateDraft', () => {
  it('rascunho completo passa', () => {
    expect(validateDraft(rascunho())).toEqual({});
  });

  it('nome e idioma seguem as regras da Meta', () => {
    expect(validateDraft(rascunho({ name: 'Lembrete Consulta' })).name).toBeDefined();
    expect(validateDraft(rascunho({ language: 'portugues' })).language).toBeDefined();
  });

  it('mensagem vazia, longa demais ou com variável fora de ordem é recusada aqui', () => {
    expect(validateDraft(rascunho({ body: '   ', bodyExamples: [] })).body).toBeDefined();
    expect(validateDraft(rascunho({ body: 'a'.repeat(1025), bodyExamples: [] })).body).toBeDefined();
    expect(validateDraft(rascunho({ body: 'Oi {{2}}', bodyExamples: ['x'] })).body).toBeDefined();
    expect(validateDraft(rascunho({ body: 'Oi {{1}', bodyExamples: ['x'] })).body).toBeDefined();
  });

  it('cada variável da mensagem precisa de exemplo', () => {
    expect(validateDraft(rascunho({ bodyExamples: ['Marina'] })).bodyExamples).toBeDefined();
    expect(validateDraft(rascunho({ bodyExamples: ['Marina', '  '] })).bodyExamples).toBeDefined();
  });

  it('cabeçalho aceita uma variável, com exemplo; rodapé não aceita nenhuma', () => {
    expect(validateDraft(rascunho({ header: 'Olá, {{1}}', headerExample: '' })).headerExample).toBeDefined();
    expect(validateDraft(rascunho({ header: 'Olá, {{1}}', headerExample: 'Marina' })).header).toBeUndefined();
    expect(validateDraft(rascunho({ header: '{{1}} e {{2}}', headerExample: 'x' })).header).toBeDefined();
    expect(validateDraft(rascunho({ footer: 'Responda {{1}}' })).footer).toBeDefined();
  });

  it('botão exige texto curto, URL https e telefone internacional', () => {
    const botao = { id: 'b1', type: 'QUICK_REPLY' as const, text: '', value: '', example: '' };
    expect(validateDraft(rascunho({ buttons: [botao] })).buttons).toBeDefined();
    expect(
      validateDraft(rascunho({ buttons: [{ ...botao, type: 'URL', text: 'Abrir', value: 'http://x.com' }] })).buttons,
    ).toBeDefined();
    expect(
      validateDraft(rascunho({ buttons: [{ ...botao, type: 'PHONE_NUMBER', text: 'Ligar', value: '11999999999' }] }))
        .buttons,
    ).toBeDefined();
    expect(
      validateDraft(
        rascunho({ buttons: [{ ...botao, type: 'URL', text: 'Abrir', value: 'https://x.com/{{1}}', example: 'ABC' }] }),
      ).buttons,
    ).toBeUndefined();
  });

  it('variável no meio da URL é recusada — a Meta só aceita no final', () => {
    const buttons = [
      { id: 'b1', type: 'URL' as const, text: 'Abrir', value: 'https://x.com/{{1}}/fim', example: 'ABC' },
    ];
    expect(validateDraft(rascunho({ buttons })).buttons).toBeDefined();
  });
});

describe('draftToInput', () => {
  it('monta os componentes na ordem e com os exemplos', () => {
    const input = draftToInput(
      rascunho({ header: 'Olá, {{1}}', headerExample: 'Marina', footer: 'Responda SAIR para sair.' }),
    );
    expect(input.name).toBe('lembrete_consulta');
    expect(input.components.map((c) => c['type'])).toEqual(['HEADER', 'BODY', 'FOOTER']);
    expect(input.components[0]).toMatchObject({ format: 'TEXT', example: { header_text: ['Marina'] } });
    expect(input.components[1]).toMatchObject({ example: { body_text: [['Marina', 'amanhã às 14h']] } });
  });

  it('sem variáveis, não manda exemplo vazio', () => {
    const input = draftToInput(rascunho({ body: 'Mensagem fixa.', bodyExamples: [] }));
    expect(input.components[0]).not.toHaveProperty('example');
  });

  it('exemplo sobrando não vai junto: a Meta recusa contagem diferente', () => {
    const input = draftToInput(rascunho({ body: 'Oi {{1}}', bodyExamples: ['Marina', 'sobra'] }));
    expect(input.components[0]).toMatchObject({ example: { body_text: [['Marina']] } });
  });

  it('botões viram o formato da Meta, com url e telefone nos campos certos', () => {
    const input = draftToInput(
      rascunho({
        buttons: [
          { id: 'b1', type: 'URL', text: 'Abrir', value: 'https://x.com/{{1}}', example: 'ABC' },
          { id: 'b2', type: 'PHONE_NUMBER', text: 'Ligar', value: '+5511999999999', example: '' },
          { id: 'b3', type: 'QUICK_REPLY', text: 'Parar', value: '', example: '' },
        ],
      }),
    );
    const botoes = input.components.find((c) => c['type'] === 'BUTTONS')?.['buttons'] as Record<string, unknown>[];
    expect(botoes[0]).toMatchObject({ type: 'URL', url: 'https://x.com/{{1}}', example: ['ABC'] });
    expect(botoes[1]).toMatchObject({ type: 'PHONE_NUMBER', phone_number: '+5511999999999' });
    expect(botoes[2]).toEqual({ type: 'QUICK_REPLY', text: 'Parar' });
  });
});

describe('safeComponents', () => {
  it('lê o que reconhece e ignora o resto sem quebrar', () => {
    const lido = safeComponents([
      { type: 'BODY', text: 'Oi' },
      { type: 'HEADER', format: 'IMAGE' },
      null,
      'texto solto',
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://x.com' }, { semTexto: true }] },
    ]);
    expect(lido.map((c) => c.type)).toEqual(['BODY', 'HEADER', 'UNKNOWN', 'UNKNOWN', 'BUTTONS']);
    expect(lido[4]?.buttons).toEqual([{ type: 'URL', text: 'Abrir', value: 'https://x.com' }]);
  });
});

describe('previewText', () => {
  it('troca as variáveis pelos exemplos e mantém o que não tem exemplo', () => {
    expect(previewText('Olá, {{1}}. Pedido {{2}}.', ['Marina'])).toBe('Olá, Marina. Pedido {{2}}.');
    expect(previewText('Olá, {{1}}.', ['  '])).toBe('Olá, {{1}}.');
  });
});
