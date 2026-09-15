/**
 * F69-S03 — leitura dos leads de anúncios.
 *
 * Os payloads seguem o formato da documentação da Meta (Lead Ads — Webhooks e
 * Retrieving, verificada em 2026-09-15).
 */
import { describe, expect, it } from 'vitest';
import {
  answersSummary,
  contactFieldsFrom,
  customFieldsFrom,
  parseLead,
  parseLeadgenWebhook,
} from './parse';

describe('parseLeadgenWebhook', () => {
  it('lê a notificação no formato da documentação', () => {
    const r = parseLeadgenWebhook({
      object: 'page',
      entry: [
        {
          id: 'pg1',
          time: 1_790_000_000,
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lg1',
                page_id: 'pg1',
                form_id: 'f1',
                adgroup_id: 'as1',
                ad_id: 'ad1',
                created_time: 1_790_000_000,
              },
            },
          ],
        },
      ],
    });
    expect(r).toEqual([
      { leadgenId: 'lg1', pageId: 'pg1', formId: 'f1', adId: 'ad1', adgroupId: 'as1', createdTime: 1_790_000_000 },
    ]);
  });

  it('ignora outros objetos, outros campos e itens sem identificador', () => {
    expect(parseLeadgenWebhook({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(
      parseLeadgenWebhook({
        object: 'page',
        entry: [{ id: 'pg1', changes: [{ field: 'feed', value: {} }, { field: 'leadgen', value: {} }] }],
      }),
    ).toEqual([]);
  });

  it('sem page_id no valor usa o id da entrada', () => {
    const [n] = parseLeadgenWebhook({
      object: 'page',
      entry: [{ id: 'pg9', changes: [{ field: 'leadgen', value: { leadgen_id: 'lg9' } }] }],
    });
    expect(n?.pageId).toBe('pg9');
  });

  it('lixo não lança', () => {
    for (const x of [null, 'x', { object: 'page', entry: 'x' }, { object: 'page', entry: [null, { changes: 'x' }] }]) {
      expect(parseLeadgenWebhook(x)).toEqual([]);
    }
  });
});

describe('parseLead', () => {
  const lead = {
    id: 'lg1',
    created_time: '2026-09-15T12:00:00+0000',
    ad_id: 'ad1',
    form_id: 'f1',
    field_data: [
      { name: 'full_name', values: ['Ana Souza'] },
      { name: 'phone_number', values: ['+13055550142'] },
      { name: 'email', values: ['Ana@Exemplo.com'] },
      { name: 'tipo_de_obra', values: ['Cozinha'] },
      { name: 'vazio', values: [''] },
    ],
    custom_disclaimer_responses: [
      { checkbox_key: 'optin_sms', is_checked: '1' },
      { checkbox_key: 'optin_email', is_checked: false },
    ],
  };

  it('lê respostas e caixas de consentimento', () => {
    const r = parseLead(lead);
    expect(r?.leadgenId).toBe('lg1');
    expect(r?.answers['tipo_de_obra']).toEqual(['Cozinha']);
    expect(r?.answers['vazio']).toBeUndefined();
    expect(r?.consent).toEqual([
      { checkboxKey: 'optin_sms', isChecked: true },
      { checkboxKey: 'optin_email', isChecked: false },
    ]);
  });

  it('sem id não é lead', () => {
    expect(parseLead({ field_data: [] })).toBeNull();
    expect(parseLead(null)).toBeNull();
  });

  it('contactFieldsFrom: nome, e-mail minúsculo e telefone bruto', () => {
    expect(contactFieldsFrom(parseLead(lead)!.answers)).toEqual({
      fullName: 'Ana Souza',
      email: 'ana@exemplo.com',
      phone: '+13055550142',
    });
  });

  it('sem full_name, junta primeiro nome e sobrenome', () => {
    expect(contactFieldsFrom({ first_name: ['Ana'], last_name: ['Souza'] }).fullName).toBe('Ana Souza');
  });

  it('e-mail sem @ não é e-mail', () => {
    expect(contactFieldsFrom({ email: ['ana'] }).email).toBeNull();
  });
});

describe('answersSummary', () => {
  it('campos padrão primeiro, depois as perguntas do formulário', () => {
    const s = answersSummary({
      tipo_de_obra: ['Cozinha'],
      email: ['ana@exemplo.com'],
      full_name: ['Ana'],
      phone_number: ['+13055550142'],
    });
    expect(s.split('\n')).toEqual([
      '📝 Lead do formulário do anúncio',
      'Nome: Ana',
      'Telefone: +13055550142',
      'E-mail: ana@exemplo.com',
      'Tipo de obra: Cozinha',
    ]);
  });
});

describe('customFieldsFrom — só onde a chave casa, e só valor que cabe no tipo', () => {
  const defs = [
    { key: 'tipo_de_obra', type: 'select' as const, options: ['Cozinha', 'Banheiro'] },
    { key: 'orcamento', type: 'currency' as const },
    { key: 'imovel_proprio', type: 'boolean' as const },
    { key: 'comodos', type: 'multiselect' as const, options: ['Sala', 'Quarto'] },
    { key: 'cidade', type: 'text' as const },
    { key: 'sem_resposta', type: 'text' as const },
  ];

  it('preenche por chave, com acento e caixa diferentes', () => {
    const r = customFieldsFrom(
      {
        'Tipo de obra': ['cozinha'],
        orçamento: ['US$ 12,500.00'],
        imovel_proprio: ['Sim'],
        comodos: ['Sala, Quarto'],
        cidade: ['Miami'],
      },
      defs,
    );
    expect(r).toEqual({
      tipo_de_obra: 'Cozinha',
      orcamento: 12500,
      imovel_proprio: true,
      comodos: ['Sala', 'Quarto'],
      cidade: 'Miami',
    });
  });

  it('valor que não cabe no tipo é descartado, não gravado torto', () => {
    const r = customFieldsFrom(
      { tipo_de_obra: ['Telhado'], orcamento: ['a combinar'], imovel_proprio: ['talvez'] },
      defs,
    );
    expect(r).toEqual({});
  });

  it('número em formato brasileiro', () => {
    expect(customFieldsFrom({ orcamento: ['R$ 1.234,56'] }, defs)).toEqual({ orcamento: 1234.56 });
  });
});
